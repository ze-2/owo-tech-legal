import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramMessage, newSession, researchFootnotes, type BotIO } from "../src/lib/telegram";
import { organiseLocally } from "../src/lib/claim";
import { parsePackage } from "../cjts-prefiling/transfer.mjs";

function harness() {
  const messages: string[] = []; const files: { name: string; text: string }[] = [];
  const io: BotIO = {
    async say(text) { messages.push(text); },
    async document(name, text) { files.push({ name, text }); },
    async voice() { throw new Error("Voice should not be downloaded"); },
  };
  const session = newSession();
  const send = (text: string) => handleTelegramMessage(session, { chat: { id: 1, type: "private" }, text }, io);
  return { session, messages, files, io, send };
}
test("requires consent before processing personal input or downloading voice", async () => {
  const h = harness();
  await h.send("My claim account");
  await handleTelegramMessage(h.session, { chat: { id: 1, type: "private" }, voice: { file_id: "x", duration: 1 } }, h.io);
  assert.equal(h.session.original, ""); assert.match(h.messages[0], /\/consent/);
});
test("review and explicit subtype approval produce the existing extension contract", async () => {
  const h = harness(); await h.send("/consent");
  h.session.draft = organiseLocally({ mode: "existing", problem: "Claimant: Alex\nClaim type: Sale of goods\nAmount: 800\nA trombone was not delivered.", outcome: "Refund", evidence: [], consent: false });
  h.session.revision = 1;
  await h.send("/approve"); assert.equal(h.files.length, 0);
  await h.send("/review"); await h.send("/approve"); assert.equal(h.files.length, 0);
  await h.send("/subtype 2"); await h.send("/approve");
  const pack = parsePackage(h.files[0].text);
  assert.equal(pack.version, 2); assert.equal(pack.fields.amount.value, "800");
  assert.equal(pack.assessment.sctOptions[0].label, "Non-Delivery");
  assert.equal(pack.fields.incidentDate, undefined);
  h.session.revision++;
  await h.send("/approve"); assert.equal(h.files.length, 1);
});
test("draft export remains unreviewed and reset clears private state and approvals", async () => {
  const h = harness(); await h.send("/consent"); h.session.original = "private account";
  await h.send("/json"); assert.equal(JSON.parse(h.files[0].text).userReviewed, false);
  assert.throws(() => parsePackage(h.files[0].text));
  await h.send("/delete"); assert.equal(h.session.original, ""); assert.equal(h.session.consent, false);
});
test("oversized voice is rejected before downloading", async () => {
  const h = harness(); await h.send("/consent");
  await handleTelegramMessage(h.session, { chat: { id: 1, type: "private" }, voice: { file_id: "x", duration: 61 } }, h.io);
  assert.match(h.messages.at(-1)!, /60 seconds/);
});
test("research footnotes follow field-level citations and deduplicate sources", () => {
  const source = { title: "Official guide", url: "https://www.judiciary.gov.sg/guide" };
  const text = researchFootnotes({ mode: "partial", retrievedAt: "2026-09-07", sections: [{ id: "x", title: "Filing", query: "", status: "unavailable", guidance: "Read guide", counterpoint: "Check conditions", missingInfo: "Confirm facts", sources: [source], fieldSources: { guidance: [source], counterpoint: [source] }, error: "Search unavailable" }] });
  assert.match(text, /guidance: Read guide \[1\]/);
  assert.match(text, /counterpoint: Check conditions \[1\]/);
  assert.match(text, /missingInfo: Confirm facts \n/);
  assert.equal(text.split(source.url).length, 2); assert.match(text, /Search unavailable/);
});

test("text answers reuse AI prompting, retain context and invalidate previous approval", async () => {
  const { __setOpenAIClient, __resetOpenAIClient } = await import("../src/lib/openai");
  const draft = organiseLocally({ mode: "existing", problem: "Goods were not delivered.", outcome: "Refund", evidence: [], consent: false });
  const calls: string[] = [];
  __setOpenAIClient({ chat: { completions: { create: async (params) => {
    calls.push(JSON.stringify(params));
    return { choices: [{ message: { content: JSON.stringify(calls.length % 2 ? { draft, observations: [] } : { question: "What amount are you claiming?" }) } }] };
  } } } });
  try {
    const h = harness(); await h.send("/consent"); await h.send("Goods were not delivered.");
    assert.equal(h.session.question, "What amount are you claiming?");
    h.session.reviewedRevision = h.session.revision; h.session.subtype = 0;
    await h.send("SGD 800");
    assert.match(h.session.original, /Question: What amount are you claiming\?\nAnswer: SGD 800/);
    assert.equal(h.session.reviewedRevision, undefined); assert.equal(h.session.subtype, undefined);
    assert.equal(calls.length, 4);
  } finally { __resetOpenAIClient(); }
});
