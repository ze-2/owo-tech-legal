import { z } from "zod";

export const claimTypes = [
  "Not sure yet",
  "Sale of goods",
  "Provision of services",
  "Residential tenancy",
  "Property damage",
  "Unfair practice",
  "Motor vehicle deposit",
  "Other",
] as const;
export const orderTypes = [
  {
    name: "Money order",
    description: "Payment of a specified sum by a deadline.",
  },
  {
    name: "Work order",
    description:
      "Rectify defects, replace goods, or put deficient services right.",
  },
  {
    name: "Vacant possession",
    description:
      "For a landlord claiming unpaid rent: require the tenant to leave.",
  },
  {
    name: "Consent order",
    description: "Record a settlement agreed by the parties.",
  },
  {
    name: "Default order",
    description: "An order following a party’s absence from a court session.",
  },
  {
    name: "Discontinuance order",
    description:
      "End proceedings because the claim is outside SCT jurisdiction.",
  },
  { name: "Transfer order", description: "Move a claim to another court." },
  {
    name: "Dismissal",
    description: "Dismiss all or part of a claim, including for lack of merit.",
  },
];

export const evidenceSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(255),
  size: z
    .number()
    .min(0)
    .max(10 * 1024 * 1024),
  type: z.string().max(150),
  text: z.string().max(30000),
  note: z.string().max(2000),
  status: z.enum(["extracted", "description-needed", "unreadable"]),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const intakeSchema = z
  .object({
    mode: z.enum(["new", "existing"]),
    problem: z
      .string()
      .trim()
      .min(
        30,
        "Tell us a little more about what happened (at least 30 characters).",
      )
      .max(30000),
    outcome: z.string().trim().max(5000),
    evidence: z.array(evidenceSchema).max(10),
    consent: z.boolean(),
  })
  .refine((data) => data.mode === "existing" || data.outcome.length >= 5, {
    message: "Describe the outcome you want.",
    path: ["outcome"],
  });
export type Intake = z.infer<typeof intakeSchema>;

export const draftSchema = z.object({
  claimant: z.string().max(2000),
  respondent: z.string().max(2000),
  claimType: z.enum(claimTypes),
  incidentDate: z.string().max(30),
  amount: z.string().max(40),
  summary: z.string().max(30000),
  timeline: z.string().max(12000),
  outcome: z.string().max(5000),
  opposingView: z.string().max(5000),
  respondentInSingapore: z.enum(["unknown", "yes", "no"]),
  consentToHigherLimit: z.boolean(),
  claimantType: z.enum(["individual", "entity"]),
  assessmentId: z.string().max(100),
  caseNumber: z.string().max(100),
});
export type Draft = z.infer<typeof draftSchema>;
export type Citation = { title: string; url: string };
export type ResearchSection = {
  id: string;
  title: string;
  query: string;
  status: "live" | "reference" | "unavailable";
  guidance: string;
  counterpoint: string;
  missingInfo: string;
  sources: Citation[];
  fieldSources: Record<string, Citation[]>;
  error?: string;
};
export type Research = {
  sections: ResearchSection[];
  retrievedAt: string;
  mode: "live" | "reference" | "partial";
};

