import { makeNumberCodec } from "./groupCodec.js";

/** Group-varint zig-zag codec for `Int32` arrays (port of `GroupInt32Codec`). */
export const GroupInt32Codec = makeNumberCodec({
  countBits: 5,
  maxWidth: 4,
  bits: 32,
  signed: true,
});
