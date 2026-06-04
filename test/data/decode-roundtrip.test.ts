import { describe, it, expect } from "vitest";
import { compose, parse } from "../../src/data/Codec.js";
import * as DC from "../../src/data/DC.js";
import { Decimal128 } from "../../src/data/Decimal128.js";
import { Uuid } from "../../src/data/Uuid.js";
import { NotModified } from "../../src/data/NotModified.js";
import { GroupInt32Codec } from "../../src/data/gvwie/GroupInt32Codec.js";

const dec = (hex: string) => parse(DC.fromHex(hex, null));
const hex = (b: Uint8Array) => DC.toHex(b);

describe("decode golden vectors -> JS values", () => {
  it("decodes fixed tokens and integers", () => {
    expect(dec("00")).toBe(null);
    expect(dec("01")).toBe(false);
    expect(dec("02")).toBe(true);
    expect(dec("0900")).toBe(0);
    expect(dec("0901")).toBe(1);
    expect(dec("09ff")).toBe(-1);
    expect(dec("097f")).toBe(127);
    expect(dec("118000")).toBe(128);
    expect(dec("11c800")).toBe(200);
    expect(dec("19409c0000")).toBe(40000);
    expect(dec("1970110100")).toBe(70000);
    expect(dec("08ff")).toBe(255);
    expect(dec("100001")).toBe(256);
  });

  it("decodes 64-bit integers as bigint", () => {
    expect(dec("2100f2052a01000000")).toBe(5000000000n);
    expect(dec("20ffffffffffffffff")).toBe(0xffffffffffffffffn);
  });

  it("decodes floats, char, strings and the infinity token", () => {
    expect(dec("1a0000c03f")).toBe(1.5);
    expect(dec("229a9999999999b93f")).toBe(0.1);
    expect(dec("124100")).toBe(65); // char 'A' code unit
    expect(dec("49024869")).toBe("Hi");
    expect(dec("41")).toBe("");
    expect(dec("04")).toBe(Number.POSITIVE_INFINITY);
    expect(dec("03")).toBe(NotModified.Default);
  });

  it("decodes decimal, datetime and uuid", () => {
    expect((dec("2a00001c00321be4271581396eb1c9be46") as Decimal128).toString()).toBe(
      "1.2345678901234567890123456789",
    );
    expect((dec("230039f035adc0de08") as Date).getTime()).toBe(
      Date.UTC(2026, 5, 2, 13, 45, 30),
    );
    expect((dec("2b78563412ab90efcd1234567890abcdef") as Uuid).toString()).toBe(
      "78563412-ab90-efcd-1234-567890abcdef",
    );
  });

  it("decodes a dynamic list", () => {
    expect(dec("4a06090109020903")).toEqual([1, 2, 3]);
  });
});

describe("compose -> parse round-trips", () => {
  const rt = (v: unknown) => parse(compose(v));

  it("round-trips primitives", () => {
    for (const v of [null, true, false, 0, 1, -1, 127, 128, 200, 40000, 70000, "Hi", ""])
      expect(rt(v)).toEqual(v);
  });

  it("round-trips floats and large bigints", () => {
    expect(rt(0.1)).toBe(0.1);
    expect(rt(1.5)).toBe(1.5);
    expect(rt(5000000000n)).toBe(5000000000n);
  });

  it("round-trips Date / Uuid / Decimal128", () => {
    const d = new Date(Date.UTC(2001, 0, 2, 3, 4, 5));
    expect((rt(d) as Date).getTime()).toBe(d.getTime());

    const u = Uuid.parse("12345678-90ab-cdef-1234-567890abcdef");
    expect((rt(u) as Uuid).equals(u)).toBe(true);

    const dec128 = Decimal128.parse("-12.3450");
    expect((rt(dec128) as Decimal128).equals(dec128)).toBe(true);
  });

  it("round-trips a dynamic array", () => {
    expect(rt([1, 2, 3, -5, 1000])).toEqual([1, 2, 3, -5, 1000]);
    expect(hex(compose([1, 2, 3]))).toBe("4a06090109020903");
  });
});

describe("Gvwie GroupInt32Codec", () => {
  it("matches the golden payload for {1,2,3}", () => {
    expect(hex(GroupInt32Codec.encode([1, 2, 3]))).toBe("020406");
  });

  it("round-trips arrays spanning literal, grouped and extended runs", () => {
    const cases: number[][] = [
      [],
      [0],
      [1, 2, 3],
      [-1, -2, -3],
      [127, -128, 0, 2147483647, -2147483648],
      [300, 301, 70000, -70000, 16_000_000, -16_000_000],
      Array.from({ length: 100 }, (_, i) => (i % 2 ? -1 : 1) * (i * 9973)),
    ];
    for (const c of cases) expect(GroupInt32Codec.decode(GroupInt32Codec.encode(c))).toEqual(c);
  });
});
