/**
 * One localized sentence for a failed API call on step 4.
 *
 * The contract already returns a message localized by the
 * server from `?lang=`, so that string is preferred verbatim — re-translating
 * it in the browser would fork the wording. Only the two cases the server never
 * produced fall back to the catalogue: a request that never arrived
 * (`network_error`), and a response that carried no envelope at all.
 *
 * The RUN/IPE and the home address are request-side data and never appear in an
 * `ApiError`, so this is safe to render as-is.
 */
import { ApiError, NETWORK_ERROR_KEY, UNEXPECTED_ERROR_KEY } from "@/lib/api";

type Translate = (key: string) => string;

export function apiErrorMessage(t: Translate, error: ApiError): string {
  if (error.errorKey === NETWORK_ERROR_KEY) {
    return t("errors.networkUnavailable");
  }
  if (error.message.trim() !== "") return error.message;
  if (error.errorKey === UNEXPECTED_ERROR_KEY) return t("errors.unexpected");
  return t("errors.unexpected");
}
