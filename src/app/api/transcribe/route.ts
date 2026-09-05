import OpenAI from "openai";
import {
  checkOrigin,
  errorResponse,
  json,
  readForm,
  RequestError,
  withCapacity,
} from "@/lib/http";
import { MAX_AUDIO_BYTES, transcriptionLanguage } from "@/lib/speech";

export const runtime = "nodejs";
export const maxDuration = 60;

// Browser MediaRecorder mime -> filename extension for the transcription API.
const AUDIO_FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

// Multipart overhead above the raw audio limit.
const FORM_OVERHEAD_BYTES = 64 * 1024;
const PROVIDER_TIMEOUT_MS = 55_000;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new RequestError("not-configured", 503);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new RequestError("invalid-audio", 400);
    const form = await readForm(request, MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES);
    const audio = form.get("audio");
    if (!(audio instanceof File) || !audio.size)
      throw new RequestError("no-speech", 400);
    if (audio.size > MAX_AUDIO_BYTES)
      throw new RequestError("audio-too-large", 413);
    const mime = audio.type.split(";")[0].trim().toLowerCase();
    const format = AUDIO_FORMATS[mime];
    if (!format) throw new RequestError("audio-format-not-supported", 415);
    const language = parseLanguageHint(form.get("language"));
    const client = new OpenAI({
      apiKey: key,
      baseURL: OPENROUTER_BASE_URL,
      maxRetries: 0,
    });

    return await withCapacity(async () => {
      let text: unknown;
      try {
        const result = await client.audio.transcriptions.create(
          {
            file: new File([audio], `recording.${format}`, {
              type: audio.type,
            }),
            model:
              process.env.OPENROUTER_TRANSCRIPTION_MODEL ||
              "openai/whisper-large-v3",
            ...(language ? { language } : {}),
          },
          { signal: request.signal, timeout: PROVIDER_TIMEOUT_MS },
        );
        text = (result as { text?: unknown })?.text;
      } catch (error) {
        if (error instanceof RequestError) throw error;
        const status = (error as { status?: unknown })?.status;
        if (status === 429) throw new RequestError("rate-limited", 429);
        throw new RequestError("network", 502);
      }
      if (typeof text !== "string") {
        throw new RequestError("network", 502);
      }
      return json({ text });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function parseLanguageHint(
  value: FormDataEntryValue | null,
): string | undefined {
  try {
    if (value !== null && typeof value !== "string") throw new Error();
    return transcriptionLanguage(value ?? "auto");
  } catch {
    throw new RequestError("language-not-supported", 400);
  }
}
