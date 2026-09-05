import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eligibilityChecks,
  filingFee,
  intakeSchema,
  organiseLocally,
  type Intake,
} from "../src/lib/claim";
import { isOfficialSource, topicQuery } from "../src/lib/sources";
import { filingPack } from "../src/lib/export";

const intake: Intake = {
  mode: "existing",
  consent: false,
  evidence: [],
  outcome: "",
  problem:
    "Claimant: Alex Tan\nRespondent: Example Services\nClaim type: Provision of services\nClaim amount: S$24,000\nIncident date: 2024-09-05\nRelief sought: Repair the defective work.\nI paid for repairs which remain incomplete.",
};

test("basic extraction preserves the original account and only uses explicit labels", () => {
  const draft = organiseLocally(intake);
  assert.equal(draft.amount, "24000");
  assert.equal(draft.claimant, "Alex Tan");
  assert.equal(draft.summary, intake.problem);
  assert.equal(draft.incidentDate, "2024-09-05");
  assert.equal(draft.outcome, "Repair the defective work.");
  assert.equal(draft.opposingView, "");
  const ambiguous = organiseLocally({
    ...intake,
    problem:
      "I spent $50 on repairs in January and want help. A quote was $100.",
  });
  assert.equal(ambiguous.amount, "");
  assert.equal(ambiguous.incidentDate, "");
  assert.equal(ambiguous.claimant, "");
});

test("claim limits and filing fee tiers respect claimant type and consent", () => {
  const draft = organiseLocally(intake);
  assert.equal(eligibilityChecks(draft)[0].level, "attention");
  assert.equal(filingFee(draft), null);
  assert.equal(filingFee({ ...draft, consentToHigherLimit: true }), 240);
  assert.equal(
    filingFee({ ...draft, consentToHigherLimit: true, claimantType: "entity" }),
    720,
  );
  assert.equal(filingFee({ ...draft, amount: "5000" }), 10);
  assert.equal(filingFee({ ...draft, amount: "5000.01" }), 20);
  assert.equal(
    filingFee({ ...draft, amount: "10000", claimantType: "entity" }),
    100,
  );
  assert.equal(
    filingFee({ ...draft, amount: "30000.01", consentToHigherLimit: true }),
    null,
  );
  assert.equal(filingFee({ ...draft, amount: "-5" }), null);
});

test("time checks use calendar dates in Singapore and handle invalid dates", () => {
  const draft = organiseLocally(intake);
  assert.equal(
    eligibilityChecks(draft, new Date("2026-09-05T08:00:00Z"))[1].level,
    "check",
  );
  assert.equal(
    eligibilityChecks(draft, new Date("2026-09-05T16:00:00Z"))[1].level,
    "attention",
  );
  for (const incidentDate of ["", "2026-99-99", "2026-02-30", "2028-01-01"]) {
    assert.equal(
      eligibilityChecks(
        { ...draft, incidentDate },
        new Date("2026-09-05T08:00:00Z"),
      )[1].level,
      "unknown",
    );
  }
});

test("official source checks reject lookalikes, unsafe schemes and credentials", () => {
  assert.equal(
    isOfficialSource("https://www.judiciary.gov.sg/civil/file-small-claim"),
    true,
  );
  assert.equal(isOfficialSource("https://cjts.judiciary.gov.sg/"), true);
  for (const url of [
    "https://www.judiciary.gov.sg.evil.example/civil/file-small-claim",
    "http://www.judiciary.gov.sg/civil/file-small-claim",
    "https://evil.example@www.judiciary.gov.sg/civil/file-small-claim",
    "javascript:alert(1)",
    "https://www.judiciary.gov.sg:444/civil/file-small-claim",
  ]) {
    assert.equal(isOfficialSource(url), false);
  }
});

test("search queries contain category context without raw private particulars", () => {
  const draft = organiseLocally(intake);
  const query = topicQuery("claim", draft, []);
  assert.match(query, /Provision of services/);
  assert.doesNotMatch(query, /Alex Tan|Example Services|24,000/);
});

test("intake validation and export maintain the user-review boundary", () => {
  assert.equal(intakeSchema.safeParse(intake).success, true);
  assert.equal(
    intakeSchema.safeParse({ ...intake, mode: "new" }).success,
    false,
  );
  assert.equal(
    intakeSchema.safeParse({ ...intake, problem: "too short" }).success,
    false,
  );
  const pack = filingPack(organiseLocally(intake), [], null, intake.problem);
  assert.match(pack, /not a filed claim/);
  assert.match(pack, /No attachments are embedded/);
  assert.match(pack, /Live research has not been performed/);
  assert.ok(pack.includes(intake.problem));
});
