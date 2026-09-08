"""Translations and the ``t()`` helper for API error messages.

English source strings *are* the translation keys (see CONTRIBUTING.md, "i18n
contract"): ``t("Some English text")`` looks the string up in
``TRANSLATIONS[lang]`` and falls back to the key unchanged when missing.

The active language is request-scoped, held in a :class:`contextvars.ContextVar`
so that concurrent FastAPI requests never share a mutable global. Callers that
know their language explicitly should pass ``lang=`` instead of relying on the
ambient value.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Iterator, Optional


DEFAULT_LANGUAGE = "es"
SUPPORTED_LANGUAGES = ("es", "en")

CURRENT_LANGUAGE: contextvars.ContextVar[str] = contextvars.ContextVar(
    "sae_app_current_language", default=DEFAULT_LANGUAGE
)


TRANSLATIONS = {
    "en": {
        "priority_sibling": "Sibling priority",
        "priority_student": "Priority-student quota",
        "priority_parent_civil_servant": "Civil-servant child priority",
        "priority_ex_student": "Former-student priority",
        "priority_already_registered": "Already-enrolled priority",
        "no_priority": "No priority",
    },
    "es": {
        "No valid wish could be matched to the program data. Check the current preference list.": "No se pudo vincular ninguna preferencia válida con los datos de programas. Revisa la lista de preferencias actual.",
        "A wish in the equivalence-class test could not be matched to the precomputed availability values. Check the current preference list.": "Una preferencia en la prueba de clases de equivalencia no pudo vincularse con los valores de disponibilidad precalculados. Revisa la lista de preferencias actual.",
        "All regions": "Todas las regiones",
        "Gender composition": "Composición por género",
        "The equivalence classes generate {n:,} strict orders. This is above the exact-evaluation limit of {limit:,}. Split large equivalence groups into smaller groups, then run the simulation again.": "Las clases de equivalencia generan {n:,} órdenes estrictos. Esto supera el límite de evaluación exacta de {limit:,}. Divide los grupos de equivalencia grandes en grupos más pequeños y vuelve a ejecutar la simulación.",
        "Unmatched risk": "Riesgo de quedar sin cupo",
        "Unmatched": "Sin cupo",
        "School name unavailable": "Nombre del establecimiento no disponible",
        "General": "General",
        "Specialized": "Técnico-profesional",
        "Agriculture": "Agricultura",
        "Metalworking and mechanics": "Metalmecánica y mecánica",
        "Electricity": "Electricidad",
        "Food services": "Servicios de alimentación",
        "Construction": "Construcción",
        "Technology and communications": "Tecnología y comunicaciones",
        "Mixed": "Mixto",
        "Boys": "Hombres",
        "Girls": "Mujeres",
        "Full day": "Jornada completa",
        "Morning": "Mañana",
        "Afternoon": "Tarde",
        "Urban": "Urbano",
        "Rural": "Rural",
        "With PIE": "Con PIE",
        "Without PIE": "Sin PIE",
        "With PACE": "Con PACE",
        "Without PACE": "Sin PACE",
        "Free": "Gratuito",
        "$1,000–$10,000": "$1.000–$10.000",
        "$10,001–$25,000": "$10.001–$25.000",
        "$25,001–$50,000": "$25.001–$50.000",
        "$50,001–$100,000": "$50.001–$100.000",
        "More than $100,000": "Más de $100.000",
        "No information": "Sin información",
        "Secular": "Laico",
        "Catholic": "Católico",
        "Evangelical": "Evangélico",
        "Other": "Otro",
        "Unknown": "Desconocido",
        "Unknown region": "Región desconocida",
        "priority_sibling": "Prioridad por hermano/a",
        "priority_student": "Estudiante prioritario",
        "priority_parent_civil_servant": "Hijo/a de funcionario/a",
        "priority_ex_student": "Exalumno/a",
        "no_priority": "Sin prioridad",
        "Enter the student RUN/IPE before running the MTB calculation.": "Ingresa el RUN/IPE del estudiante antes de ejecutar el cálculo MTB.",
        "Invalid RUN format. Enter the numeric body plus its check digit, for example 12.345.678-5. Dots and the hyphen are optional.": "Formato RUN inválido. Ingresa el cuerpo numérico y su dígito verificador, por ejemplo 12.345.678-5. Los puntos y el guion son opcionales.",
        "The RUN check digit is invalid.": "El dígito verificador del RUN es inválido.",
        "Invalid IPE format. Enter the nine-digit IPE plus its numeric verifier digit, for example 111222333-4. Dots and the hyphen are optional.": "Formato IPE inválido. Ingresa el IPE de nueve dígitos y su dígito verificador numérico, por ejemplo 111222333-4. Los puntos y el guion son opcionales.",
        "Add at least one valid wish.": "Agrega al menos una preferencia válida.",
        "The request could not be read. Check the submitted fields.": "No se pudo leer la solicitud. Revisa los campos enviados.",
        "The program {program_id} appears more than once in the list.": "El programa {program_id} aparece más de una vez en la lista.",
        "Unknown program identifier: {program_id}.": "Identificador de programa desconocido: {program_id}.",
        "Too many address lookups. Wait a moment and try again.": "Demasiadas búsquedas de dirección. Espera un momento y vuelve a intentarlo.",
        "Recommendations could not be computed because some program data are invalid.": "No se pudieron calcular las recomendaciones porque algunos datos de programas son inválidos.",
        "Program type": "Tipo de programa",
        "Specialty area": "Área de especialidad",
        "School day": "Jornada escolar",
        "Rurality": "Ruralidad",
        "PIE": "PIE",
        "PACE": "PACE",
        "Enrollment fee": "Matrícula",
        "Monthly fee": "Mensualidad",
        "Religious orientation": "Orientación religiosa",
        "Criterion": "Criterio",
        "Dominant value in current list": "Valor dominante en la lista actual",
        "Share": "Proporción",
        "Coverage": "Cobertura",
        "Automatic weight": "Peso automático",
        "Recommendation score": "Score de recomendación",
        "Straight-line distance from current list (km)": "Distancia en línea recta desde la lista actual (km)",
        "School": "Establecimiento",
        "Commune": "Comuna",
        "Region": "Región",
        "Program details": "Detalles del programa",
        "Capacity": "Cupos",
        "Applicants / seat": "Postulantes / cupo",
        "No reliable coordinate": "Sin coordenada confiable",
        "commune coordinate": "coordenada de comuna",
        "region approximation": "aproximación regional",
        "Chance if considered": "Probabilidad si es considerado",
        "Marginal unmatched-risk reduction": "Reducción marginal del riesgo sin cupo",
        "Projected unmatched risk after append": "Riesgo sin cupo proyectado después de agregar",
        "Estimated MTB rank": "Ranking MTB estimado",
        "Straight-line distance from home (km)": "Distancia en línea recta desde el hogar (km)",
        "No address entered.": "No se ingresó ninguna dirección.",
        "No result found for this address in Chile.": "No se encontró ningún resultado para esta dirección en Chile.",
        "The geocoded result is outside Chile or has invalid coordinates.": "El resultado geocodificado está fuera de Chile o tiene coordenadas inválidas.",
        "Geocoding service returned status {status}.": "El servicio de geocodificación devolvió el estado {status}.",
        "Could not reach the geocoding service: {error}": "No se pudo contactar el servicio de geocodificación: {error}",
        'The geocoder found the street, but could not confirm the exact street number. Distances are computed from an approximate street-level location.': 'El geocodificador encontró la calle, pero no pudo confirmar el número exacto. Las distancias se calculan desde una ubicación aproximada a nivel de calle.',
        'The geocoder found the street, but not an exact address point. Distances are computed from an approximate street-level location.': 'El geocodificador encontró la calle, pero no un punto de dirección exacto. Las distancias se calculan desde una ubicación aproximada a nivel de calle.',
        'The geocoder could only identify the city or municipality. Distances are approximate.': 'El geocodificador solo pudo identificar la ciudad o comuna. Las distancias son aproximadas.',
        'The geocoder returned only an approximate location. Distances should be interpreted carefully.': 'El geocodificador devolvió solo una ubicación aproximada. Las distancias deben interpretarse con cuidado.',
        "Could not read the geocoding response: {error}": "No se pudo leer la respuesta de geocodificación: {error}",
    },
}


def set_language(lang: Optional[str]) -> contextvars.Token:
    """Set the ambient language for the current context; returns a reset token."""
    return CURRENT_LANGUAGE.set(normalize_language(lang))


def reset_language(token: contextvars.Token) -> None:
    """Restore the ambient language to the value captured by ``token``."""
    CURRENT_LANGUAGE.reset(token)


def get_language() -> str:
    """Return the ambient language for the current context."""
    return CURRENT_LANGUAGE.get()


@contextmanager
def language(lang: Optional[str]) -> Iterator[str]:
    """Context manager scoping the ambient language to ``lang``."""
    token = set_language(lang)
    try:
        yield get_language()
    finally:
        reset_language(token)


def normalize_language(lang: Optional[str]) -> str:
    """Map an arbitrary language request onto a supported language code."""
    if lang is None:
        return DEFAULT_LANGUAGE
    code = str(lang).strip().lower().replace("_", "-")
    if not code:
        return DEFAULT_LANGUAGE
    if code in SUPPORTED_LANGUAGES:
        return code
    primary = code.split("-", 1)[0]
    if primary in SUPPORTED_LANGUAGES:
        return primary
    return DEFAULT_LANGUAGE


def t(key: str, *, lang: Optional[str] = None, **kwargs) -> str:
    """Translate a user-facing string while leaving unknown keys unchanged.

    ``lang`` is keyword-only so it can never collide with a ``{...}`` format
    placeholder passed through ``**kwargs``; when omitted the ambient
    request-scoped language (``CURRENT_LANGUAGE``) is used.
    """
    active = CURRENT_LANGUAGE.get() if lang is None else normalize_language(lang)
    text = TRANSLATIONS.get(active, {}).get(str(key), str(key))
    return text.format(**kwargs) if kwargs else text

