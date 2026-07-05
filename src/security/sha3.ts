const MASK_64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
] as const;

const RHO_OFFSETS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
] as const;

/** SHA3 digest compatible with .NET/BouncyCastle SHA3. Supports 224/256/384/512 bits. */
export function sha3(data: Uint8Array, bitLength = 256): Uint8Array {
  if (![224, 256, 384, 512].includes(bitLength))
    throw new RangeError("SHA3 bit length must be 224, 256, 384, or 512.");

  const outputLength = bitLength / 8;
  const rate = 200 - outputLength * 2;
  const state = new Array<bigint>(25).fill(0n);

  let offset = 0;
  while (offset + rate <= data.length) {
    absorbBlock(state, data.subarray(offset, offset + rate), rate);
    keccakF1600(state);
    offset += rate;
  }

  const block = new Uint8Array(rate);
  block.set(data.subarray(offset));
  block[data.length - offset] ^= 0x06;
  block[rate - 1] ^= 0x80;
  absorbBlock(state, block, rate);
  keccakF1600(state);

  return squeeze(state, rate, outputLength);
}

export const sha3_256 = (data: Uint8Array): Uint8Array => sha3(data, 256);
export const sha3_512 = (data: Uint8Array): Uint8Array => sha3(data, 512);

function absorbBlock(state: bigint[], block: Uint8Array, rate: number): void {
  for (let i = 0; i < rate; i++) {
    const lane = i >> 3;
    const shift = BigInt((i & 7) * 8);
    state[lane] = (state[lane] ^ (BigInt(block[i]) << shift)) & MASK_64;
  }
}

function squeeze(state: bigint[], rate: number, outputLength: number): Uint8Array {
  const out = new Uint8Array(outputLength);
  let produced = 0;
  while (produced < outputLength) {
    for (let i = 0; i < rate && produced < outputLength; i++) {
      const lane = state[i >> 3];
      out[produced++] = Number((lane >> BigInt((i & 7) * 8)) & 0xffn);
    }
    if (produced < outputLength) keccakF1600(state);
  }
  return out;
}

function keccakF1600(a: bigint[]): void {
  const b = new Array<bigint>(25).fill(0n);
  const c = new Array<bigint>(5).fill(0n);
  const d = new Array<bigint>(5).fill(0n);

  for (const rc of ROUND_CONSTANTS) {
    for (let x = 0; x < 5; x++)
      c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];

    for (let x = 0; x < 5; x++)
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);

    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) a[x + 5 * y] = (a[x + 5 * y] ^ d[x]) & MASK_64;
    }

    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const source = x + 5 * y;
        const target = y + 5 * ((2 * x + 3 * y) % 5);
        b[target] = rotl64(a[source], RHO_OFFSETS[source]);
      }
    }

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        a[x + 5 * y] =
          (b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y] & MASK_64) & b[((x + 2) % 5) + 5 * y])) &
          MASK_64;
      }
    }

    a[0] = (a[0] ^ rc) & MASK_64;
  }
}

function rotl64(value: bigint, bits: number): bigint {
  if (bits === 0) return value & MASK_64;
  const n = BigInt(bits);
  return ((value << n) | (value >> (64n - n))) & MASK_64;
}
