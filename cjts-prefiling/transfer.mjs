/**
 * Shared wire contract. No case narrative, evidence, or research outside
 * approved fields.
 *
 * MIRRORED FILE — this exact content also lives at `cjts-prefiling/transfer.mjs`.
 * Each unpacked extension is loaded independently under its own
 * `chrome-extension://` origin and cannot import across folders, and there is no
 * build step, so the contract is duplicated on disk by necessity. The copies
 * previously drifted (a version-2 package reported two different errors), so
 * `tests/transfer-parity.test.ts` fails if they stop being byte-identical.
 * Edit one, copy it to the other.
 */
export const filingFields = Object.freeze({
  claimant: "Claimant particulars",
  respondent: "Respondent particulars",
  amount: "Claim amount",
  claimType: "Claim category",
  summary: "Description of claim",
  outcome: "Requested outcome",
  incidentDate: "Cause-of-action date",
  timeline: "Chronology",
  caseNumber: "Existing case reference",
  assessmentId: "Pre-filing assessment ID",
});
export function validField(key, value) {
  if (
    !Object.hasOwn(filingFields, key) ||
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 30000
  )
    return false;
  if (key === "amount")
    return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
  if (key === "incidentDate")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (key === "claimType")
    return [
      "Sale of goods",
      "Provision of services",
      "Residential tenancy",
      "Property damage",
      "Unfair practice",
      "Motor vehicle deposit",
      "Other",
    ].includes(value);
  return true;
}
export function parsePackage(input) {
  if (typeof input === "string" && input.length > 350000)
    throw new Error("Package is too large.");
  let data;
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("Choose a valid Clearclaim JSON package.");
  }
  if (!data || data.version !== 1)
    throw new Error("Unsupported transfer version. Expected version 1.");
  if (
    Object.keys(data).some(
      (k) => !["version", "generatedAt", "userReviewed", "fields"].includes(k),
    ) ||
    data.userReviewed !== true ||
    typeof data.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(data.generatedAt)) ||
    new Date(data.generatedAt).toISOString() !== data.generatedAt ||
    !data.fields ||
    typeof data.fields !== "object" ||
    Array.isArray(data.fields)
  )
    throw new Error("Malformed reviewed filing package.");
  const entries = Object.entries(data.fields);
  if (!entries.length || entries.length > Object.keys(filingFields).length)
    throw new Error("No approved fields, or too many fields.");
  for (const [key, field] of entries) {
    if (
      !field ||
      typeof field !== "object" ||
      Object.keys(field).some(
        (k) => !["value", "review", "provenance"].includes(k),
      ) ||
      field.review !== "approved" ||
      ![
        "user",
        "evidence",
        "ai-organised",
        "official-source",
        "unknown",
      ].includes(field.provenance) ||
      !validField(key, field.value)
    )
      throw new Error(`Invalid or unapproved field: ${key}`);
  }
  return data;
}
