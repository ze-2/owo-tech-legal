import type { Citation, Draft, Evidence, Research } from "./claim";

export const sources = {
  overview: {
    title: "The small claims process",
    url: "https://www.judiciary.gov.sg/civil/file-small-claim",
  },
  eligibility: {
    title: "Cases eligible for a small claim",
    url: "https://www.judiciary.gov.sg/civil/cases-eligible-small-claim",
  },
  filing: {
    title: "How to file and serve a small claim",
    url: "https://www.judiciary.gov.sg/civil/how-to-file-serve-small-claim",
  },
  outcomes: {
    title: "Orders the SCT can make",
    url: "https://www.judiciary.gov.sg/civil/understand-outcomes-small-claim",
  },
  ai: {
    title: "Court guidance on using generative AI",
    url: "https://www.judiciary.gov.sg/docs/default-source/circulars/2024/registrar%27s_circular_no_1_2024_supreme_court.pdf",
  },
  portal: {
    title: "Community Justice and Tribunals System",
    url: "https://cjts.judiciary.gov.sg/",
  },
} satisfies Record<string, Citation>;

export const SOURCE_REVIEW_DATE = "5 September 2026";

export const researchTopics = [
  {
    id: "parties",
    title: "Parties & particulars",
    query:
      "Singapore Small Claims Tribunals claimant respondent particulars business ACRA profile service Singapore",
    source: sources.filing,
    guidance:
      "Prepare both parties’ particulars. For a business respondent, obtain a recent ACRA profile.",
    counterpoint: "A trading name may differ from the correct legal party.",
    missingInfo:
      "Verify names, contact information and the address for service.",
  },
  {
    id: "claim",
    title: "Claim & eligibility",
    query:
      "Singapore Small Claims Tribunals eligible claims jurisdiction time limit claim limit exclusions",
    source: sources.eligibility,
    guidance:
      "Check claim category, value, timing and service requirements in the official pre-filing assessment.",
    counterpoint:
      "A low claim value alone does not establish SCT jurisdiction.",
    missingInfo:
      "Confirm the cause-of-action date and any category-specific exclusions.",
  },
  {
    id: "evidence",
    title: "Facts & evidence",
    query:
      "Singapore Small Claims Tribunals supporting documents evidence receipts contracts photographs messages translation",
    source: sources.filing,
    guidance:
      "Organise supporting records as PDFs. Include an English translation for non-English documents.",
    counterpoint: "An attachment does not by itself prove the disputed facts.",
    missingInfo:
      "Connect each disputed event and claimed loss to a document or explanation.",
  },
  {
    id: "outcome",
    title: "Outcome & orders",
    query:
      "Singapore Small Claims Tribunals money work vacant possession consent default discontinuance transfer dismissal orders",
    source: sources.outcomes,
    guidance:
      "Match the requested remedy to the available orders and their conditions.",
    counterpoint:
      "A requested outcome is not a prediction of what the tribunal will order.",
    missingInfo:
      "Explain the amount or work requested, and any settlement terms.",
  },
  {
    id: "filing",
    title: "CJTS filing & service",
    query:
      "Singapore Small Claims Tribunals CJTS pre filing assessment claim form filing fees notice consultation declaration service",
    source: sources.filing,
    guidance:
      "Complete the CJTS assessment, file the Claim Form and pay. Then arrange service and file proof of service.",
    counterpoint: "Preparing a draft here does not file or serve a claim.",
    missingInfo:
      "Keep the assessment ID and confirm the portal’s current requirements.",
  },
];

export function referenceResearch(): Research {
  return {
    mode: "reference",
    retrievedAt: "",
    sections: researchTopics.map(({ source, ...topic }) => ({
      ...topic,
      status: "reference",
      sources: [source],
      fieldSources: { guidance: [source] },
    })),
  };
}

/** Search queries use categories only. Private case text is never interpolated here. */
export function topicQuery(id: string, draft: Draft, evidence: Evidence[]) {
  const topic = researchTopics.find((item) => item.id === id)!;
  const category =
    draft.claimType === "Not sure yet" ? "" : `; category: ${draft.claimType}`;
  if (id !== "evidence") return topic.query + category;
  const evidenceTypes = [...new Set(evidence.map(describeEvidenceKind))].join(
    ", ",
  );
  return evidenceTypes
    ? `${topic.query}${category}; records: ${evidenceTypes}`
    : topic.query + category;
}

function describeEvidenceKind(item: Evidence): string {
  if (item.type.startsWith("image/")) return "photographs";
  if (item.type.includes("pdf")) return "PDF documents";
  return "written records";
}

const OFFICIAL_PATH_PREFIXES = ["/civil/", "/docs/", "/news-and-resources/"];

export function isOfficialSource(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return false;
  if (url.hostname === "cjts.judiciary.gov.sg") return true;
  if (url.hostname !== "www.judiciary.gov.sg") return false;
  return OFFICIAL_PATH_PREFIXES.some((prefix) =>
    url.pathname.startsWith(prefix),
  );
}
