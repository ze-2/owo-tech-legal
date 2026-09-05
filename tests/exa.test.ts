import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { researchClaim, researchSection } from "../src/lib/exa";
import { __resetOpenAIClient, __setOpenAIClient } from "../src/lib/openai";
import { organiseLocally, type Intake } from "../src/lib/claim";
import { sources } from "../src/lib/sources";
import { POST as prepare } from "../src/app/api/prepare/route";
import { POST as research } from "../src/app/api/research/route";

const originalExaKey = process.env.EXA_API_KEY;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
afterEach(() => {
  mock.restoreAll();
  __resetOpenAIClient();
  if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalExaKey;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
});
const intake: Intake = {
  mode: "new",
  problem:
    "I paid a contractor for repairs, but they have not completed the agreed work.",
  outcome: "Complete the agreed repairs.",
  evidence: [],
  consent: true,
};
const draft = organiseLocally(intake);
const fields = {
  guidance: "Review the official requirements.",
  counterpoint: "Check the exclusions.",
  missingInfo: "Confirm the supporting documents.",
};
function generation(citation = sources.filing.url) {
  return {
    ...fields,
    citations: {
      guidance: [{ title: "Official source", url: citation }],
      counterpoint: [{ title: "Official source", url: citation }],
      missingInfo: [{ title: "Official source", url: citation }],
    },
  };
}
function exaResults(citation = sources.filing.url) {
  return {
    results: [{ ...sources.filing, url: citation, text: "Official filing requirements." }],
  };
}
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

test("all five sections retrieve from Exa and draft with OpenAI", async () => {
  process.env.EXA_API_KEY = "test-exa-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.exa.ai/search");
    assert.equal(
      (init.headers as Record<string, string>)["x-api-key"],
      "test-exa-key",
    );
    const body = JSON.parse(init.body as string);
    bodies.push(body);
    assert.ok(!("outputSchema" in body));
    assert.ok(!("systemPrompt" in body));
    assert.ok(body.contents.text);
    assert.deepEqual(body.includeDomains, [
      "www.judiciary.gov.sg/civil",
      "www.judiciary.gov.sg/docs",
      "cjts.judiciary.gov.sg",
    ]);
    return Response.json(exaResults());
  });
  const generations = useOpenAIFake(generation());
  const result = await researchClaim(draft, []);
  assert.equal(bodies.length, 5);
  assert.equal(new Set(bodies.map((body) => body.query)).size, 5);
  assert.equal(generations.length, 5);
  assert.equal(result.mode, "live");
  assert.ok(
    result.sections.every(
      (section) => section.fieldSources.guidance.length > 0,
    ),
  );
});

test("unofficial or unreturned citations cannot ground generated guidance", async () => {
  process.env.EXA_API_KEY = "test-exa-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  mock.method(globalThis, "fetch", async () =>
    Response.json(exaResults("https://fake.example/legal")),
  );
  useOpenAIFake(generation("https://fake.example/legal"));
  await assert.rejects(
    () => researchSection("claim", draft, []),
    /No verifiable official citation/,
  );
  const partial = await researchClaim(draft, []);
  assert.equal(partial.mode, "partial");
  assert.ok(
    partial.sections.every((section) => section.status === "unavailable"),
  );
  assert.ok(
    partial.sections.every((section) => section.guidance !== fields.guidance),
  );
});

test("model citations must match retrieved URLs, not just the allowlist", async () => {
  process.env.EXA_API_KEY = "test-exa-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  mock.method(globalThis, "fetch", async () =>
    Response.json(exaResults(sources.filing.url)),
  );
  // Cited URL is official but was never retrieved.
  useOpenAIFake(generation(sources.eligibility.url));
  await assert.rejects(
    () => researchSection("claim", draft, []),
    /No verifiable official citation/,
  );
});

test("provider failure remains explicit and does not erase the draft", async () => {
  process.env.EXA_API_KEY = "test-exa-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  useOpenAIFake(generation());
  mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Sensitive upstream response" }, { status: 401 }),
  );
  await assert.rejects(
    () => researchSection("claim", draft, []),
    /API key was not accepted/,
  );
});

test("malformed generated research fields fail validation", async () => {
  process.env.EXA_API_KEY = "test-exa-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  mock.method(globalThis, "fetch", async () =>
    Response.json(exaResults()),
  );
  useOpenAIFake({ guidance: 42 });
  await assert.rejects(
    () => researchSection("claim", draft, []),
    /could not be validated/,
  );
});

test("no provider request is made without consent, and research enforces consent", async () => {
  process.env.EXA_API_KEY = "test-exa-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  const generations = useOpenAIFake(generation());
  const spy = mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not contact provider");
  });
  const response = await prepare(
    new Request("http://localhost/api/prepare", {
      method: "POST",
      body: JSON.stringify({ ...intake, consent: false }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "basic");
  const rejected = await research(
    new Request("http://localhost/api/research", {
      method: "POST",
      body: JSON.stringify({ draft, evidence: [], consent: false }),
    }),
  );
  assert.equal(rejected.status, 400);
  assert.equal(spy.mock.callCount(), 0);
  assert.equal(generations.length, 0);
});

test("research requires both provider keys", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.EXA_API_KEY;
  useOpenAIFake(generation());
  const spy = mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not contact provider");
  });
  const missingExa = await research(
    new Request("http://localhost/api/research", {
      method: "POST",
      body: JSON.stringify({ draft, evidence: [], consent: true }),
    }),
  );
  assert.equal(missingExa.status, 503);
  process.env.EXA_API_KEY = "test-exa-key";
  delete process.env.OPENAI_API_KEY;
  const missingOpenAI = await research(
    new Request("http://localhost/api/research", {
      method: "POST",
      body: JSON.stringify({ draft, evidence: [], consent: true }),
    }),
  );
  assert.equal(missingOpenAI.status, 503);
  assert.equal(spy.mock.callCount(), 0);
});

test("API rejects invalid JSON, cross-origin calls, and oversized bodies", async () => {
  assert.equal(
    (
      await prepare(
        new Request("http://localhost/api/prepare", {
          method: "POST",
          body: "bad json",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await prepare(
        new Request("http://localhost/api/prepare", {
          method: "POST",
          headers: { origin: "https://other.example" },
          body: JSON.stringify(intake),
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await prepare(
        new Request("http://localhost/api/prepare", {
          method: "POST",
          body: "a".repeat(700001),
        }),
      )
    ).status,
    413,
  );
  const sameOrigin = await prepare(
    new Request("http://localhost/api/prepare", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
      body: JSON.stringify({ ...intake, consent: false }),
    }),
  );
  assert.equal(sameOrigin.status, 200);
});
