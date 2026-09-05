import type { Draft, Evidence } from "./claim";
import {
  filingFields,
  parsePackage,
  validField,
} from "../../cjts-prefiling/transfer.mjs";

export type FilingField = keyof typeof filingFields;
export type Provenance =
  "user" | "evidence" | "ai-organised" | "official-source" | "unknown";
export type ReviewState = "unreviewed" | "approved" | "needs-attention";
export type FieldReview = {
  provenance: Provenance;
  review: ReviewState;
  value: string;
};
export type Reviews = Partial<Record<FilingField, FieldReview>>;
export type SctOption = { groupId: string; label: string };
export type Statement = {
  id: string;
  text: string;
  language: string;
  input: "typed" | "voice";
  createdAt: string;
};
export type UncertainDate = {
  value: null;
  raw: string;
  certainty: "approximate" | "unknown";
};
export type Assertion = {
  id: string;
  text: string;
  supporting: string[];
  contradictory: string[];
  assumption: boolean;
};
export type Issue = {
  id: string;
  field: keyof Draft;
  title: string;
  statement: string;
  detail: string;
  evidenceIds: string[];
};

// Approximate-date hints across supported languages. Matches whole fragments only.
const APPROXIMATE_DATE_PATTERN =
  /\b(around|approximately|sometime|next week|last month|January or February)\b|大约|左右|下个星期|三月|二月|sekitar|kira-kira|சுமார்/i;
const SENTENCE_SPLIT_PATTERN = /[\n。!?]/;

// Overstatement signals: describe observed conduct, do not infer motive.
const ASSUMPTION_PATTERN =
  /\b(scam|fraud|deliberately|intentionally|obviously|must have)\b|诈骗|故意/i;
const EVENT_WORD_PATTERN =
  /\b(start|begin|commence|complet|deliver|repair)\w*/gi;
const READABLE_DATE_PATTERN =
  /\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?/gi;
const ISO_DATE_ONLY_PATTERN = /\d{4}-\d{2}-\d{2}/g;
const REFUND_REFUSAL_PATTERN = /refus.{0,25}refund|拒绝退款/i;
const REFUND_DISCUSSION_PATTERN =
  /(?:discuss|consider|after).{0,65}(?:refund|inspection)|refund.{0,65}inspection/i;
