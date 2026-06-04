import { makeBigIntCodec } from "./groupCodec.js";

/** Group-varint codec for `UInt64` arrays (port of `GroupUInt64Codec`). */
export const GroupUInt64Codec = makeBigIntCodec({
  countBits: 4,
  maxWidth: 8,
  bits: 64,
  signed: false,
});
