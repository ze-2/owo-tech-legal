import { intakeSchema, organiseLocally } from "@/lib/claim";
import { organiseWithOpenAI } from "@/lib/openai";
import {
  checkOrigin,
  errorResponse,
  json,
  readJson,
  RequestError,
  withCapacity,
} from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const parsed = intakeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new RequestError(parsed.error.issues[0].message);
    const live = parsed.data.consent && Boolean(process.env.OPENAI_API_KEY);
    const draft = live
      ? await withCapacity(() =>
          organiseWithOpenAI(parsed.data, { signal: request.signal }),
        )
      : organiseLocally(parsed.data);
    return json({ draft, mode: live ? "ai" : "basic" });
  } catch (error) {
    return errorResponse(error);
  }
}