function labelled(text: string, labels: string) {
  // Match lines like "Claimant: Alex Tan". Labels are caller-controlled constants.
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${labels})\\s*:\\s*([^\\n]+)`,
    "i",
  );
  return text.match(pattern)?.[1]?.trim() ?? "";
}

// Human-facing amounts accept "2400" or "2400.50" after currency symbols are stripped.
const PLAIN_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PREFIX_PATTERN = /(?:S\$|SGD|\$|,)/gi;

/**
 * Field-level coercions shared by local extraction and model output. Models on
 * providers without enforced structured output return a free-text category, a
 * formatted amount ("SGD 1,450") or a written date ("14 March 2026"); a single
 * unusable field must not discard the rest of an otherwise good draft, so each
 * one falls back to this app's existing "unknown" value instead of throwing.
 */
export function normalizeClaimType(value: unknown): (typeof claimTypes)[number] {
  if (typeof value !== "string") return "Not sure yet";
  const candidate = value.trim().toLowerCase();
  return (
    claimTypes.find((type) => type.toLowerCase() === candidate) ?? "Not sure yet"
  );
}

/** Strip currency symbols and separators; blank anything still not a plain amount. */
export function normalizeAmount(value: unknown): string {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  const stripped = raw.replace(CURRENCY_PREFIX_PATTERN, "").trim();
  return PLAIN_AMOUNT_PATTERN.test(stripped) ? stripped : "";
}

/**
 * Keep an explicit ISO date, blank everything else. Deliberately does not parse
 * written dates: guessing an exact date the user never stated is the failure
 * mode guardModelDate exists to prevent.
 */
export function normalizeIsoDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return ISO_DATE_PATTERN.test(trimmed) ? trimmed : "";
}

// SCT limits and filing clock. Confirm against the official guide; not a legal finding.
const STANDARD_CLAIM_LIMIT = 20000;
const CONSENTED_CLAIM_LIMIT = 30000;
const SINGAPORE_TIME_ZONE = "Asia/Singapore";
const FILING_WINDOW_YEARS = 2;

/** Conservative offline extraction: keep the entire account, only populate explicit labels. */
export function organiseLocally(intake: Intake): Draft {
  const text = intake.problem;
  return {
    claimant: labelled(text, "Claimant|Your name"),
    respondent: labelled(text, "Respondent|Other party"),
    claimType: normalizeClaimType(labelled(text, "Claim type|Category")),
    incidentDate: normalizeIsoDate(
      labelled(text, "Incident date|Date of breach|Cause of action date"),
    ),
    amount: normalizeAmount(labelled(text, "Claim amount|Amount claimed|Amount")),
    summary: text,
    timeline: labelled(text, "Timeline|Chronology"),
    outcome: intake.outcome || labelled(text, "Outcome|Remedy|Relief sought"),
    opposingView: "",
    respondentInSingapore: "unknown",
    consentToHigherLimit: false,
    claimantType: "individual",
    assessmentId: labelled(text, "Pre-filing assessment ID|Assessment ID"),
    caseNumber: labelled(text, "Case number|Claim number|Case reference"),
  };
}

export type Check = {
  title: string;
  detail: string;
  level: "check" | "attention" | "unknown";
};

function checkClaimAmount(draft: Draft): Check {
  const amount = PLAIN_AMOUNT_PATTERN.test(draft.amount)
    ? Number(draft.amount)
    : NaN;
  const limit = draft.consentToHigherLimit
    ? CONSENTED_CLAIM_LIMIT
    : STANDARD_CLAIM_LIMIT;

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      title: "Claim value",
      detail: "Confirm the total value, including any non-monetary remedy.",
      level: "unknown",
    };
  }
  if (amount > limit) {
    const needsConsent = amount <= CONSENTED_CLAIM_LIMIT;
    return {
      title: "Claim value needs attention",
      detail: needsConsent
        ? "Above S$20,000: both parties need to sign a Memorandum of Consent."
        : "Above the S$30,000 maximum. Review your options before filing.",
      level: "attention",
    };
  }
  const limitLabel = draft.consentToHigherLimit ? "consented " : "standard ";
  return {
    title: "Within the monetary limit",
    detail: `S$${amount.toLocaleString("en-SG")} against the ${limitLabel}limit. Other conditions still apply.`,
    level: "check",
  };
}

function checkFilingDate(draft: Draft, today = new Date()): Check {
  const todayInSingapore = today.toLocaleDateString("en-CA", {
    timeZone: SINGAPORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.incidentDate);
  const parsedDate = new Date(`${draft.incidentDate}T00:00:00Z`);
  const isValidDate =
    Boolean(parts) &&
    Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === draft.incidentDate;

  if (!isValidDate || draft.incidentDate > todayInSingapore) {
    return {
      title: "Confirm the relevant date",
      detail:
        "Use the event giving rise to the claim; it may differ from the purchase date.",
      level: "unknown",
    };
  }
  const anniversary = parts
    ? `${Number(parts[1]) + FILING_WINDOW_YEARS}-${parts[2]}-${parts[3]}`
    : "";
  if (todayInSingapore > anniversary) {
    return {
      title: "Time limit needs attention",
      detail:
        "The date supplied appears more than two years ago. Verify the cause-of-action date promptly.",
      level: "attention",
    };
  }
  return {
    title: "Review the two-year filing period",
    detail:
      "The supplied date is within two years. Confirm the actual deadline in CJTS; this is not a final assessment.",
    level: "check",
  };
}

function checkServiceLocation(draft: Draft): Check {
  if (draft.respondentInSingapore === "yes") {
    return {
      title: "Service in Singapore",
      detail: "You indicated the respondent can be served in Singapore.",
      level: "check",
    };
  }
  if (draft.respondentInSingapore === "no") {
    return {
      title: "Service in Singapore",
      detail: "SCT claims cannot be served outside Singapore.",
      level: "attention",
    };
  }
  return {
    title: "Service in Singapore",
    detail: "Confirm the respondent’s location and address for service.",
    level: "unknown",
  };
}

function checkClaimCategory(draft: Draft): Check {
  const needsChoice =
    draft.claimType === "Not sure yet" || draft.claimType === "Other";
  return {
    title: "Claim type and exceptions",
    detail: needsChoice
      ? "Choose a category and check the full jurisdiction requirements."
      : `Review the conditions for ${draft.claimType.toLowerCase()}, including any exclusions.`,
    level: "unknown",
  };
}

export function eligibilityChecks(draft: Draft, today = new Date()): Check[] {
  return [
    checkClaimAmount(draft),
    checkFilingDate(draft, today),
    checkServiceLocation(draft),
    checkClaimCategory(draft),
  ];
}

// Filing-fee bands from the SCT schedule: flat fees up to S$10k, then a percentage.
const FEE_BANDS = [
  { max: 5000, individual: 10, entity: 50 },
  { max: 10000, individual: 20, entity: 100 },
] as const;

export function filingFee(draft: Draft): number | null {
  if (!PLAIN_AMOUNT_PATTERN.test(draft.amount)) return null;
  const amount = Number(draft.amount);
  const limit = draft.consentToHigherLimit
    ? CONSENTED_CLAIM_LIMIT
    : STANDARD_CLAIM_LIMIT;
  if (amount <= 0 || amount > limit) return null;
  const isIndividual = draft.claimantType === "individual";
  for (const band of FEE_BANDS) {
    if (amount <= band.max) return isIndividual ? band.individual : band.entity;
  }
  return amount * (isIndividual ? 0.01 : 0.03);
}

export function missingFields(draft: Draft, evidence: Evidence[]): string[] {
  const missing: string[] = [];
  if (!draft.claimant.trim()) missing.push("Your details");
  if (!draft.respondent.trim()) missing.push("Respondent’s details");
  if (!draft.incidentDate) missing.push("Cause-of-action date");
  if (!draft.amount || Number(draft.amount) <= 0)
    missing.push("Total claim value");
  if (draft.claimType === "Not sure yet") missing.push("Type of claim");
  if (!draft.outcome.trim()) missing.push("Requested outcome");
  if (!draft.assessmentId.trim()) missing.push("CJTS pre-filing assessment ID");
  if (!draft.opposingView.trim()) missing.push("The other party’s position");
  if (!evidence.length) missing.push("Supporting evidence");
  const unreadWithoutNote = evidence.some(
    (item) => item.status !== "extracted" && !item.note.trim(),
  );
  if (unreadWithoutNote)
    missing.push("Descriptions for unread documents or images");
  return missing;
}
