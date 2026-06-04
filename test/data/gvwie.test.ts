import { describe, it, expect } from "vitest";
import {
  GroupInt16Codec,
  GroupInt32Codec,
  GroupInt64Codec,
  GroupUInt16Codec,
  GroupUInt32Codec,
  GroupUInt64Codec,
} from "../../src/data/gvwie/index.js";
import * as DC from "../../src/data/DC.js";

describe("Gvwie group codecs (all widths)", () => {
  it("Int32 still matches the golden payload after refactor", () => {
    expect(DC.toHex(GroupInt32Codec.encode([1, 2, 3]))).toBe("020406");
  });

  it("round-trips Int16 across literal/grouped/extended runs", () => {
    const cases: number[][] = [
      [],
      [0, 1, -1, 64, -64],
      [127, -128, 200, -200, 32767, -32768],
      Array.from({ length: 200 }, (_, i) => ((i % 2 ? -1 : 1) * (i * 211)) << 0).map((v) =>
        Math.max(-32768, Math.min(32767, v)),
      ),
    ];
    for (const c of cases) expect(GroupInt16Codec.decode(GroupInt16Codec.encode(c))).toEqual(c);
  });

  it("round-trips UInt16 / UInt32", () => {
    const u16 = [0, 1, 127, 128, 255, 256, 65535];
    expect(GroupUInt16Codec.decode(GroupUInt16Codec.encode(u16))).toEqual(u16);

    const u32 = [0, 127, 128, 70000, 16_777_215, 16_777_216, 4_294_967_295];
    expect(GroupUInt32Codec.decode(GroupUInt32Codec.encode(u32))).toEqual(u32);
  });

  it("round-trips Int64 / UInt64 (bigint)", () => {
    const i64 = [0n, 1n, -1n, 127n, -128n, 9_223_372_036_854_775_807n, -9_223_372_036_854_775_808n];
    expect(GroupInt64Codec.decode(GroupInt64Codec.encode(i64))).toEqual(i64);

    const u64 = [0n, 127n, 128n, 5_000_000_000n, 18_446_744_073_709_551_615n];
    expect(GroupUInt64Codec.decode(GroupUInt64Codec.encode(u64))).toEqual(u64);
  });

  it("handles extended-length groups (> short count) for every width", () => {
    const big16 = Array.from({ length: 500 }, () => 1000); // width 2, count > 60
    expect(GroupInt16Codec.decode(GroupInt16Codec.encode(big16))).toEqual(big16);

    const big64 = Array.from({ length: 60 }, (_, i) => BigInt(i) * 1_000_000_000n + 1n);
    expect(GroupInt64Codec.decode(GroupInt64Codec.encode(big64))).toEqual(big64);
  });
});
