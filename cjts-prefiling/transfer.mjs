const allowedKeys = new Set([
  "claimant", "respondent", "amount", "claimType", "summary", "outcome",
  "incidentDate", "timeline", "caseNumber", "assessmentId",
]);
const provenances = new Set([
  "user", "evidence", "ai-organised", "official-source", "unknown",
]);
const claimTypes = new Set([
  "Sale of goods",
  "Provision of services",
  "Residential tenancy",
  "Property damage",
  "Unfair practice",
  "Motor vehicle deposit",
  "Other",
]);

export function parsePackage(input) {
  if (typeof input === "string" && input.length > 350000)
    throw new Error("Package is too large.");
  let data;
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("Choose a valid Clearclaim JSON package.");
  }
  if (
    !data ||
    data.version !== 1 ||
    data.userReviewed !== true ||
    Object.keys(data).some(
      (key) => !["version", "generatedAt", "userReviewed", "fields"].includes(key),
    ) ||
    typeof data.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(data.generatedAt)) ||
    new Date(data.generatedAt).toISOString() !== data.generatedAt ||
    !data.fields ||
    typeof data.fields !== "object" ||
    Array.isArray(data.fields)
  )
    throw new Error("Malformed reviewed filing package.");
  const entries = Object.entries(data.fields);
  if (!entries.length || entries.length > allowedKeys.size)
    throw new Error("No approved fields, or too many fields.");
  for (const [key, field] of entries) {
    if (
      !allowedKeys.has(key) ||
      !field ||
      typeof field !== "object" ||
      Object.keys(field).some(
        (name) => !["value", "review", "provenance"].includes(name),
      ) ||
      field.review !== "approved" ||
      !provenances.has(field.provenance) ||
      typeof field.value !== "string" ||
      !field.value.trim() ||
      field.value.length > 30000
    )
      throw new Error(`Invalid or unapproved field: ${key}`);
  }
  if (
    data.fields.amount &&
    (!/^\d+(?:\.\d{1,2})?$/.test(data.fields.amount.value) ||
      Number(data.fields.amount.value) <= 0)
  )
    throw new Error("Invalid or unapproved field: amount");
  if (
    data.fields.incidentDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(data.fields.incidentDate.value) ||
      !Number.isFinite(Date.parse(data.fields.incidentDate.value)) ||
      new Date(data.fields.incidentDate.value).toISOString().slice(0, 10) !==
        data.fields.incidentDate.value)
  )
    throw new Error("Invalid or unapproved field: incidentDate");
  if (
    data.fields.claimType &&
    !claimTypes.has(data.fields.claimType.value)
  )
    throw new Error("Invalid or unapproved field: claimType");
  return data;
}
