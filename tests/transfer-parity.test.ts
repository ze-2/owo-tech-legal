import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePackage as extensionParse } from "../extension/shared/transfer.mjs";
import { parsePackage as prefilingParse } from "../cjts-prefiling/transfer.mjs";

/**
 * The two unpacked extensions each need their own on-disk copy of the transfer
 * contract: they load under separate chrome-extension:// origins and there is
 * no build step. The copies had already drifted — a version-2 package reported
 * "Unsupported transfer version. Expected version 1." in one and "Malformed
 * reviewed filing package." in the other, and only the first was ever asserted.
 * These tests are what keep them honest.
 */

const paths = {
  extension: "../extension/shared/transfer.mjs",
  prefiling: "../cjts-prefiling/transfer.mjs",
};

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("both extensions ship byte-identical transfer contracts", () => {
  assert.equal(
    read(paths.prefiling),
    read(paths.extension),
    "cjts-prefiling/transfer.mjs has diverged from extension/shared/transfer.mjs — copy one over the other",
  );
});

const validPackage = {
  version: 1,
  generatedAt: new Date().toISOString(),
  userReviewed: true,
  fields: {
    claimant: { value: "Alex Tan", review: "approved", provenance: "user" },
    amount: { value: "1450", review: "approved", provenance: "user" },
    claimType: {
      value: "Sale of goods",
      review: "approved",
      provenance: "user",
    },
  },
};

/** Each case is [name, package, expected error substring or null if accepted]. */
const corpus: Array<[string, unknown, string | null]> = [
  ["a valid approved package", validPackage, null],
  [
    "an unsupported version",
    { ...validPackage, version: 2 },
    "Unsupported transfer version",
  ],
  ["a null package", null, "Unsupported transfer version"],
  [
    "an unreviewed package",
    { ...validPackage, userReviewed: false },
    "Malformed reviewed filing package",
  ],
  [
    "an unexpected top-level key",
    { ...validPackage, notes: "extra" },
    "Malformed reviewed filing package",
  ],
  [
    "a non-ISO generatedAt",
    { ...validPackage, generatedAt: "yesterday" },
    "Malformed reviewed filing package",
  ],
  ["no fields", { ...validPackage, fields: {} }, "No approved fields"],
  [
    "an unapproved field",
    {
      ...validPackage,
      fields: {
        claimant: { value: "Alex Tan", review: "unreviewed", provenance: "user" },
      },
    },
    "Invalid or unapproved field: claimant",
  ],
  [
    "an unknown field key",
    {
      ...validPackage,
      fields: {
        secret: { value: "x", review: "approved", provenance: "user" },
      },
    },
    "Invalid or unapproved field: secret",
  ],
  [
    "an unknown provenance",
    {
      ...validPackage,
      fields: {
        claimant: { value: "Alex Tan", review: "approved", provenance: "guess" },
      },
    },
    "Invalid or unapproved field: claimant",
  ],
  [
    "a formatted amount",
    {
      ...validPackage,
      fields: {
        amount: { value: "SGD 1,450", review: "approved", provenance: "user" },
      },
    },
    "Invalid or unapproved field: amount",
  ],
  [
    "a zero amount",
    {
      ...validPackage,
      fields: {
        amount: { value: "0", review: "approved", provenance: "user" },
      },
    },
    "Invalid or unapproved field: amount",
  ],
  [
    "a non-ISO incident date",
    {
      ...validPackage,
      fields: {
        incidentDate: {
          value: "14 March 2026",
          review: "approved",
          provenance: "user",
        },
      },
    },
    "Invalid or unapproved field: incidentDate",
  ],
  [
    "an impossible incident date",
    {
      ...validPackage,
      fields: {
        incidentDate: {
          value: "2026-02-31",
          review: "approved",
          provenance: "user",
        },
      },
    },
    "Invalid or unapproved field: incidentDate",
  ],
  [
    "a free-text claim category",
    {
      ...validPackage,
      fields: {
        claimType: {
          value: "Consumer goods refund",
          review: "approved",
          provenance: "user",
        },
      },
    },
    "Invalid or unapproved field: claimType",
  ],
  [
    "a string field instead of an object",
    { ...validPackage, fields: { claimant: "Alex Tan" } },
    "Invalid or unapproved field: claimant",
  ],
  ["malformed JSON text", "{not json", "Choose a valid Clearclaim JSON package"],
  ["an oversized payload", `"${"x".repeat(350001)}"`, "Package is too large"],
];

test("both contracts agree on every accept and reject", () => {
  for (const [name, input, expected] of corpus) {
    const results = [extensionParse, prefilingParse].map((parse) => {
      try {
        parse(input);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    assert.equal(
      results[0],
      results[1],
      `the two contracts disagree on ${name}: ${results[0]} vs ${results[1]}`,
    );
    if (expected === null) {
      assert.equal(results[0], null, `${name} should be accepted`);
    } else {
      assert.ok(
        results[0]?.includes(expected),
        `${name} should be rejected with "${expected}", got "${results[0]}"`,
      );
    }
  }
});
