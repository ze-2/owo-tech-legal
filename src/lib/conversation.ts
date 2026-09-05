import { z } from "zod";
import {
  draftSchema,
  evidenceSchema,
  organiseLocally,
  type Draft,
  type Intake,
} from "./claim";
import { followUp, guardModelDate, uncertainDates } from "./review";

export const observationSchema = z.object({
  kind: z.enum([
    "amount-paid",
    "transaction",
    "allegation",
    "date",
    "evidence-mentioned",
  ]),
  raw: z.string().max(2000),
  value: z.string().nullable(),
  certainty: z.enum(["stated", "approximate", "inferred", "unknown"]),
});
export type Observation = z.infer<typeof observationSchema>;
export const conversationSchema = z.object({
  original: z.string().trim().min(1).max(30000),
  outcome: z.string().max(5000),
  evidence: z.array(evidenceSchema).max(10),
  consent: z.boolean(),
});
export const organisedConversationSchema = z.object({
  draft: draftSchema,
  observations: z.array(observationSchema).max(40),
});

// Local demo patterns only: full multilingual interpretation needs AI consent.
const PAYMENT_PATTERN =
  /(?:paid\s*(?:S\$|SGD|\$)?\s*[\d,]+(?:\.\d{1,2})?|(?:三千|3000)块订金)/i;
const RENOVATION_COMPANY_TERM = "装修公司";
const RENOVATION_COMPANY_LABEL = "Renovation company — working interpretation";
const NON_DIGIT_PATTERN = /[^\d.]/g;

export function localConversation(
  original: string,
  outcome: string,
  evidence: Intake["evidence"],
) {
  const draft = organiseLocally({
    mode: "existing",
    problem: original,
    outcome,
    evidence,
    consent: false,
  });
  const observations: Observation[] = uncertainDates(original).map((date) => ({
    kind: "date",
    raw: date.raw,
    value: null,
    certainty: "approximate",
  }));
  const paid = original.match(PAYMENT_PATTERN);
  if (paid) {
    const mentionsChineseThousands = /三千/.test(paid[0]);
    observations.push({
      kind: "amount-paid",
      raw: paid[0],
      value: mentionsChineseThousands
        ? "3000 (currency unconfirmed)"
        : `${paid[0].replace(NON_DIGIT_PATTERN, "")} (currency unconfirmed)`,
      certainty: "stated",
    });
  }
  if (original.includes(RENOVATION_COMPANY_TERM)) {
    observations.push({
      kind: "transaction",
      raw: RENOVATION_COMPANY_TERM,
      value: RENOVATION_COMPANY_LABEL,
      certainty: "inferred",
    });
  }
  return { draft, observations };
}
export function finishConversation(
  result: { draft: Draft; observations: Observation[] },
  original: string,
) {
  const draft = guardModelDate(result.draft, original);
  const keptObservations = result.observations
    .filter((item) => item.raw.trim() && original.includes(item.raw))
    .map((item) => downgradeUncertainDate(item));
  for (const date of uncertainDates(original)) {
    const alreadyTracked = keptObservations.some(
      (entry) => entry.raw === date.raw,
    );
    if (!alreadyTracked) {
      keptObservations.push({
        kind: "date",
        raw: date.raw,
        value: null,
        certainty: "approximate",
      });
    }
  }
  return {
    draft,
    observations: keptObservations,
    followUp: followUp(draft, original),
  };
}

function downgradeUncertainDate(item: Observation): Observation {
  if (item.kind !== "date") return item;
  const looksUncertain =
    item.certainty !== "stated" || uncertainDates(item.raw).length > 0;
  if (!looksUncertain) return item;
  return { ...item, value: null, certainty: "approximate" as const };
}
