import { makeNumberCodec } from "./groupCodec.js";

/** Group-varint zig-zag codec for `Int16` arrays (port of `GroupInt16Codec`). */
export const GroupInt16Codec = makeNumberCodec({
  countBits: 6,
  maxWidth: 2,
  bits: 16,
  signed: true,
});
