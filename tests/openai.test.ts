import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  __resetOpenAIClient,
  __setOpenAIClient,
  organiseConversationWithOpenAI,
  organiseWithOpenAI,
} from "../src/lib/openai";
import { organiseLocally, type Intake } from "../src/lib/claim";
import { POST as prepare } from "../src/app/api/prepare/route";

const originalOpenAIKey = process.env.OPENAI_API_KEY;
afterEach(() => {
  mock.restoreAll();
  __resetOpenAIClient();
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

const intake: Intake = {
  mode: "new",
  problem:
    "Claimant: Alex Tan\nRespondent: Example Services\nClaim type: Provision of services\nI paid for repairs which remain incomplete.",
  outcome: "Complete the agreed repairs.",
  evidence: [],
  consent: true,
};
const draft = organiseLocally(intake);

function useOpenAIFake(reply: unknown, calls: unknown[] = []) {
  __setOpenAIClient({
    chat: {
      completions: {
        create: async (params: unknown) => {
          calls.push(params);
          return {
            choices: [{ message: { content: JSON.stringify(reply) } }],
          };
        },
      },
    },
  });
  return calls;
}

const extraction = {
  claimant: "Alex Tan",
  respondent: "Example Services",
  claimType: "Provision of services",
  incidentDate: "",
  amount: "",
  summary: "Paid for repairs which remain incomplete.",
  timeline: "",
  outcome: "Complete the agreed repairs.",
  opposingView: "",
};

test("organisation uses structured output and merges with local defaults", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const calls = useOpenAIFake(extraction);
  const result = await organiseWithOpenAI(intake);
  assert.equal(result.claimant, "Alex Tan");
  assert.equal(result.respondent, "Example Services");
  assert.equal(result.claimType, "Provision of services");
  assert.equal(calls.length, 1);
  const params = calls[0] as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: {
      type: string;
      json_schema: { name: string; schema: unknown };
    };
  };
  assert.equal(typeof params.model, "string");
  assert.equal(params.response_format.type, "json_schema");
  assert.equal(params.response_format.json_schema.name, "claim_extraction");
  assert.ok(
    params.messages.some(
      (message) =>
        message.content.includes("Alex Tan") &&
        message.content.includes("Example Services"),
    ),
  );
});

test("organisation normalizes a numeric amount from compatible providers", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  useOpenAIFake({ ...extraction, amount: 800, timeline: [] });
  const result = await organiseWithOpenAI(intake);
  assert.equal(result.amount, "800");
  assert.equal(result.timeline, "");
});

test("malformed generated claim fields fail validation", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  useOpenAIFake({ claimant: "Invented", amount: 4000 });
  await assert.rejects(
    () => organiseWithOpenAI(intake),
    /did not pass validation/,
  );
});

test("OpenAI failure remains explicit without leaking details", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  __setOpenAIClient({
    chat: {
      completions: {
        create: async () => {
          throw { status: 401, message: "Sensitive upstream response" };
        },
      },
    },
  });
  await assert.rejects(
    () => organiseWithOpenAI(intake),
    /API key was not accepted/,
  );
});

test("prepare organises with OpenAI when consent and key are present", async () => {  process.env.OPENAI_API_KEY = "test-openai-key";
  const spy = mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not contact Exa for organisation");
  });
  useOpenAIFake(extraction);
  const response = await prepare(
    new Request("http://localhost/api/prepare", {
      method: "POST",
      body: JSON.stringify({ ...intake, consent: true }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "ai");
  assert.equal(result.draft.claimant, "Alex Tan");
  assert.equal(spy.mock.callCount(), 0);
});

test("conversation model output retains source fragments and cannot promote vague dates", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const original = "我给装修公司三千块订金，他们说三月开始可是一直没有来。";
  const calls = useOpenAIFake({
    draft: {
      ...draft,
      summary:
        "I paid a renovation company a deposit; the work has not started.",
      incidentDate: "2026-03-01",
    },
    observations: [
      {
        kind: "date",
        raw: "三月",
        value: "2026-03-01",
        certainty: "stated",
      },
      {
        kind: "allegation",
        raw: "words the user never said",
        value: "An invented assertion",
        certainty: "stated",
      },
    ],
  });
  const result = await organiseConversationWithOpenAI(original, "", []);
  assert.equal(calls.length, 1);
  const params = calls[0] as {
    messages: Array<{ role: string; content: string }>;
  };
  assert.ok(
    params.messages.some((message) => message.content.includes(original)),
  );
  const { POST: conversation } =
    await import("../src/app/api/conversation/route");
  const response = await conversation(
    new Request("http://localhost/api/conversation", {
      method: "POST",
      body: JSON.stringify({
        original,
        outcome: "",
        evidence: [],
        consent: true,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  void result;
  assert.equal(body.mode, "ai");
  assert.equal(body.draft.incidentDate, "");
  assert.equal(body.observations[0].raw, "三月");
  assert.equal(body.observations[0].value, null);
  assert.ok(
    !body.observations.some(
      (item: { raw: string }) => item.raw === "words the user never said",
    ),
  );
});

test("simplified conversation shapes are lifted without inventing facts", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const original =
    "The contractor quoted S$2,400 but never finished the kitchen.";
  useOpenAIFake({
    draft:
      "The contractor quoted S$2,400 but did not finish the kitchen work.",
    observations: [
      { raw: "quoted S$2,400", type: "transaction" },
      { raw: "never finished the kitchen", type: "allegation" },
      { raw: "Complete the work", type: "outcome" },
    ],
  });
  const result = await organiseConversationWithOpenAI(original, "", []);
  assert.equal(
    result.draft.summary,
    "The contractor quoted S$2,400 but did not finish the kitchen work.",
  );
  assert.equal(result.draft.claimant, "");
  assert.equal(result.draft.claimType, "Not sure yet");
  assert.deepEqual(
    result.observations.map((item) => [item.kind, item.raw]),
    [
      ["transaction", "quoted S$2,400"],
      ["allegation", "never finished the kitchen"],
    ],
  );
  assert.ok(
    result.observations.every(
      (item) => item.value === null && item.certainty === "unknown",
    ),
  );
});
