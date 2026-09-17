/**
 * One localized sentence for a failed API call on step 4. The server already
 * localizes its own message from `?lang=`, so that string is preferred
 * verbatim; only a request that never arrived, or a response with no
 * envelope, falls back to the catalogue.
 */
import { ApiError, NETWORK_ERROR_KEY } from "@/lib/api";

type Translate = (key: string) => string;

export function apiErrorMessage(t: Translate, error: ApiError): string {
  if (error.errorKey === NETWORK_ERROR_KEY) {
    return t("errors.networkUnavailable");
  }
  return error.message.trim() !== "" ? error.message : t("errors.unexpected");
}
