import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedPackage, initialReviews } from "../src/lib/review";
import { organiseLocally } from "../src/lib/claim";
import { parsePackage as prefilingParse } from "../cjts-prefiling/transfer.mjs";

const validPackage = {
  version: 2,
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
  assessment: { sctOptions: [{ groupId: "goods", label: "Defective Goods" }] },
};

/** Each case is [name, package, expected error substring or null if accepted]. */
const corpus: Array<[string, unknown, string | null]> = [
  ["a valid approved package", validPackage, null],
  [
    "a package without reviewed SCT subtypes",
    { ...validPackage, assessment: { sctOptions: [] } },
    "Malformed reviewed filing package",
  ],
  [
    "an unknown SCT subtype",
    { ...validPackage, assessment: { sctOptions: [{ groupId: "goods", label: "Invented" }] } },
    "Invalid reviewed SCT dispute subtype",
  ],
  [
    "an unsupported version",
    { ...validPackage, version: 1 },
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
  ["an oversized payload", `"${"界".repeat(666667)}"`, "Package is too large"],
];

test("transfer contract accepts and rejects the validation corpus", () => {
  for (const [name, input, expected] of corpus) {
    if (expected === null) assert.doesNotThrow(() => prefilingParse(input), name);
    else assert.throws(() => prefilingParse(input), (error: unknown) =>
      error instanceof Error && error.message.includes(expected), name);
  }
});

test("the importer accepts a full multilingual webpage export", () => {
  const fields = Object.fromEntries(
    ["claimant", "respondent", "summary", "outcome", "timeline", "caseNumber", "assessmentId"].map(
      (key) => [key, { value: "界".repeat(30000), review: "approved", provenance: "user" }],
    ),
  );
  const json = JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), userReviewed: true, fields, assessment: validPackage.assessment }, null, 2);
  assert.ok(Buffer.byteLength(json) > 350000);
  assert.deepEqual(prefilingParse(json).fields, fields);
});


test("webpage approved package survives JSON serialization into the CJTS helper", () => {
  const draft = organiseLocally({
    mode: "new", problem: "I paid for a laptop that was never delivered to me.",
    outcome: "Refund", evidence: [], consent: false,
  });
  draft.claimant = "陈美 / Mei Tan";
  draft.claimType = "Sale of goods";
  draft.amount = "1450";
  const reviews = initialReviews(draft, "user");
  for (const key of ["claimant", "claimType", "amount"] as const)
    reviews[key]!.review = "approved";
  const exported = approvedPackage(draft, reviews, [{ groupId: "goods", label: "Defective Goods" }]);
  const json = JSON.stringify(exported, null, 2);
  for (const parse of [prefilingParse]) {
    assert.deepEqual(parse(json), exported);
    assert.equal(parse(json).fields.summary, undefined);
  }
});