const UNKNOWN_PHRASE_PATTERN =
  /don[’']t know|not sure|不知道|不确定|tidak tahu|தெரியாது/i;

export function uncertainDates(text: string): UncertainDate[] {
  const fragments = text
    .split(SENTENCE_SPLIT_PATTERN)
    .filter((fragment) => APPROXIMATE_DATE_PATTERN.test(fragment));
  return fragments.map((raw) => ({
    value: null,
    raw: raw.trim(),
    certainty: "approximate",
  }));
}

/** A model date is never accepted as exact without the same valid ISO date in the original account.
 * Human date entry remains available; natural-language dates require that explicit confirmation. */
export function guardModelDate(draft: Draft, original: string): Draft {
  if (!validField("incidentDate", draft.incidentDate))
    return { ...draft, incidentDate: "" };
  if (!original.includes(draft.incidentDate))
    return { ...draft, incidentDate: "" };
  const isUncertain = uncertainDates(original).some((entry) =>
    entry.raw.includes(draft.incidentDate),
  );
  if (isUncertain) return { ...draft, incidentDate: "" };
  return draft;
}

export function initialReviews(draft: Draft, provenance: Provenance): Reviews {
  const entries = Object.keys(filingFields).map((key) => {
    const field = key as FilingField;
    return [
      key,
      { value: draft[field], provenance, review: "unreviewed" },
    ] as const;
  });
  return Object.fromEntries(entries);
}
export function approvedPackage(
  draft: Draft,
  reviews: Reviews,
  sctOptions: SctOption[],
) {
  const approvedEntries = Object.entries(reviews)
    .filter(([key, meta]) => {
      if (meta?.review !== "approved") return false;
      if (meta.value !== draft[key as FilingField]) return false;
      return validField(key, meta.value);
    })
    .map(([key, meta]) => [key, meta]);
  const fields = Object.fromEntries(approvedEntries);
  return parsePackage({
    version: 2,
    generatedAt: new Date().toISOString(),
    userReviewed: true,
    fields,
    assessment: { sctOptions },
  });
}

// Stable text-derived IDs keep evidence links across unrelated field edits.
// FNV-1a 32-bit hash (offset basis 2166136261, prime 16777619), base-36 encoded.
function idFor(text: string) {
  let hash = 2166136261;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return (hash >>> 0).toString(36);
}
export function assertionsFor(
  draft: Draft,
  previous: Assertion[] = [],
): Assertion[] {
  const sentences = `${draft.summary}\n${draft.timeline}`
    .split(/\n|(?<=[.!?。])\s*/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12);
  const uniqueTexts = [...new Set(sentences)];
  return uniqueTexts.map((text) => {
    const kept = previous.find((assertion) => assertion.text === text);
    if (kept) return kept;
    return {
      id: idFor(text),
      text,
      supporting: [],
      contradictory: [],
      assumption: false,
    };
  });
}

function findLinkedIds(ids: string[], evidence: Evidence[]): string[] {
  const known = new Set(evidence.map((entry) => entry.id));
  return ids.filter((id) => known.has(id));
}

function checkSupport(
  assertion: Assertion,
  supporting: string[],
): Issue | null {
  if (supporting.length > 0 && !assertion.assumption) return null;
  return {
    id: `unsupported-${assertion.id}`,
    field: "summary",
    title: assertion.assumption
      ? "User-confirmed assumption"
      : "Unsupported statement",
    statement: assertion.text,
    detail:
      "No supporting evidence has been linked and checked for this assertion. Add evidence, correct the wording, or keep it explicitly unverified.",
    evidenceIds: [],
  };
}

function checkAssumptionLanguage(
  assertion: Assertion,
  supporting: string[],
): Issue | null {
  if (!ASSUMPTION_PATTERN.test(assertion.text)) return null;
  return {
    id: `assumption-${assertion.id}`,
    field: "summary",
    title: "Possible assumption or overstatement",
    statement: assertion.text,
    detail:
      "What did you directly observe, and what are you inferring about their intention? Consider describing the conduct without assuming motive.",
    evidenceIds: supporting,
  };
}

function checkDateConflicts(
  assertion: Assertion,
  evidence: Evidence[],
): Issue | null {
  const statedDates: string[] =
    assertion.text.match(READABLE_DATE_PATTERN) ?? [];
  if (!statedDates.length) return null;
  const eventKinds = [...assertion.text.matchAll(EVENT_WORD_PATTERN)].map(
    (match) => match[1].toLowerCase(),
  );
  const conflicts = evidence.filter((entry) => {
    const recordDates: string[] = entry.text.match(READABLE_DATE_PATTERN) ?? [];
    const sameEvent = eventKinds.some((kind) =>
      entry.text.toLowerCase().includes(kind),
    );
    const differentDate =
      recordDates.length > 0 &&
      !recordDates.some((date) => statedDates.includes(date));
    return sameEvent && differentDate;
  });
  if (!conflicts.length) return null;
  return {
    id: `evidence-date-${assertion.id}`,
    field: "timeline",
    title: "Possible conflicting event dates",
    statement: assertion.text,
    detail:
      "A record mentions a similar event with a different date. These may describe separate events or date formats; compare them before choosing a date.",
    evidenceIds: conflicts.map((entry) => entry.id),
  };
}

function checkContradictions(
  assertion: Assertion,
  contradictory: string[],
  evidence: Evidence[],
): Issue | null {
  const mentionsRefundRefusal = REFUND_REFUSAL_PATTERN.test(assertion.text);
  const discussedRefund = evidence.filter(
    (entry) =>
      entry.text &&
      mentionsRefundRefusal &&
      REFUND_DISCUSSION_PATTERN.test(entry.text),
  );
  const conflictIds = [
    ...new Set([...contradictory, ...discussedRefund.map((entry) => entry.id)]),
  ];
  if (!conflictIds.length) return null;
  return {
    id: `conflict-${assertion.id}`,
    field: "summary",
    title: "Possible contradictory evidence",
    statement: assertion.text,
    detail:
      "Compare the original record below. Discussing a refund after inspection is not necessarily refusing it. Evidence links identify a possible conflict, not a finding about who is right.",
    evidenceIds: conflictIds,
  };
}

export function reviewIssues(
  draft: Draft,
  evidence: Evidence[],
  assertions: Assertion[],
  original: string,
): Issue[] {
  const issues: Issue[] = [];
  for (const assertion of assertions) {
    const supporting = findLinkedIds(assertion.supporting, evidence);
    const contradictory = findLinkedIds(assertion.contradictory, evidence);
    for (const check of [checkSupport, checkAssumptionLanguage]) {
      const issue = check(assertion, supporting);
      if (issue) issues.push(issue);
    }
    const dateIssue = checkDateConflicts(assertion, evidence);
    if (dateIssue) issues.push(dateIssue);
    const conflictIssue = checkContradictions(
      assertion,
      contradictory,
      evidence,
    );
    if (conflictIssue) issues.push(conflictIssue);
  }
  if (!draft.opposingView.trim()) {
    issues.push({
      id: "other-side",
      field: "opposingView",
      title: "What might the other party disagree with?",
      statement: "",
      detail:
        "Did they say the work was completed, offer an inspection, or explain a delay? Record their actual response, or say that you do not know.",
      evidenceIds: [],
    });
  }
  const uncertainFragments = uncertainDates(original);
  if (uncertainFragments.length > 0 && !draft.timeline.includes("unresolved")) {
    issues.push({
      id: "uncertainty",
      field: "timeline",
      title: "Uncertainty in the original account",
      statement: uncertainFragments.map((entry) => entry.raw).join("\n"),
      detail:
        "These dates remain approximate. Ensure the chronology preserves this uncertainty even if the summary is translated or shortened.",
      evidenceIds: [],
    });
  }
  const mentionedDates = [
    ...new Set(
      `${draft.summary}\n${draft.timeline}`.match(ISO_DATE_ONLY_PATTERN) ?? [],
    ),
  ];
  if (
    draft.incidentDate &&
    mentionedDates.length > 0 &&
    !mentionedDates.includes(draft.incidentDate)
  ) {
    issues.push({
      id: "dates",
      field: "incidentDate",
      title: "Dates need comparison",
      statement: draft.incidentDate,
      detail: `The account mentions ${mentionedDates.join(", ")}. These could be different events; confirm which date relates to the cause of action.`,
      evidenceIds: [],
    });
  }
  return issues;
}
const FOLLOW_UP_DEFAULT =
  "Review the organised fields against your original words and records. You can add more details at any time.";

export function followUp(draft: Draft, original: string): string {
  const dateIsUncertain = uncertainDates(original).length > 0;
  const userSaysUnknown = UNKNOWN_PHRASE_PATTERN.test(original);
  if (!draft.incidentDate && dateIsUncertain && !userSaysUnknown) {
    return "The date is still approximate. Do you have a receipt or message giving the exact date and what happened then? If not, say “I don’t know”; leave the date blank.";
  }
  if (!draft.claimant)
    return "What name should be recorded for the claimant? You can type “Claimant: …” or complete it in the organised claim.";
  if (!draft.respondent)
    return "Who is the other party? Use their legal name if you know it.";
  if (!draft.amount)
    return "How much are you claiming in SGD? An amount paid is not automatically the amount claimed.";
  if (!draft.outcome) return "What outcome would help put things right?";
  if (!draft.opposingView)
    return "What has the other party actually said? It is fine to record that you do not know.";
  return FOLLOW_UP_DEFAULT;
}
