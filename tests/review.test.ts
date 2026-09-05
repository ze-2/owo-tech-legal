import assert from "node:assert/strict";
import { test, mock, afterEach } from "node:test";
import { organiseLocally, type Evidence } from "../src/lib/claim";
import {
  approvedPackage,
  assertionsFor,
  guardModelDate,
  initialReviews,
  reviewIssues,
  uncertainDates,
} from "../src/lib/review";
import { finishConversation, localConversation } from "../src/lib/conversation";
import { parsePackage } from "../extension/shared/transfer.mjs";
import { speechError } from "../src/lib/speech";
import { POST } from "../src/app/api/conversation/route";
const draft = organiseLocally({
  mode: "existing",
  problem:
    "Claimant: Mei Lim\nI paid a contractor around February. The contractor refused to refund me.",
  outcome: "Refund my deposit",
  evidence: [],
  consent: false,
});
const evidence: Evidence = {
  id: "e1",
  name: "message.txt",
  text: "We will discuss a refund after inspection of the work.",
  status: "extracted",
  note: "",
  size: 100,
  type: "text/plain",
};
afterEach(() => mock.restoreAll());

test("approximate dates retain raw wording and never become exact model dates", () => {
  const original =
    "I paid around February; the work failed approximately two months later.";
  assert.equal(uncertainDates(original)[0].value, null);
  assert.match(uncertainDates(original)[0].raw, /around February/);
  assert.equal(
    guardModelDate({ ...draft, incidentDate: "2026-02-01" }, original)
      .incidentDate,
    "",
  );
  assert.equal(
    guardModelDate(
      { ...draft, incidentDate: "2026-02-30" },
      "Incident date: 2026-02-30",
    ).incidentDate,
    "",
  );
  assert.equal(
    guardModelDate(
      { ...draft, incidentDate: "2026-02-10" },
      "Incident date: 2026-02-10",
    ).incidentDate,
    "2026-02-10",
  );
});
test("unsupported assertions and contradictory records produce evidence-linked issues", () => {
  const facts = assertionsFor(draft);
  const issues = reviewIssues(draft, [evidence], facts, draft.summary);
  assert.ok(issues.some((i) => i.title === "Unsupported statement"));
  assert.ok(
    issues.some(
      (i) =>
        i.title === "Possible contradictory evidence" &&
        i.evidenceIds.includes("e1"),
    ),
  );
  const linked = facts.map((a) => ({
    ...a,
    supporting: ["e1"],
    contradictory: ["e1"],
  }));
  assert.ok(
    reviewIssues(draft, [evidence], linked, draft.summary).some(
      (i) => i.title === "Possible contradictory evidence",
    ),
  );
  assert.ok(
    reviewIssues(draft, [], linked, draft.summary).some(
      (i) => i.title === "Unsupported statement",
    ),
  );
});
test("only approved current values are exported, with no private context", () => {
  const reviews = initialReviews(draft, "ai-organised");
  reviews.claimant!.review = "approved";
  const pack = approvedPackage(draft, reviews);
  assert.deepEqual(Object.keys(pack.fields), ["claimant"]);
  assert.equal(pack.userReviewed, true);
  assert.equal(pack.fields.claimant.provenance, "ai-organised");
  assert.ok(!JSON.stringify(pack).includes("February"));
  assert.throws(
    () => approvedPackage({ ...draft, claimant: "Changed" }, reviews),
    /No approved/,
  );
  assert.throws(
    () => approvedPackage(draft, initialReviews(draft, "user")),
    /No approved/,
  );
});
test("malformed, unapproved, oversized and unsupported-version packages are rejected", () => {
  const valid = {
    version: 1,
    generatedAt: new Date().toISOString(),
    userReviewed: true,
    fields: {
      claimant: { value: "Mei", review: "approved", provenance: "user" },
    },
  };
  assert.equal(
    parsePackage(JSON.stringify(valid)).fields.claimant.value,
    "Mei",
  );
  for (const bad of [
    "{",
    "x".repeat(350001),
    null,
    { ...valid, version: 2 },
    { ...valid, userReviewed: false },
    { ...valid, evidence: ["private"] },
    {
      ...valid,
      fields: {
        claimant: { value: "Mei", review: "unreviewed", provenance: "user" },
      },
    },
    {
      ...valid,
      fields: {
        unknown: { value: "x", review: "approved", provenance: "user" },
      },
    },
  ])
    assert.throws(() => parsePackage(bad));
});
test("Mandarin original is retained alongside limited local interpretation and unresolved dates", () => {
  const original = "我给装修公司三千块订金，他们说三月开始可是一直没有来。";
  const result = finishConversation(
    localConversation(original, "", []),
    original,
  );
  assert.equal(result.draft.summary, original);
  assert.equal(result.draft.incidentDate, "");
  assert.equal(result.draft.amount, ""); // Amount paid is not amount claimed.
  assert.ok(
    result.observations.some(
      (o) => o.kind === "amount-paid" && o.raw === "三千块订金",
    ),
  );
  assert.ok(
    result.observations.some((o) => o.kind === "date" && o.value === null),
  );
});
test("microphone denial has a usable text fallback", () => {
  assert.match(speechError("not-allowed"), /denied.*typing/);
  assert.match(speechError("language-not-supported"), /type/);
});
test("conversation accepts short turns without sending them to a provider absent consent", async () => {
  const spy = mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected provider call");
  });
  const response = await POST(
    new Request("http://localhost/api/conversation", {
      method: "POST",
      body: JSON.stringify({
        original: "3000",
        outcome: "",
        evidence: [],
        consent: false,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.summary, "3000");
  assert.equal(spy.mock.callCount(), 0);
});

test("different completion dates in a record trigger comparison without deciding which is right", () => {
  const dated = {
    ...draft,
    summary: "The repair was to be completed by 14 June 2026.",
  };
  const record = {
    ...evidence,
    text: "The repair will be completed by 21 June 2026.",
  };
  assert.ok(
    reviewIssues(dated, [record], assertionsFor(dated), dated.summary).some(
      (i) =>
        i.title === "Possible conflicting event dates" &&
        i.evidenceIds.includes("e1"),
    ),
  );
});

test("model observations cannot turn an approximate original date into an exact fact", () => {
  const original = "Work should begin around February.";
  const result = finishConversation(
    {
      draft,
      observations: [
        {
          kind: "date",
          raw: "around February",
          value: "2026-02-01",
          certainty: "stated",
        },
      ],
    },
    original,
  );
  assert.equal(result.observations[0].value, null);
  assert.equal(result.observations[0].certainty, "approximate");
});
