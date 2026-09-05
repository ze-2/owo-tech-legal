/**
 * Live provider smoke test. Fictional data only.
 *
 * The automated suites mock every provider, so they prove the app's logic but
 * say nothing about whether the configured model and keys actually work. This
 * runs the real organisation and research paths against the live providers.
 *
 *   npm run test:live            # organisation only
 *   npm run test:live -- 5       # repeat organisation five times
 *   npm run test:live -- 3 research
 *
 * It reads .env directly because it runs outside Next.js.
 */
import fs from "node:fs";
import { organiseWithOpenAI, textModel } from "../src/lib/openai.ts";
import { researchSection } from "../src/lib/exa.ts";
import type { Draft, Intake } from "../src/lib/claim.ts";

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const at = trimmed.indexOf("=");
  process.env[trimmed.slice(0, at)] ??= trimmed.slice(at + 1);
}

const runs = Number(process.argv[2] || 3);
const withResearch = process.argv.includes("research");

const intake: Intake = {
  mode: "new",
  problem:
    "I bought a second-hand laptop from Tan Wei Ming at a shop in Bugis on 12 March 2026 for SGD 1,450. He said it was fully working. Two days later the screen started flickering and it now will not power on. He stopped replying after 20 March 2026. I want a full refund of the 1450. He told my friend he thinks I dropped it, which I did not.",
  outcome: "Full refund of SGD 1450",
  evidence: [
    {
      name: "whatsapp.pdf",
      description: "WhatsApp messages showing the seller agreeing to inspect it",
    },
  ],
  consent: true,
};

console.log(`model: ${textModel()}`);
console.log(
  `endpoint: ${process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1 (default)"}\n`,
);

let passed = 0;
let lastDraft: Draft | null = null;
for (let run = 1; run <= runs; run++) {
  const started = Date.now();
  try {
    const draft = await organiseWithOpenAI(intake);
    lastDraft = draft;
    passed++;
    console.log(
      `organise ${run}: OK ${Date.now() - started}ms claimType=${JSON.stringify(draft.claimType)} amount=${JSON.stringify(draft.amount)} incidentDate=${JSON.stringify(draft.incidentDate)}`,
    );
  } catch (error) {
    console.log(
      `organise ${run}: FAIL ${Date.now() - started}ms ${(error as Error).message}`,
    );
  }
}
console.log(`\norganisation: ${passed}/${runs} passed`);

// A model may return a category or amount the app then blanks; that is the
// intended tolerance, but worth seeing when checking a new model.
if (lastDraft?.claimType === "Not sure yet")
  console.log("note: the model never produced a usable claim category");
if (!lastDraft?.amount)
  console.log("note: the model never produced a usable amount");

if (withResearch) {
  const started = Date.now();
  try {
    const section = await researchSection("claim", lastDraft ?? ({} as Draft), []);
    console.log(
      `\nresearch: ${section.status} ${Date.now() - started}ms sources=${section.sources.length}`,
    );
    console.log(`guidance: ${section.guidance.slice(0, 160)}`);
  } catch (error) {
    console.log(`\nresearch: FAIL ${(error as Error).message}`);
  }
}

process.exit(passed === runs ? 0 : 1);
