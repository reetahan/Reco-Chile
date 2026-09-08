import { describe, expect, it } from "vitest";
import {
  ApiError,
  parseErrorEnvelope,
  toApiError,
  UNEXPECTED_ERROR_KEY,
} from "./errors";

describe("parseErrorEnvelope", () => {
  it("reads the contract's bare envelope", () => {
    expect(
      parseErrorEnvelope({
        error_key: "too_many_equivalence_orders",
        message: "Demasiadas combinaciones posibles.",
        params: { limit: 10000, orders: 40320 },
      }),
    ).toEqual({
      error_key: "too_many_equivalence_orders",
      message: "Demasiadas combinaciones posibles.",
      params: { limit: 10000, orders: 40320 },
    });
  });

  it("defaults params to an empty object when absent", () => {
    expect(
      parseErrorEnvelope({ error_key: "empty_wish_list", message: "…" }),
    ).toEqual({ error_key: "empty_wish_list", message: "…", params: {} });
  });

  it("unwraps a FastAPI-wrapped envelope", () => {
    expect(
      parseErrorEnvelope({
        detail: { error_key: "rate_limited", message: "Espera un momento." },
      }),
    ).toEqual({
      error_key: "rate_limited",
      message: "Espera un momento.",
      params: {},
    });
  });

  it("accepts Starlette's plain string detail", () => {
    expect(parseErrorEnvelope({ detail: "Not Found" })).toEqual({
      error_key: UNEXPECTED_ERROR_KEY,
      message: "Not Found",
      params: {},
    });
  });

  it("rejects anything that is not an envelope", () => {
    expect(parseErrorEnvelope(null)).toBeNull();
    expect(parseErrorEnvelope("<html>502</html>")).toBeNull();
    expect(parseErrorEnvelope([{ error_key: "x", message: "y" }])).toBeNull();
    expect(parseErrorEnvelope({ error_key: 7, message: "y" })).toBeNull();
    expect(parseErrorEnvelope({ error_key: "x" })).toBeNull();
  });
});

describe("toApiError", () => {
  it("carries status, key, message and params", () => {
    const error = toApiError(
      422,
      {
        error_key: "invalid_student_id",
        message: "El RUN no es válido.",
        params: { value_length: 9 },
      },
      "fallback",
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(ApiError.is(error)).toBe(true);
    expect(error.status).toBe(422);
    expect(error.errorKey).toBe("invalid_student_id");
    expect(error.message).toBe("El RUN no es válido.");
    expect(error.params).toEqual({ value_length: 9 });
    expect(error.name).toBe("ApiError");
  });

  it("falls back when the body is not an envelope", () => {
    const error = toApiError(
      500,
      null,
      "The service returned an unexpected response.",
    );
    expect(error.status).toBe(500);
    expect(error.errorKey).toBe(UNEXPECTED_ERROR_KEY);
    expect(error.message).toBe("The service returned an unexpected response.");
    expect(error.params).toEqual({});
  });

  it("is a real Error, so it survives throw/catch and instanceof", () => {
    try {
      throw toApiError(404, { detail: "Not Found" }, "fallback");
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error);
      expect(ApiError.is(caught)).toBe(true);
      expect((caught as ApiError).status).toBe(404);
    }
  });
});
