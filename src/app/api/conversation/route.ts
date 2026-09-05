import {
  conversationSchema,
  finishConversation,
  localConversation,
} from "@/lib/conversation";
import { organiseConversationWithOpenAI } from "@/lib/openai";
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
    const parsed = conversationSchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new RequestError(
        "Keep your conversation within 30,000 characters and attach at most 10 documents.",
      );
    const { original, outcome, evidence, consent } = parsed.data;
    const live = consent && Boolean(process.env.OPENAI_API_KEY);
    const result = live
      ? await withCapacity(() =>
          organiseConversationWithOpenAI(original, outcome, evidence),
        )
      : localConversation(original, outcome, evidence);
    return json({
      ...finishConversation(result, original),
      mode: live ? "ai" : "basic",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
