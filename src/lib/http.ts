export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const DEFAULT_BODY_LIMIT = 700_000;
const TOO_LARGE_MESSAGE =
  "This request is too large. Use fewer or smaller documents.";

export async function readBody(
  request: Request,
  limit = DEFAULT_BODY_LIMIT,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) {
    throw new RequestError(TOO_LARGE_MESSAGE, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("The request is empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new RequestError(TOO_LARGE_MESSAGE, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatChunks(chunks, total);
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await readBody(request)));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("The request must contain valid JSON.");
  }
}

/** Parse a multipart body that was already size-checked by readBody. */
export async function readForm(
  request: Request,
  limit: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  const bytes = await readBody(request, limit);
  try {
    return await new Response(bytes as BodyInit, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new RequestError("The request must contain a valid form upload.");
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function errorResponse(error: unknown) {
  return json(
    {
      error:
        error instanceof RequestError
          ? error.message
          : "We couldn’t complete this request. Please try again.",
    },
    error instanceof RequestError ? error.status : 500,
  );
}

// Bound concurrent provider work per process. A public deployment also needs a
// shared rate limiter and authentication at its ingress (see README).
const MAX_CONCURRENT_PROVIDER_CALLS = 3;
let activeProviderCalls = 0;

export async function withCapacity<T>(work: () => Promise<T>): Promise<T> {
  if (activeProviderCalls >= MAX_CONCURRENT_PROVIDER_CALLS) {
    throw new RequestError(
      "The server is handling too many AI requests right now. Please try again shortly.",
      429,
    );
  }
  activeProviderCalls++;
  try {
    return await work();
  } finally {
    activeProviderCalls--;
  }
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const url = new URL(request.url);
  // Next may normalise request.url to localhost behind the dev server/proxy.
  // Compare against the actual incoming host and proxy scheme as well.
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const scheme = forwardedProto || url.protocol.slice(0, -1);
  const host = request.headers.get("host") || url.host;
  const expected = `${scheme}://${host}`;
  if (origin !== expected)
    throw new RequestError("This request must come from the app.", 403);
}
