import { describe, expect, it } from "vitest";

import en from "@/messages/en";
import es from "@/messages/es";
import { routing } from "@/i18n/routing";

/**
 * Contract for `messages/{es,en}/*.json`.
 *
 * Key scheme:
 * - `app`, `steps`, `student`, `list`, `result`, `improve` hold UI copy under
 * semantic ids.
 * carried over from `sae_app/i18n.py` by `scripts/extract-translations.py`

 * - `errors` mixes two kinds of id on purpose: `snake_case` ids are the exact
 * `error_key` values the API returns, so a 422 can be special-cased
 * with `t(\`errors.${error_key}\`)`; `camelCase` ids are client-side messages
 * the API never sends. Their placeholders (`{program_id}`, `{n}`, `{limit}`,
 * `{error}`, `{status}`) are the API's own `params` names for the same
 * reason.
 * - `enums.*` is keyed by the *wire value* ("With PIE", "priority_sibling",
 * "Unmatched"), never by a re-invented slug, so `t(\`enums.pie.${value}\`)`
 * is a direct lookup and a renamed constant fails loudly here.
 *
 * A missing key is not an error at runtime — next-intl falls back to the id —
 * so drift between the two catalogues has to be caught by a test.
 */

type MessageNode = string | { [key: string]: MessageNode };

function flatten(node: MessageNode, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function entries(node: MessageNode, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node).flatMap(([key, child]) =>
    entries(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** `{name}` placeholders, ignoring ICU escapes we do not use. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)[^}]*\}/g)].map((m) => m[1]).sort();
}

const esKeys = flatten(es as MessageNode);
const enKeys = flatten(en as MessageNode);

describe("message catalogues", () => {
  it("covers every configured locale", () => {
    expect([...routing.locales].sort()).toEqual(["en", "es"]);
    expect(routing.defaultLocale).toBe("es");
  });

  it("has identical key sets in es and en", () => {
    const missingInEn = esKeys.filter((key) => !enKeys.includes(key));
    const missingInEs = enKeys.filter((key) => !esKeys.includes(key));

    expect({ missingInEn, missingInEs }).toEqual({
      missingInEn: [],
      missingInEs: [],
    });
    expect(esKeys.length).toBe(enKeys.length);
    expect(esKeys.length).toBeGreaterThan(0);
  });

  it("declares the namespaces the wizard uses", () => {
    for (const namespace of [
      "app",
      "steps",
      "student",
      "list",
      "result",
      "improve",
      "errors",
      "enums",
    ]) {
      expect(Object.keys(es)).toContain(namespace);
      expect(Object.keys(en)).toContain(namespace);
    }
  });

  it("has no blank message", () => {
    for (const [key, value] of entries(es as MessageNode)) {
      expect(value.trim(), `es.${key}`).not.toBe("");
    }
    for (const [key, value] of entries(en as MessageNode)) {
      expect(value.trim(), `en.${key}`).not.toBe("");
    }
  });

  it("uses the same placeholders in both languages", () => {
    const enByKey = new Map(entries(en as MessageNode));

    for (const [key, esValue] of entries(es as MessageNode)) {
      const enValue = enByKey.get(key);
      expect(enValue, `en is missing ${key}`).toBeDefined();
      expect(placeholders(esValue), key).toEqual(placeholders(enValue!));
    }
  });

  it("keeps the enum keys aligned with the API wire values", () => {
    // Mirrors sae_app/constants.py — the `*_FILTER_OPTIONS` lists, `TIERS`,
    // and the `Unmatched` outcome. Renaming a constant server-side without
    // updating the catalogue must fail here rather than silently render the
    // raw English value to a Spanish-speaking family.
    const expected: Record<string, string[]> = {
      track: ["General", "Specialized"],
      specialty: [
        "Agriculture",
        "Metalworking and mechanics",
        "Electricity",
        "Food services",
        "Construction",
        "Technology and communications",
      ],
      gender: ["Mixed", "Boys", "Girls"],
      schoolDay: ["Full day", "Morning", "Afternoon"],
      rurality: ["Urban", "Rural"],
      pie: ["With PIE", "Without PIE"],
      pace: ["With PACE", "Without PACE"],
      payment: [
        "Free",
        "$1,000–$10,000",
        "$10,001–$25,000",
        "$25,001–$50,000",
        "$50,001–$100,000",
        "More than $100,000",
        "No information",
      ],
      religious: [
        "Secular",
        "Catholic",
        "Evangelical",
        "Other",
        "No information",
      ],
      priorityTier: [
        "priority_sibling",
        "priority_student",
        "priority_parent_civil_servant",
        "priority_ex_student",
        "no_priority",
      ],
      outcome: ["Unmatched"],
      attentionLevel: ["low", "moderate", "high"],
      riskLevel: ["green", "orange", "red", "gray"],
    };

    for (const [group, values] of Object.entries(expected)) {
      for (const catalogue of [es, en] as unknown as Array<
        Record<string, Record<string, Record<string, string>>>
      >) {
        expect(Object.keys(catalogue.enums[group]).sort()).toEqual(
          [...values].sort(),
        );
      }
    }
  });

  it("translates the Spanish enum values away from the wire value", () => {
    // A Spanish catalogue that just echoes the English code would pass the key
    // check above; these are the values a family actually reads.
    const enums = (
      es as unknown as { enums: Record<string, Record<string, string>> }
    ).enums;
    expect(enums.pie["With PIE"]).toBe("Con PIE");
    expect(enums.outcome.Unmatched).toBe("Sin cupo");
    expect(enums.priorityTier.no_priority).toBe("Sin prioridad");
    expect(enums.payment.Free).toBe("Gratuito");
  });
});
