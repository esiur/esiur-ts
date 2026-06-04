import { makeNumberCodec } from "./groupCodec.js";

/** Group-varint codec for `UInt16` arrays (port of `GroupUInt16Codec`). */
export const GroupUInt16Codec = makeNumberCodec({
  countBits: 6,
  maxWidth: 2,
  bits: 16,
  signed: false,
});
