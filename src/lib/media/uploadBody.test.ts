import { describe, expect, it, vi } from 'vitest';

import { readBoundedBody } from './uploadBody';

/**
 * V8-R-STO-014's size bound, the half that runs before anything is parsed.
 *
 * Content-Length is a claim. A request may declare 1 KiB and send a gigabyte,
 * and the multipart parser buffers the whole body before any per-file size check
 * can look at it. These assertions pin the only thing standing between that and
 * process memory: that the read STOPS at the cap rather than discovering
 * afterwards that it should have.
 *
 * The parse itself is not tested here and cannot be: undici's `formData()`
 * builds each part with the global `File` and then rejects it with its own
 * `webidl.is.File`, because vitest's jsdom environment has replaced that global.
 */

/** A stream that hands over `chunks` and records how many were actually pulled. */
function streamOf(...chunks: Uint8Array[]) {
  const pulled: number[] = [];
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      pulled.push(index);
      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
  return { stream, pulled };
}

const bytes = (length: number, fill = 7) => new Uint8Array(length).fill(fill);

describe('readBoundedBody — the sender does not choose the memory cost', () => {
  it('returns the body when it fits', async () => {
    const { stream } = streamOf(bytes(4, 1), bytes(4, 2));
    const result = await readBoundedBody(stream, 16);
    expect(result).not.toBeNull();
    expect(result?.byteLength).toBe(8);
  });

  it('joins the chunks in order', async () => {
    const { stream } = streamOf(new Uint8Array([1, 2]), new Uint8Array([3, 4]));
    const result = await readBoundedBody(stream, 16);
    expect(Array.from(result ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('accepts a body exactly at the cap', async () => {
    const { stream } = streamOf(bytes(8));
    expect((await readBoundedBody(stream, 8))?.byteLength).toBe(8);
  });

  it('refuses one byte past the cap', async () => {
    const { stream } = streamOf(bytes(9));
    await expect(readBoundedBody(stream, 8)).resolves.toBeNull();
  });

  // THE POINT OF THE WHOLE FUNCTION. A body that lies about its size must cost
  // the cap, not whatever the sender decided to send, so the read has to stop
  // pulling the moment the total goes over rather than draining the stream and
  // measuring at the end.
  it('stops pulling as soon as the total exceeds the cap', async () => {
    const { stream, pulled } = streamOf(bytes(4), bytes(4), bytes(4), bytes(4));
    await expect(readBoundedBody(stream, 6)).resolves.toBeNull();
    expect(pulled).toEqual([0, 1]);
  });

  it('cancels the stream it gave up on', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(bytes(32)); },
      cancel,
    });
    await expect(readBoundedBody(stream, 8)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  // A missing body is not an error here: the parse is the honest place for that
  // failure, and treating it as oversized would report the wrong reason.
  it('reads a missing body as empty rather than as a refusal', async () => {
    expect((await readBoundedBody(null, 8))?.byteLength).toBe(0);
    expect((await readBoundedBody(undefined, 8))?.byteLength).toBe(0);
  });

  it('accepts an empty stream', async () => {
    const { stream } = streamOf();
    expect((await readBoundedBody(stream, 8))?.byteLength).toBe(0);
  });
});
