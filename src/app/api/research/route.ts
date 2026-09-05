import { z } from "zod";
import { draftSchema, evidenceSchema } from "@/lib/claim";
import { researchClaim } from "@/lib/exa";
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
const schema = z.object({
  draft: draftSchema,
  evidence: z.array(evidenceSchema).max(10),
  consent: z.literal(true),
});

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new RequestError(
        "Review your draft and allow AI research before continuing.",
      );
    if (!process.env.EXA_API_KEY || !process.env.OPENAI_API_KEY)
      throw new RequestError(
        "Live research is not configured. Add EXA_API_KEY and OPENAI_API_KEY on the server.",
        503,
      );
    return json(
      await withCapacity(() =>
        researchClaim(parsed.data.draft, parsed.data.evidence),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
