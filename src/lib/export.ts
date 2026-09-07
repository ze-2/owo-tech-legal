import {
  eligibilityChecks,
  missingFields,
  type Draft,
  type Evidence,
  type Research,
} from "./claim";
import { sectionFootnotes } from "./research-footnotes";
import { sources, SOURCE_REVIEW_DATE } from "./sources";

const NOT_PROVIDED = "[Not provided — verify before filing]";

function field(label: string, value: string): string {
  const body = value.trim() || NOT_PROVIDED;
  return `## ${label}\n\n${body}\n`;
}

function evidenceSection(evidence: Evidence[]): string {
  if (!evidence.length) return "## Evidence index\n\n[No evidence attached]";
  const lines = evidence.map((item, index) => {
    const description = item.note || "[Description not supplied]";
    return `${index + 1}. ${item.name}\n   ${description}\n   Text extraction: ${item.status}. Original file must be supplied separately.`;
  });
  return `## Evidence index\n\n${lines.join("\n")}`;
}

function checksSection(draft: Draft): string {
  const lines = eligibilityChecks(draft).map(
    (check) => `- ${check.title}: ${check.detail}`,
  );
  return `## Preliminary checks — not a jurisdiction decision\n\n${lines.join("\n")}`;
}

function missingSection(draft: Draft, evidence: Evidence[]): string {
  const missing = missingFields(draft, evidence).map((item) => `- ${item}`);
  const body =
    missing.join("\n") ||
    "Review every entry against the originals and the official requirements.";
  return `## Information still to review\n\n${body}`;
}

function researchSection(research: Research | null): string {
  if (!research)
    return "## Research notes\n\nLive research has not been performed.";
  const blocks = research.sections.map((section) => {
    const { notes, markers } = sectionFootnotes(section);
    const refs = (key: string) => markers[key].map(n => `[${n}]`).join("");
    const sourceLines = notes.map((source, i) =>
      `[${i + 1}] ${source.title}: ${source.url}${source.snippet ? `\n   Retrieved excerpt: ${source.snippet}` : ""}`,
    ).join("\n");
    return `### ${section.title} [${section.status}]\n\n${section.guidance} ${refs("guidance")}\n\nConsider: ${section.counterpoint} ${refs("counterpoint")}\n\nVerify: ${section.missingInfo} ${refs("missingInfo")}\n\n${sourceLines}`;
  });
  return `## Research notes\n\n${blocks.join("\n\n")}`;
}

export function filingPack(
  draft: Draft,
  evidence: Evidence[],
  research: Research | null,
  original: string,
): string {
  return [
    "# Small claims preparation draft",
    "Prepared with Clearclaim. This is a working draft, not a filed claim or official CJTS form. User statements are unverified. Verify facts, evidence, source guidance and all portal fields before filing. No attachments are embedded in this document.",
    `Exported: ${new Date().toISOString()}\nReference guidance reviewed: ${SOURCE_REVIEW_DATE}`,
    field("Existing case reference", draft.caseNumber),
    field("Pre-filing assessment ID", draft.assessmentId),
    field("Claimant particulars", draft.claimant),
    field("Respondent particulars", draft.respondent),
    field("Claim type", draft.claimType),
    field("Cause-of-action date (user supplied)", draft.incidentDate),
    field("Total claim value", draft.amount ? `SGD ${draft.amount}` : ""),
    field("Summary of claim — user account", draft.summary),
    field("Chronology — verify dates", draft.timeline),
    field("Outcome requested", draft.outcome),
    field("Other party’s position", draft.opposingView),
    evidenceSection(evidence),
    checksSection(draft),
    missingSection(draft, evidence),
    researchSection(research),
    field("Original account — preserved for comparison", original),
    `## Official filing\n\nComplete or check the assessment, fill in the CJTS Claim Form and pay the applicable fee. Follow the official service and Declaration of Service requirements.\n\nFiling guide: ${sources.filing.url}\nPortal: ${sources.portal.url}`,
  ].join("\n\n");
}
