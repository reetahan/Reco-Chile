# `web/` — Reco Chile frontend

Next.js (App Router) + shadcn/ui frontend for the SAE risk estimator. It
formats and explains; it never computes a probability — every number comes from
the FastAPI backend (`../api.py`) on top of the `sae_app/` engine.

See **`../CONTRIBUTING.md`** for the conventions and the frontend style guide, and
**`../docs/architecture.md`** for the API contract and the wizard state model.

## Requirements

- Node — the major in `.nvmrc` / `.node-version` (≥ 20).
- pnpm — the version in `package.json`'s `packageManager` field.

## Install

```bash
pnpm install
pnpm e2e:install      # once: downloads the Chromium browser for Playwright
```

## Environment

Copy `.env.example` to `.env.local` and adjust:

```bash
cp .env.example .env.local
```

| Variable       | Default                 | Meaning                                                                                                                        |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `API_BASE_URL` | `http://localhost:8000` | Origin of the FastAPI service. Server-side only — the browser reaches the API through the Next.js proxy route, never directly. |

`API_BASE_URL` is read **only** in Node (`lib/api/upstream.ts`, `lib/meta/fetch-meta.ts`).
It has no `NEXT_PUBLIC_` twin on purpose: the Python port is never named in
anything the browser downloads, so it does not have to be reachable publicly.

Start the backend in the repository root first:

```bash
.venv/bin/python -m uvicorn api:app --reload
```

## Develop

```bash
pnpm dev              # http://localhost:3000
```

## Test

```bash
pnpm test             # Vitest (jsdom + @testing-library/react), single run
pnpm test:watch       # Vitest in watch mode
pnpm e2e              # Playwright (chromium); starts both halves of the stack
```

`pnpm e2e` starts **both** servers itself (`playwright.config.ts`, `webServer`):

- FastAPI — `cd .. && .venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8000`,
  waited on via `/health`. It runs the interpreter of the repository's own
  `.venv` by path, never a bare `python3`: on macOS that resolves to system
  Python 3.9, which cannot import `api.py` (see `../CONTRIBUTING.md`). So `.venv` must
  exist and have `requirements.txt` installed before the first `pnpm e2e`.
- Next.js — `pnpm dev` on port 3000.

Locally an already-running pair is reused (`reuseExistingServer: !CI`); under CI
a stale server is never trusted.

## Check

```bash
pnpm lint             # ESLint (next/core-web-vitals + typescript, Prettier-compatible)
pnpm format           # Prettier, writes
pnpm format:check     # Prettier, verifies
pnpm build            # production build
```

## Talking to the API

Three layers, and nothing skips one.

### 1. `openapi.json` → `schema.d.ts`

`lib/api/openapi.json` is the FastAPI schema, exported from the Python side and
committed. Regenerate it after any change to `../api.py`, then regenerate the
TypeScript types:

```bash
../.venv/bin/python ../scripts/export_openapi.py   # rewrites lib/api/openapi.json
pnpm api:types                                     # openapi.json -> lib/api/schema.d.ts
```

`pnpm api:types` runs `openapi-typescript` and then Prettier over the output.
Neither `openapi.json` nor `schema.d.ts` is ever hand-edited — an endpoint is
added in Python and regenerated here.

### 2. `@/lib/api` — the typed client

`lib/api/client.ts` derives every method name, query parameter, request body and
200 body from `schema.d.ts`, so an endpoint that does not exist does not
compile:

```ts
import { api, ApiError } from "@/lib/api";

const meta = await api.get("/meta", { lang: "es" });
const program = await api.get("/programs/{program_id}", {
  path: { program_id: "1234:5" },
});
const result = await api.post("/simulate", body, { lang: locale });
```

`lang` is sent as `?lang=` and mirrored into `Accept-Language`.
A non-2xx response throws `ApiError`, which carries the contract's
`{error_key, message, params}` envelope: show `message`, branch on `errorKey`.
A transport failure throws the same class with `errorKey === NETWORK_ERROR_KEY`.

The default `api` instance targets the same-origin proxy `/api`. Server
components have no origin to resolve a relative URL against and use
`createApiClient({ baseUrl: upstreamBaseUrl() })` instead — see
`lib/meta/fetch-meta.ts`.

### 3. `/api/*` — the same-origin proxy

