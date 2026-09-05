import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i)] ??= t.slice(i + 1);
}
const { researchSection } = await import("./src/lib/exa");
const t0 = Date.now();
try {
  const s = await researchSection("claim",
    { claimant: "Alex Tan", respondent: "Example Services", claimType: "Provision of services", incidentDate: "", amount: "2400", summary: "Paid for repairs which remain incomplete.", timeline: "", outcome: "Complete the repairs.", opposingView: "", respondentInSingapore: "unknown", consentToHigherLimit: false, claimantType: "individual", assessmentId: "", caseNumber: "" },
    []);
  console.log(`RESEARCH SECTION OK (${Date.now() - t0}ms) status:`, s.status);
  console.log("guidance:", s.guidance.slice(0, 120));
  console.log("sources:", JSON.stringify(s.sources));
} catch (e) { console.log("RESEARCH SECTION FAIL:", (e as Error).message); }
