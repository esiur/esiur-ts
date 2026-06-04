/**
 * Group-varint zig-zag codec for `Int32` arrays (port of C#
 * `Gvwie.GroupInt32Codec`). Values are zig-zag encoded; small values (≤7 bits)
 * take a single literal byte, while runs of same-width values share a group
 * header `1 | count'[5] | (width-1)[2]` followed by little-endian payloads.
 */

function zigZag32(v: number): number {
  return ((v << 1) ^ (v >> 31)) >>> 0;
}

function unZigZag32(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

function widthFromZigZag(z: number, aligned = false): number {
  if (z <= 0xff) return 1;
  if (z <= 0xffff) return 2;
  if (z <= 0xffffff) return aligned ? 4 : 3;
  return 4;
}

function lengthOfLength(value: number): number {
  if (value <= 0xff) return 1;
  if (value <= 0xffff) return 2;
  if (value <= 0xffffff) return 3;
  return 4;
}

function writeLE(dst: number[], value: number, width: number): void {
  for (let i = 0; i < width; i++) dst.push((value >>> (8 * i)) & 0xff);
}

function readLE(src: Uint8Array, pos: { i: number }, width: number): number {
  if (pos.i + width > src.length)
    throw new RangeError("Buffer underflow while reading group payload.");
  let v = 0;
  for (let i = 0; i < width; i++) v += src[pos.i++] * 2 ** (8 * i);
  return v >>> 0;
}

export const GroupInt32Codec = {
  encode(values: ArrayLike<number>, aligned = false): Uint8Array {
    const dst: number[] = [];
    let i = 0;

    while (i < values.length) {
      const zz = zigZag32(values[i]);

      // Fast path: single literal byte when zig-zag fits in 7 bits.
      if (zz <= 0x7f) {
        dst.push(zz);
        i++;
        continue;
      }

      const start = i;
      const width = widthFromZigZag(zz, aligned);
      let count = 1;

      while (i + count < values.length) {
        const z2 = zigZag32(values[i + count]);
        if (z2 <= 0x7f) break;
        if (widthFromZigZag(z2, aligned) !== width) break;
        count++;
      }

      if (count <= 28) {
        let header = 0x80;
        header |= ((count - 1) & 0x1f) << 2;
        header |= (width - 1) & 0x03;
        dst.push(header & 0xff);
      } else {
        const extra = count - 29;
        const lol = lengthOfLength(extra);
        const groupBits = lol === 1 ? 0b11100 : lol === 2 ? 0b11101 : lol === 3 ? 0b11110 : 0b11111;
        let header = 0x80;
        header |= groupBits << 2;
        header |= (width - 1) & 0x03;
        dst.push(header & 0xff);
        writeLE(dst, extra, lol);
      }

      for (let k = 0; k < count; k++) writeLE(dst, zigZag32(values[start + k]), width);
      i += count;
    }

    return Uint8Array.from(dst);
  },

  decode(src: Uint8Array, start = 0, end = src.length): number[] {
    const result: number[] = [];
    const pos = { i: start };

    while (pos.i < end) {
      const h = src[pos.i++];

      if ((h & 0x80) === 0) {
        result.push(unZigZag32(h & 0x7f));
        continue;
      }

      const countField = (h >> 2) & 0x1f;
      const width = (h & 0x03) + 1;

      let count: number;
      if (countField <= 27) {
        count = countField + 1;
      } else {
        const lol = countField - 27;
        const extra = readLE(src, pos, lol);
        count = 29 + extra;
      }

      for (let j = 0; j < count; j++) {
        const raw = readLE(src, pos, width);
        result.push(unZigZag32(raw));
      }
    }

    return result;
  },
};
