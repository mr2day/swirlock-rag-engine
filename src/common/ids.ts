import { createHash, randomBytes } from 'node:crypto';

let lastTimestamp = 0;
let sequence = 0;

export function createUuidV7(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    sequence = (sequence + 1) & 0xfff;
  } else {
    lastTimestamp = now;
    sequence = 0;
  }

  const random = randomBytes(10);
  const bytes = new Uint8Array(16);
  const timestamp = BigInt(now);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | (random[0] & 0x3f);

  for (let index = 9; index < 16; index += 1) {
    bytes[index] = random[index - 8];
  }

  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

export function createDeterministicUuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
