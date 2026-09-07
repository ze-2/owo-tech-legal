import type { Citation, ResearchSection } from "./claim";

export const researchFields = ["guidance", "counterpoint", "missingInfo"] as const;

/** Footnotes are field-specific: the same URL may support different excerpts. */
export function sectionFootnotes(section: ResearchSection) {
  const notes: Citation[] = [];
  const markers: Record<string, number[]> = {};
  for (const field of researchFields) {
    const citations = section.fieldSources[field] ?? (field === "guidance" ? section.sources : []);
    markers[field] = [];
    for (const source of citations) {
      let index = notes.findIndex(note => note.url === source.url && note.snippet === source.snippet);
      if (index < 0) index = notes.push(source) - 1;
      if (!markers[field].includes(index + 1)) markers[field].push(index + 1);
    }
  }
  return { notes, markers };
}

/** Select an actual retrieved passage, never a model-generated quotation. */
export function relevantSnippet(source: { text?: string; highlights?: string[] }, guidance: string): string | undefined {
  const terms = new Set((guidance.toLowerCase().match(/[a-z]{4,}/g) || []).filter(term => !["this", "that", "with", "from", "your", "have", "should", "official"].includes(term)));
  const candidates = [...(source.highlights || []), ...(source.text || "").split(/(?<=[.!?])\s+|\n+/)]
    .map(text => text.trim()).filter(Boolean);
  let best = ""; let score = 0;
  for (const candidate of candidates) {
    // Score only the portion shown to the reader.
    const excerpt = candidate.slice(0, 450);
    const words = new Set(excerpt.toLowerCase().match(/[a-z]{4,}/g) || []);
    const overlap = [...terms].filter(term => words.has(term)).length;
    if (overlap > score) { score = overlap; best = candidate; }
  }
  if (!best) return undefined;
  return best.length > 450 ? `${best.slice(0, 450)}…` : best;
}
