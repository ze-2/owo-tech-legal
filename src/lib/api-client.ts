/**
 * Sits above the server's own provider budget so the server wins the race and
 * the user sees its sanitised message rather than a bare client abort.
 */
const API_TIMEOUT_MS = 65000;

/** Carries the HTTP status so callers can tell "busy" from "failed". */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (error) {
    // A caller-driven abort is a superseded request, not a failure to report.
    if (signal?.aborted) throw error;
    throw new Error(
      "The request timed out. Please retry, or continue with basic organisation.",
    );
  }
  // A platform timeout or proxy error returns HTML, not our JSON envelope;
  // parsing that unguarded surfaced a raw SyntaxError to the user.
  let data: { error?: string } | null = null;
  try {
    data = (await response.json()) as { error?: string };
  } catch {
    data = null;
  }
  if (!response.ok)
    throw new ApiError(
      data?.error || "Something went wrong. Please try again.",
      response.status,
    );
  if (data === null)
    throw new ApiError("The server returned an unreadable response.", 502);
  return data as T;
}
