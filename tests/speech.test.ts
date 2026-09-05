import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { POST } from "../src/app/api/transcribe/route";
import {
  recognitionConstructor,
  transcribeAudio,
  transcriptionLanguage,
} from "../src/lib/speech";

const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_TRANSCRIPTION_MODEL;
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of Object.entries({
    OPENROUTER_API_KEY: originalKey,
    OPENROUTER_TRANSCRIPTION_MODEL: originalModel,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function recording(language?: string, type = "audio/webm;codecs=opus") {
  const body = new FormData();
  body.set("audio", new Blob(["audio bytes"], { type }), "recording");
  if (language) body.set("language", language);
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body,
  });
}

test("language hints normalize locales and auto detection omits the hint", () => {
  for (const [locale, code] of [
    ["en-SG", "en"],
    ["zh-CN", "zh"],
    ["ms-MY", "ms"],
    ["ta-IN", "ta"],
    ["fr-FR", "fr"],
  ]) {
    assert.equal(transcriptionLanguage(locale), code);
  }
  assert.equal(transcriptionLanguage("auto"), undefined);
  assert.equal(transcriptionLanguage(""), undefined);
  assert.throws(
    () => transcriptionLanguage("English"),
    /language-not-supported/,
  );
  assert.equal(recognitionConstructor(), undefined);
});

test("Whisper requests keep credentials on the server and preserve multilingual text", async () => {
  process.env.OPENROUTER_API_KEY = "test-secret";
  delete process.env.OPENROUTER_TRANSCRIPTION_MODEL;
  const transcripts = [
    "Hello.",
    "我付了订金。",
    "Saya sudah bayar.",
    "நான் பணம் செலுத்தினேன்.",
  ];
  const languages = ["en-SG", "zh-CN", "ms-MY", "ta-IN"];
  let index = 0;
  mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(
      String(url),
      "https://openrouter.ai/api/v1/audio/transcriptions",
    );
    const headers = new Headers(init.headers as HeadersInit);
    assert.equal(headers.get("authorization"), "Bearer test-secret");
    const body = init.body as FormData;
    assert.equal(body.get("model"), "openai/whisper-large-v3");
    assert.equal(body.get("language"), languages[index].split("-")[0]);
    const file = body.get("file");
    assert.ok(file instanceof File);
    assert.match(file.name, /\.webm$/);
    assert.equal(await file.text(), "audio bytes");
    return Response.json({ text: transcripts[index++] });
  });
  for (let i = 0; i < languages.length; i++) {
    const response = await POST(recording(languages[i]));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { text: transcripts[i] });
  }
});

test("auto detection, MP4 recording and model override reach the provider", async () => {
  process.env.OPENROUTER_API_KEY = "test-secret";
  process.env.OPENROUTER_TRANSCRIPTION_MODEL = "openai/whisper-1";
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = init.body as FormData;
    assert.equal(body.get("model"), "openai/whisper-1");
    const file = body.get("file");
    assert.ok(file instanceof File);
    assert.match(file.name, /\.m4a$/);
    assert.equal(body.has("language"), false);
    return Response.json({ text: "Bonjour." });
  });
  assert.equal((await POST(recording("auto", "audio/mp4"))).status, 200);
});

test("invalid requests and missing configuration do not call the provider", async () => {
  const provider = mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected request");
  });
  delete process.env.OPENROUTER_API_KEY;
  assert.equal((await POST(recording())).status, 503);
  process.env.OPENROUTER_API_KEY = "test-secret";
  assert.equal((await POST(recording("English"))).status, 400);
  assert.equal((await POST(recording("auto", "text/plain"))).status, 415);
  const crossOrigin = recording();
  crossOrigin.headers.set("origin", "https://elsewhere.example");
  assert.equal((await POST(crossOrigin)).status, 403);
  const tooLarge = recording();
  tooLarge.headers.set("content-length", String(11 * 1024 * 1024));
  assert.equal((await POST(tooLarge)).status, 413);
  assert.equal(provider.mock.callCount(), 0);
});

test("upstream errors and malformed responses do not expose provider details", async () => {
  process.env.OPENROUTER_API_KEY = "test-secret";
  const replies = [
    Response.json({ error: "private provider details" }, { status: 401 }),
    Response.json({}),
    new Response("invalid json"),
    Response.json({}, { status: 429 }),
  ];
  mock.method(globalThis, "fetch", async (url: unknown) => {
    // The OpenAI SDK probes FormData support with a local data: request.
    if (String(url).startsWith("data:")) return new Response("probe");
    return replies.shift()!;
  });
  for (const status of [502, 502, 502, 429]) {
    const response = await POST(recording());
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private provider details/);
  }
});

test("browser transcription forwards cancellation and rejects empty transcripts", async () => {
  const controller = new AbortController();
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/transcribe");
    assert.equal(init.signal, controller.signal);
    assert.equal((init.body as FormData).has("language"), false);
    return Response.json({ text: "   " });
  });
  await assert.rejects(
    transcribeAudio(new Blob(["audio"]), "auto", controller.signal),
    /no-speech/,
  );
});
