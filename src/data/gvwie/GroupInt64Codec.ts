import { makeBigIntCodec } from "./groupCodec.js";

/** Group-varint zig-zag codec for `Int64` arrays (port of `GroupInt64Codec`). */
export const GroupInt64Codec = makeBigIntCodec({
  countBits: 4,
  maxWidth: 8,
  bits: 64,
  signed: true,
});
