import { z } from "zod";
import { relevantSnippet } from "./research-footnotes";
import {
  type Citation,
  type Draft,
  type Evidence,
  type Research,
  type ResearchSection,
} from "./claim";
import { isOfficialSource, researchTopics, topicQuery } from "./sources";
import {
  generateResearchFields,
  type ProviderCallOptions,
  type RetrievedSource,
} from "./openai";
import { RequestError } from "./http";

// Exa is now retrieval-only. All text generation (organisation, research
// drafting, conversation interpretation) runs through OpenAI in ./openai.
// Case text is never sent to Exa: search queries use categories only, and the
// draft/evidence synthesis context goes to OpenAI alone.
const searchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      url: z.string(),
      text: z.string().optional(),
      highlights: z.array(z.string()).optional(),
    }),
  ),
});

export type ExaSearchResult = z.infer<typeof searchResponseSchema>["results"];

const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const EXA_REQUEST_TIMEOUT_MS = 20000;
/**
 * Whole-request budget for the five concurrent sections, kept below the route's
 * maxDuration so a slow section degrades to "unavailable" (which the UI already
 * renders) rather than the platform killing the request.
 */
const RESEARCH_BUDGET_MS = 50000;
const EXA_RESULTS_PER_QUERY = 4;
const EXA_MAX_CHARACTERS = 6000;
const EXA_MAX_AGE_HOURS = 24;
const EXA_OFFICIAL_DOMAINS = [
  "www.judiciary.gov.sg/civil",
  "www.judiciary.gov.sg/docs",
  "cjts.judiciary.gov.sg",
];

const GUIDANCE_FIELDS = ["guidance", "counterpoint", "missingInfo"] as const;

/** Retrieval-only Exa search restricted to official Judiciary sources. */
export async function searchSources(
  query: string,
  options: ProviderCallOptions = {},
): Promise<ExaSearchResult> {
  const key = process.env.EXA_API_KEY;
  if (!key)
    throw new RequestError(
      "Live research is not configured. Add EXA_API_KEY on the server.",
      503,
    );
  let response: Response;
  try {
    response = await fetch(EXA_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        type: "auto",
        includeDomains: EXA_OFFICIAL_DOMAINS,
        numResults: EXA_RESULTS_PER_QUERY,
        contents: {
          text: { maxCharacters: EXA_MAX_CHARACTERS },
          highlights: true,
          maxAgeHours: EXA_MAX_AGE_HOURS,
        },
      }),
      // Bound retrieval by the request's own deadline as well as its own
      // timeout, and cancel it when the browser disconnects.
      signal: retrievalSignal(options),
      cache: "no-store",
    });
  } catch {
    throw new RequestError(
      "Exa could not be reached in time. Your draft is still available; retry research shortly.",
      502,
    );
  }
  if (!response.ok)
    throw new RequestError(toSearchErrorMessage(response.status), 502);
  const parsed = searchResponseSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new RequestError(
      "Exa returned an unexpected response. Please retry.",
      502,
    );
  return parsed.data.results;
}

/**
 * Retrieval must not outlive the request that asked for it. Combine its own
 * timeout with any remaining deadline and the inbound client signal.
 */
function retrievalSignal(options: ProviderCallOptions): AbortSignal {
  const budget = options.deadline
    ? Math.max(0, options.deadline - Date.now())
    : EXA_REQUEST_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(
    Math.min(EXA_REQUEST_TIMEOUT_MS, budget),
  );
  return options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
}

function toSearchErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "The server’s Exa API key was not accepted. Check its configuration.";
  }
  if (status === 429)
    return "Exa’s rate limit was reached. Please retry shortly.";
  return "Exa could not complete this search. Please retry.";
}

export async function researchSection(
  id: string,
  draft: Draft,
  evidence: Evidence[],
  options: ProviderCallOptions = {},
): Promise<ResearchSection> {
  const topic = researchTopics.find((item) => item.id === id)!;
  const query = topicQuery(id, draft, evidence);
  // Retrieval (Exa) then grounded generation (OpenAI). Model citations are
  // claims until intersected with the retrieved URL set and the allowlist;
  // do not display a generated field without that grounding.
  const results = await searchSources(query, options);
  const retrieved: RetrievedSource[] = results.map((item) => ({
    title: item.title,
    url: item.url,
    text: item.text,
    highlights: item.highlights,
  }));
  const generated = await generateResearchFields({
    sectionTitle: topic.title,
    draft,
    evidence,
    retrieved,
    options,
  });
  const retrievedUrls = new Set(
    results
      .filter((item) => isOfficialSource(item.url))
      .map((item) => item.url),
  );
  const fieldSources: Record<string, Citation[]> = {};
  for (const key of GUIDANCE_FIELDS) {
    const citations = (generated.citations[key] ?? [])
      .filter(
        (item) => isOfficialSource(item.url) && retrievedUrls.has(item.url),
      )
      .map((item) => {
        const retrieved = results.find(source => source.url === item.url)!;
        const snippet = relevantSnippet(retrieved, generated[key]);
        return {
          title: retrieved.title || "Singapore Judiciary",
          url: item.url,
          ...(snippet ? { snippet } : {}),
        };
      });
    if (citations.length) fieldSources[key] = citations;
  }
  if (!fieldSources.guidance?.length)
    throw new RequestError(
      "No verifiable official citation was returned for this section. Please retry or read the official guide.",
      502,
    );
  const citations = [
    ...new Map(
      Object.values(fieldSources)
        .flat()
        .map((source) => [source.url, source]),
    ).values(),
  ];
  const hasCounterpoint = (fieldSources.counterpoint?.length ?? 0) > 0;
  const hasMissingInfo = (fieldSources.missingInfo?.length ?? 0) > 0;
  return {
    id,
    title: topic.title,
    query,
    status: "live",
    guidance: generated.guidance,
    counterpoint: hasCounterpoint
      ? generated.counterpoint
      : "No source-backed counterpoint was returned. Check the conditions in the official guide.",
    missingInfo: hasMissingInfo
      ? generated.missingInfo
      : "Review this section against the official source and confirm any missing facts.",
    sources: citations,
    fieldSources,
  };
}

export async function researchClaim(
  draft: Draft,
  evidence: Evidence[],
  options: ProviderCallOptions = {},
): Promise<Research> {
  // One deadline shared by all five concurrent sections, so a slow section
  // cannot push the whole request past the route limit.
  const shared: ProviderCallOptions = {
    ...options,
    deadline: options.deadline ?? Date.now() + RESEARCH_BUDGET_MS,
  };
  const results = await Promise.allSettled(
    researchTopics.map((topic) =>
      researchSection(topic.id, draft, evidence, shared),
    ),
  );
  const sections: ResearchSection[] = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const { source, ...topic } = researchTopics[index];
    return {
      ...topic,
      query: topicQuery(topic.id, draft, evidence),
      status: "unavailable",
      fieldSources: { guidance: [source] },
      sources: [source],
      error:
        result.reason instanceof RequestError
          ? result.reason.message
          : "This section could not be researched. Please retry.",
    };
  });
  return {
    sections,
    retrievedAt: new Date().toISOString(),
    mode: sections.every((section) => section.status === "live")
      ? "live"
      : "partial",
  };
}
