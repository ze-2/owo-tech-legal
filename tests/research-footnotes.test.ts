import test from "node:test";
import assert from "node:assert/strict";
import { relevantSnippet, sectionFootnotes } from "../src/lib/research-footnotes";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ResearchCard } from "../src/components/workspace-bits";
import type { ResearchSection } from "../src/lib/claim";

test("snippets are relevant verbatim retrieved passages, bounded and never invented", () => {
  const source = { text: "Welcome to the portal. Supporting documents must be uploaded before filing.", highlights: ["Fees depend on the amount claimed."] };
  assert.equal(relevantSnippet(source, "Upload supporting documents"), "Supporting documents must be uploaded before filing.");
  assert.equal(relevantSnippet(source, "Check fees and amount"), source.highlights[0]);
  assert.equal(relevantSnippet(source, "Residential tenancy exclusions"), undefined);
  assert.equal(relevantSnippet({}, "Filing"), undefined);
  assert.ok(relevantSnippet({ text: "filing ".repeat(200) }, "filing")!.length <= 451);
});

test("field footnotes retain distinct snippets and render escaped excerpts with anchors", () => {
  const citation = { title: "Filing", url: "https://www.judiciary.gov.sg/civil/file-a-small-claim", snippet: "Supporting documents <script> are required." };
  const section: ResearchSection = { id: "claim", title: "Claim", query: "filing", status: "live", guidance: "Prepare documents.", counterpoint: "Check fees.", missingInfo: "Confirm details.", sources: [citation], fieldSources: { guidance: [citation, citation], counterpoint: [{ ...citation, snippet: "Check the applicable fee." }] } };
  const { notes, markers } = sectionFootnotes(section);
  assert.equal(notes.length, 2); assert.deepEqual(markers, { guidance: [1], counterpoint: [2], missingInfo: [] });
  const html = renderToStaticMarkup(createElement(ResearchCard, { section }));
  assert.match(html, /Source 1 for guidance/); assert.match(html, /Source 2 for counterpoint/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Retrieved source excerpt/);
});
