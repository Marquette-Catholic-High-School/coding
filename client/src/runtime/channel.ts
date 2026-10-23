// Blocking line input for workers over a SharedArrayBuffer.
//
// Layout: Int32 [0] = state, Int32 [1] = byte length of the line, then the UTF-8 bytes of the line.
// The worker sets the state to IDLE, posts an 'input-request' message and blocks in `Atomics.wait` while the
// state is IDLE. The main thread writes the line (or EOF) and flips the state, which wakes the worker; the worker
// copies the line out and resets the state to IDLE. Only one line is in flight at a time.

const HEADER_BYTES = 8;
/** Room for one line of input. Longer lines are cut at a character boundary. */
export const INPUT_CHANNEL_CAPACITY = 256 * 1024;

export const CHANNEL_IDLE = 0;
export const CHANNEL_LINE = 1;
export const CHANNEL_EOF = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createInputChannel(capacity: number = INPUT_CHANNEL_CAPACITY): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER_BYTES + capacity);
}

function header(channel: SharedArrayBuffer): Int32Array {
  return new Int32Array(channel, 0, 2);
}

/** UTF-8 bytes of `text`, cut to at most `max` bytes without splitting a character. */
export function encodeLimited(text: string, max: number): Uint8Array {
  const bytes = encoder.encode(text);
  if (bytes.length <= max) return bytes;
  let end = max;
  // Step back over continuation bytes (10xxxxxx) so the cut lands on a character boundary.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

/** Main thread: deliver a line (without "\n") to the waiting worker. */
export function writeInputLine(channel: SharedArrayBuffer, line: string): void {
  const bytes = encodeLimited(line, channel.byteLength - HEADER_BYTES);
  new Uint8Array(channel, HEADER_BYTES, bytes.length).set(bytes);
  const h = header(channel);
  Atomics.store(h, 1, bytes.length);
  Atomics.store(h, 0, CHANNEL_LINE);
  Atomics.notify(h, 0);
}

/** Main thread: tell the waiting worker that input has ended (or that the run is being stopped). */
export function writeInputEof(channel: SharedArrayBuffer): void {
  const h = header(channel);
  Atomics.store(h, 0, CHANNEL_EOF);
  Atomics.notify(h, 0);
}

/** Worker: call before posting an input request so a stale value is never read. */
export function resetInputChannel(channel: SharedArrayBuffer): void {
  Atomics.store(header(channel), 0, CHANNEL_IDLE);
}

/** Worker: block until the main thread writes a line (returned without "\n") or EOF (null). */
export function readInputLine(channel: SharedArrayBuffer): string | null {
  const h = header(channel);
  for (;;) {
    const state = Atomics.load(h, 0);
    if (state === CHANNEL_LINE) {
      const length = Atomics.load(h, 1);
      // TextDecoder refuses views on shared memory in some browsers, so copy first.
      const copy = new Uint8Array(length);
      copy.set(new Uint8Array(channel, HEADER_BYTES, length));
      Atomics.store(h, 0, CHANNEL_IDLE);
      return decoder.decode(copy);
    }
    if (state === CHANNEL_EOF) {
      Atomics.store(h, 0, CHANNEL_IDLE);
      return null;
    }
    Atomics.wait(h, 0, CHANNEL_IDLE);
  }
}
