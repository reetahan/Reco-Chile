"""Tiny in-process caches, standard library only.

Two caching behaviours the engine relies on:

* :func:`memoize_bytes` — for the CSV loaders, which are keyed by the *contents*
  of a file rather than by its path. The cache is unbounded on purpose: there
  are four data files and each is loaded at most once per distinct byte
  content.
* :class:`TTLCache` / :func:`ttl_memoize` — for geocoding, where results must
  expire (Nominatim answers are not permanent) and the number of distinct
  addresses per process must stay bounded.

Both decorators hand back a *copy* of the cached value when the value knows how
to copy itself (``pandas`` objects, ``dict``, ``list``, ``set``), so a caller
that mutates a loaded DataFrame cannot corrupt the cache. The copy is shallow —
nested containers are still shared, which is safe here because every consumer
treats loader and geocoder results as read-only.

Nothing in this module imports a third-party package.
"""

from __future__ import annotations

import functools
import hashlib
import threading
import time
from typing import Any, Callable

__all__ = [
    "MISS",
    "TTLCache",
    "clear_all_caches",
    "memoize_bytes",
    "ttl_memoize",
]


class _Missing:
    """Sentinel type for "no cached value", distinct from a cached ``None``."""

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "MISS"

    def __bool__(self) -> bool:
        return False


MISS = _Missing()

# Every cache created in this module registers a `clear` callable here so that
# tests can reset everything on a data change.
_registered_clears: list[Callable[[], None]] = []
_registry_lock = threading.Lock()


def _register(clear: Callable[[], None]) -> None:
    with _registry_lock:
        _registered_clears.append(clear)


def clear_all_caches() -> None:
    """Empty every cache created by this module. Intended for tests."""
    with _registry_lock:
        clears = list(_registered_clears)
    for clear in clears:
        clear()


def _copy_result(value: Any) -> Any:
    """Return an independent shallow copy when the value supports it.

    ``pandas.DataFrame``, ``dict``, ``list`` and ``set`` all expose a no-argument
    ``copy()``. Anything else (numbers, strings, tuples, custom objects) is
    returned unchanged — those are either immutable or not something this
    module's callers mutate.
    """
    copy = getattr(value, "copy", None)
    if callable(copy):
        try:
            return copy()
        except TypeError:
            return value
    return value


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _key_part(value: Any) -> Any:
    """Hash byte blobs, keep everything else as-is (it must be hashable)."""
    if isinstance(value, bytes):
        return _digest(value)
    if isinstance(value, (bytearray, memoryview)):
        return _digest(bytes(value))
    return value


def _require_bytes(value: Any, func_name: str) -> None:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise TypeError(
            f"{func_name}() is cached with memoize_bytes, so its first positional "
            f"argument must be bytes, not {type(value).__name__}."
        )


def memoize_bytes(func: Callable[..., Any]) -> Callable[..., Any]:
    """Cache a function whose first positional argument is a ``bytes`` blob.

    The key is the ``sha256`` of every byte argument plus the remaining
    (hashable) arguments, so callers keep passing file contents around without
    the cache holding several megabytes of CSV per entry, and two different
    paths with identical contents share one parsed result.

    The wrapper exposes ``cache_clear()`` and ``cache_info()`` and is
    thread-safe. The wrapped function may run more than once concurrently for a
    cold key — the loaders are pure, so the only cost is duplicated work.
    """
    lock = threading.Lock()
    cache: dict[tuple, Any] = {}
    hits = 0
    misses = 0

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        nonlocal hits, misses
        if not args:
            raise TypeError(
                f"{func.__name__}() is cached with memoize_bytes and requires "
                "its bytes argument to be passed positionally."
            )
        _require_bytes(args[0], func.__name__)
        # Every byte blob is reduced to its digest so the cache key stays small
        # even when a loader takes several CSV payloads (``_load_calibration``).
        key = (
            tuple(_key_part(a) for a in args),
            tuple((k, _key_part(v)) for k, v in sorted(kwargs.items())),
        )

        with lock:
            cached = cache.get(key, MISS)
            if cached is not MISS:
                hits += 1
                return _copy_result(cached)
            misses += 1

        value = func(*args, **kwargs)

        with lock:
            cache.setdefault(key, value)
            stored = cache[key]
        return _copy_result(stored)

    def cache_clear() -> None:
        nonlocal hits, misses
        with lock:
            cache.clear()
            hits = 0
            misses = 0

    def cache_info() -> dict[str, int]:
        with lock:
            return {"hits": hits, "misses": misses, "currsize": len(cache)}

    wrapper.cache_clear = cache_clear  # type: ignore[attr-defined]
    wrapper.cache_info = cache_info  # type: ignore[attr-defined]
    wrapper.__wrapped__ = func  # type: ignore[attr-defined]
    _register(cache_clear)
    return wrapper


class TTLCache:
    """A small thread-safe cache with per-entry expiry and LRU eviction.

    ``get`` returns :data:`MISS` (falsy, and distinguishable from a cached
    ``None``) when the key is absent or expired.
    """

    def __init__(self, maxsize: int = 128, ttl_seconds: float = 3600.0) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be at least 1")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self.maxsize = int(maxsize)
        self.ttl_seconds = float(ttl_seconds)
        self._lock = threading.Lock()
        # key -> (expires_at, value); insertion order is the LRU order.
        self._entries: dict[Any, tuple[float, Any]] = {}
        _register(self.clear)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def get(self, key: Any, default: Any = MISS) -> Any:
        """Return the cached value, or ``default`` (``MISS``) when absent/expired."""
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return default
            expires_at, value = entry
            if expires_at <= now:
                self._entries.pop(key, None)
                return default
            # Refresh recency without changing the expiry.
            self._entries.pop(key)
            self._entries[key] = entry
            return value

    def set(self, key: Any, value: Any) -> None:
        """Store a value under ``key``, evicting expired then least-recent entries."""
        now = time.monotonic()
        with self._lock:
            self._entries.pop(key, None)
            self._entries[key] = (now + self.ttl_seconds, value)
            for expired in [k for k, (exp, _) in self._entries.items() if exp <= now]:
                self._entries.pop(expired, None)
            while len(self._entries) > self.maxsize:
                self._entries.pop(next(iter(self._entries)))

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


def _default_ttl_key(args: tuple, kwargs: dict) -> Any:
    if not args and not kwargs:
        return ()
    if len(args) == 1 and not kwargs:
        return str(args[0])
    return (tuple(str(a) for a in args), tuple(sorted(kwargs.items())))


def ttl_memoize(
    ttl_seconds: float,
    maxsize: int = 128,
    *,
    key: Callable[..., Any] | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Cache a string-keyed function for ``ttl_seconds``, keeping ``maxsize`` entries.

    ``key`` optionally maps the call arguments to the cache key; by default a
    single-argument call is keyed by ``str(argument)``. Pass a normalizer when
    two textually different arguments should share one entry (the geocoder
    keys by the whitespace-collapsed address).
    """
    cache = TTLCache(maxsize=maxsize, ttl_seconds=ttl_seconds)

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            cache_key = key(*args, **kwargs) if key is not None else _default_ttl_key(args, kwargs)
            cached = cache.get(cache_key)
            if cached is not MISS:
                return _copy_result(cached)
            value = func(*args, **kwargs)
            cache.set(cache_key, value)
            return _copy_result(value)

        wrapper.cache_clear = cache.clear  # type: ignore[attr-defined]
        wrapper.cache = cache  # type: ignore[attr-defined]
        wrapper.__wrapped__ = func  # type: ignore[attr-defined]
        return wrapper

    return decorator