`app/api/[...path]/route.ts` (logic in `lib/api/upstream.ts`) forwards
`/api/<anything>` to `${API_BASE_URL}/<anything>`, query string included, and
streams status and JSON body back. One origin means no CORS in production, the
RUN/IPE stays first-party from the browser's point of view, and the FastAPI port
need not be published.

Only `accept`, `accept-language` and `content-type` are forwarded upstream;
only `content-type` and `retry-after` come back. **Nothing in the forwarder logs
a request body**, and nothing may be added that does: bodies carry the student's
RUN/IPE (`/simulate`, `/recommend`) and the family's home address (`/geocode`).

This is the API forwarder, not the locale middleware — that lives in `proxy.ts`
at the project root (Next 16's renamed Middleware convention) and does not match
`/api/*`.

## Theme

`app/globals.css` holds the palette: accent `#1F6FEB`, background `#FFFFFF`,
secondary surface `#F6F7F9`, text `#16191D`, border `#E4E7EB`, radius `0.5rem`,
15px base text, system sans-serif. Light mode is the default and the only mode
in practice; dark tokens are defined under `.dark` but nothing toggles them yet.

`components/ui/` is generated by the shadcn CLI and is not hand-edited, with one
documented exception: `button.tsx` uses `rounded-full` throughout (a project-wide
pill-button choice). Re-apply that after regenerating the component.

## Layout

```
app/[locale]/            locale layout: <html lang>, header, brand, switcher
app/[locale]/(wizard)/   stepper + step guard + Back/Continue; the 4 steps;
                         error.tsx (localized boundary around the steps)
app/api/[...path]/       same-origin proxy to FastAPI
components/ui/           shadcn primitives (generated)
components/wizard/       stepper, step frame, nav, guard, step bodies
lib/api/                 openapi.json + generated schema.d.ts + typed client
lib/meta/                /meta fetched server-side, shared through context
lib/store/wizard.ts      zustand store (sessionStorage, partial persistence)
messages/{es,en}/        one JSON file per namespace, merged in index.ts
e2e/                     Playwright specs
```

Headings: the step title rendered by `components/wizard/step-page.tsx` is the
page's single `<h1>`. The application title in the header is a `<p>` brand
element, because it repeats on every route.

## Docker

`Dockerfile` builds this app in three stages — `deps` (pnpm install from the
lockfile), `builder` (`pnpm build`), `runner` (Next.js' standalone output) — and
the runtime image starts `node server.js` on port 3000 with no package manager
and no sources in it. That is what `output: "standalone"` in `next.config.ts` is
for; keep it, and keep the `next-intl` plugin wrapped around the config.

The build context is this directory:

```bash
docker build -t reco-chile-web .
docker run --rm -p 3000:3000 -e API_BASE_URL=http://host.docker.internal:8000 reco-chile-web
```

Normally both halves are started together from the repository root, where
`docker-compose.yml` wires this container to the FastAPI one and sets
`API_BASE_URL=http://api:8000`:

```bash
cd .. && docker compose up --build      # http://localhost:3000/es/student
```

`API_BASE_URL` is read at request time, not baked into the image, so the same
image runs against any backend origin. Nothing about the Python service reaches
the browser.

## Continuous integration

`../.github/workflows/ci.yml` runs on every push to `main` and on every pull
request. Two of its three jobs are this directory:

| Job   | Commands                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web` | `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm exec tsc --noEmit`, `pnpm test --run`, `pnpm build`                                                         |
| `e2e` | creates `../.venv` from `../requirements.txt` (the interpreter `playwright.config.ts` starts uvicorn with), `pnpm exec playwright install --with-deps chromium`, then `CI=1 pnpm e2e` |

Node is 22 (LTS) there and in `.nvmrc` / `.node-version`; `package.json` requires
`>=20` and pnpm comes from its `packageManager` field, so CI can never install a
different pnpm than you do.

Two details worth knowing before editing the workflow:

- pnpm 11 **swallows** everything after `--`, so flags are forwarded to a script
  without it (`pnpm test --run`, not `pnpm test -- --run`).
- Under `CI=1` the Playwright config switches to the `github` reporter,
  `retries: 2` and `reuseExistingServer: false`; the workflow adds the `html`
  reporter and uploads `playwright-report/` and `test-results/` when the job
  fails.
