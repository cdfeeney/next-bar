/**
 * Reading an upload body WITHOUT letting the sender decide how much memory it
 * costs (V8-R-STO-014's size bound, the half that runs before anything is
 * parsed).
 *
 * `Content-Length` is a claim. A request may declare 1 KiB and send a gigabyte,
 * and `request.formData()` buffers the whole thing before any size check can
 * look at it — Next.js route handlers impose no cap of their own. So the cap has
 * to be applied to the bytes AS THEY ARRIVE, which is what this module is for.
 *
 * It is a module rather than two private functions in the route because that is
 * also where the route's one untestable dependency lives: multipart parsing.
 * With the boundary here, the bounding logic gets real unit tests over real
 * streams, and the route's own tests can supply a parsed form without needing a
 * multipart parser that works in their environment.
 */

/** What the caller may do with a body it could not accept. */
export type UploadFormFailure = 'too_large' | 'bad_request';

/**
 * Read a stream, giving up the moment it exceeds `limit`.
 *
 * Returns null when the body runs past the cap — the caller refuses without ever
 * having held the whole thing. Chunks are joined only once the total is known to
 * fit, so an oversized body costs `limit` bytes rather than however many the
 * sender chose to send.
 *
 * A missing body reads as empty rather than as an error: the parse is the honest
 * place for that failure.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null | undefined,
  limit: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        // Stop pulling. Without this the sender, not the server, decides how
        // much memory this request costs.
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * The bounded read plus the multipart parse, as one step.
 *
 * The bytes are re-wrapped in a `Response` purely to reach a multipart parser;
 * the content-type header carries the boundary, so it has to come along.
 */
export async function readUploadForm(
  request: Request,
  limit: number,
): Promise<FormData | UploadFormFailure> {
  const bytes = await readBoundedBody(request.body, limit);
  if (bytes === null) return 'too_large';

  try {
    return await new Response(bytes, {
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
    }).formData();
  } catch {
    return 'bad_request';
  }
}
