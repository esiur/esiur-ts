import { makeNumberCodec } from "./groupCodec.js";

/** Group-varint codec for `UInt32` arrays (port of `GroupUInt32Codec`). */
export const GroupUInt32Codec = makeNumberCodec({
  countBits: 5,
  maxWidth: 4,
  bits: 32,
  signed: false,
});
