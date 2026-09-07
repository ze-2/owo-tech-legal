import OpenAI from "openai";
import { RequestError } from "./http";

/** Shared server-side Whisper provider for browser recordings and Telegram voice. */
export async function transcribeRecording(
  audio: File,
  format: string,
  language?: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new RequestError("not-configured", 503);
  const client = new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
    maxRetries: 0,
  });
  let text: unknown;
  try {
    const result = await client.audio.transcriptions.create(
      {
        file: new File([audio], `recording.${format}`, { type: audio.type }),
        model: process.env.OPENROUTER_TRANSCRIPTION_MODEL || "openai/whisper-large-v3",
        ...(language ? { language } : {}),
      },
      { signal, timeout: 55_000 },
    );
    text = (result as { text?: unknown })?.text;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if ((error as { status?: unknown })?.status === 429)
      throw new RequestError("rate-limited", 429);
    throw new RequestError("network", 502);
  }
  if (typeof text !== "string") throw new RequestError("network", 502);
  return text;
}
