import { describe, expect, it } from 'vitest';
import {
  CHANNEL_IDLE,
  createInputChannel,
  encodeLimited,
  readInputLine,
  resetInputChannel,
  writeInputEof,
  writeInputLine,
} from './channel';

describe('input channel', () => {
  it('delivers a line written before the reader looks', () => {
    const channel = createInputChannel();
    resetInputChannel(channel);
    writeInputLine(channel, 'Sam');
    expect(readInputLine(channel)).toBe('Sam');
    expect(Atomics.load(new Int32Array(channel, 0, 1), 0)).toBe(CHANNEL_IDLE);
  });

  it('round-trips empty lines and non-ASCII text', () => {
    const channel = createInputChannel();
    writeInputLine(channel, '');
    expect(readInputLine(channel)).toBe('');
    writeInputLine(channel, 'héllo wörld ← 😀');
    expect(readInputLine(channel)).toBe('héllo wörld ← 😀');
  });

  it('signals end of input as null', () => {
    const channel = createInputChannel();
    writeInputEof(channel);
    expect(readInputLine(channel)).toBeNull();
  });

  it('a shorter line after a longer one is not padded with old bytes', () => {
    const channel = createInputChannel();
    writeInputLine(channel, 'a much longer line');
    readInputLine(channel);
    writeInputLine(channel, 'hi');
    expect(readInputLine(channel)).toBe('hi');
  });

  it('cuts lines that do not fit at a character boundary', () => {
    const channel = createInputChannel(5);
    writeInputLine(channel, 'abcdéf');
    // "abcd" is 4 bytes and "é" needs 2, so only "abcd" fits in 5 bytes.
    expect(readInputLine(channel)).toBe('abcd');
  });
});

describe('encodeLimited', () => {
  it('keeps text that fits', () => {
    expect(new TextDecoder().decode(encodeLimited('abc', 10))).toBe('abc');
  });

  it('never splits a multi-byte character', () => {
    const bytes = encodeLimited('😀😀', 6);
    expect(bytes.length).toBe(4);
    expect(new TextDecoder().decode(bytes)).toBe('😀');
  });
});
