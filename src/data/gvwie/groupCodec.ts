/**
 * Generic group-varint codec core (port of the shared structure of C#'s
 * `Gvwie.GroupIntNNCodec` family). One header byte frames a run:
 * `1 | countField[countBits] | (width-1)[widthBits]`, where `countBits +
 * widthBits === 7`. Values ≤ 7 bits take a single literal byte. Signed widths
 * zig-zag; unsigned widths store the value directly. Everything is computed in
 * `bigint` so a single implementation serves the 16/32/64-bit variants.
 */
export interface GroupConfig {
  /** Bits in the header's count field (16→6, 32→5, 64→4). */
  countBits: number;
  /** Maximum payload width in bytes (16→2, 32→4, 64→8). */
  maxWidth: number;
  /** Total value width in bits (16/32/64) — used for the zig-zag mask. */
  bits: number;
  /** Whether values are zig-zag encoded (signed) or stored directly. */
  signed: boolean;
}

function build(cfg: GroupConfig) {
  const widthBits = 7 - cfg.countBits;
  const countFieldMax = (1 << cfg.countBits) - 1;
  const maxShortField = countFieldMax - 4; // extended uses the top 4 field values
  const shortMaxCount = maxShortField + 1;
  const widthMask = (1 << widthBits) - 1;
  const valueMask = (1n << BigInt(cfg.bits)) - 1n;

  const toZ = cfg.signed
    ? (v: bigint): bigint => ((v << 1n) ^ (v >> BigInt(cfg.bits - 1))) & valueMask
    : (v: bigint): bigint => v & valueMask;
  const fromZ = cfg.signed
    ? (u: bigint): bigint => (u >> 1n) ^ -(u & 1n)
    : (u: bigint): bigint => u;

  const widthOf = (z: bigint): number => {
    let w = 0;
    let t = z;
    while (t > 0n) {
      w++;
      t >>= 8n;
    }
    return Math.min(Math.max(w, 1), cfg.maxWidth);
  };

  const lolOf = (extra: number): number => {
    if (extra <= 0xff) return 1;
    if (extra <= 0xffff) return 2;
    if (extra <= 0xffffff) return 3;
    return 4;
  };

  const writeLE = (dst: number[], value: bigint, width: number): void => {
    for (let i = 0; i < width; i++) dst.push(Number((value >> BigInt(8 * i)) & 0xffn));
  };

  const readLE = (src: Uint8Array, pos: { i: number }, width: number): bigint => {
    if (pos.i + width > src.length)
      throw new RangeError("Buffer underflow while reading group payload.");
    let v = 0n;
    for (let i = 0; i < width; i++) v |= BigInt(src[pos.i++]) << BigInt(8 * i);
    return v;
  };

  function encode(values: bigint[]): Uint8Array {
    const dst: number[] = [];
    let i = 0;

    while (i < values.length) {
      const zz = toZ(values[i]);
      if (zz <= 0x7fn) {
        dst.push(Number(zz));
        i++;
        continue;
      }

      const start = i;
      const width = widthOf(zz);
      let count = 1;
      while (i + count < values.length) {
        const z2 = toZ(values[i + count]);
        if (z2 <= 0x7fn) break;
        if (widthOf(z2) !== width) break;
        count++;
      }

      if (count <= shortMaxCount) {
        dst.push((0x80 | ((count - 1) << widthBits) | ((width - 1) & widthMask)) & 0xff);
      } else {
        const extra = count - (shortMaxCount + 1);
        const lol = lolOf(extra);
        const groupBits = maxShortField + lol;
        dst.push((0x80 | (groupBits << widthBits) | ((width - 1) & widthMask)) & 0xff);
        writeLE(dst, BigInt(extra), lol);
      }

      for (let k = 0; k < count; k++) writeLE(dst, toZ(values[start + k]), width);
      i += count;
    }

    return Uint8Array.from(dst);
  }

  function decode(src: Uint8Array, start = 0, end = src.length): bigint[] {
    const result: bigint[] = [];
    const pos = { i: start };

    while (pos.i < end) {
      const h = src[pos.i++];
      if ((h & 0x80) === 0) {
        result.push(fromZ(BigInt(h & 0x7f)));
        continue;
      }

      const countField = (h >> widthBits) & countFieldMax;
      const width = (h & widthMask) + 1;

      let count: number;
      if (countField <= maxShortField) {
        count = countField + 1;
      } else {
        const lol = countField - maxShortField;
        const extra = Number(readLE(src, pos, lol));
        count = shortMaxCount + 1 + extra;
      }

      for (let j = 0; j < count; j++) result.push(fromZ(readLE(src, pos, width)));
    }

    return result;
  }

  return { encode, decode };
}

/** A group codec over JS `number` arrays (16/32-bit widths). */
export function makeNumberCodec(cfg: GroupConfig) {
  const core = build(cfg);
  return {
    encode: (values: ArrayLike<number>): Uint8Array =>
      core.encode(Array.from(values, (v) => BigInt(v))),
    decode: (src: Uint8Array, start?: number, end?: number): number[] =>
      core.decode(src, start, end).map((v) => Number(v)),
  };
}

/** A group codec over JS `bigint` arrays (64-bit widths). */
export function makeBigIntCodec(cfg: GroupConfig) {
  const core = build(cfg);
  return {
    encode: (values: ArrayLike<bigint>): Uint8Array => core.encode(Array.from(values)),
    decode: (src: Uint8Array, start?: number, end?: number): bigint[] =>
      core.decode(src, start, end),
  };
}
