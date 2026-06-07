import { describe, it, expect } from "vitest";
import * as DC from "../../src/data/DC.js";
import { Uuid } from "../../src/data/Uuid.js";
import { Decimal128 } from "../../src/data/Decimal128.js";
import { Int128 } from "../../src/data/Int128.js";
import { UInt128 } from "../../src/data/UInt128.js";

const hex = (b: Uint8Array) => DC.toHex(b);

describe("DC primitive encoding (little-endian wire)", () => {
  it("encodes 16/32/64-bit integers", () => {
    expect(hex(DC.int16ToBytes(128))).toBe("8000");
    expect(hex(DC.int32ToBytes(70000))).toBe("70110100");
    expect(hex(DC.uint32ToBytes(256))).toBe("00010000");
    expect(hex(DC.uint64ToBytes(0xffffffffffffffffn))).toBe("ffffffffffffffff");
    expect(hex(DC.int64ToBytes(5000000000n))).toBe("00f2052a01000000");
  });

  it("encodes floats matching the golden vectors", () => {
    expect(hex(DC.float32ToBytes(1.5))).toBe("0000c03f");
    expect(hex(DC.float64ToBytes(0.1))).toBe("9a9999999999b93f");
  });

  it("round-trips through readers", () => {
    expect(DC.getInt32(DC.int32ToBytes(-12345), 0)).toBe(-12345);
    expect(DC.getUint64(DC.uint64ToBytes(123456789012345n), 0)).toBe(123456789012345n);
    expect(DC.getFloat64(DC.float64ToBytes(3.14159), 0)).toBeCloseTo(3.14159, 10);
  });

  it("hex helpers round-trip", () => {
    expect(hex(DC.fromHex("de ad be ef"))).toBe("deadbeef");
    expect(hex(DC.fromHex("deadbeef", null))).toBe("deadbeef");
  });
});

describe("DateTime <-> .NET ticks", () => {
  it("matches the golden DateTime vector", () => {
    const d = new Date(Date.UTC(2026, 5, 2, 13, 45, 30)); // 2026-06-02 13:45:30 UTC
    expect(hex(DC.dateTimeToBytes(d))).toBe("0039f035adc0de08");
  });

  it("round-trips a date", () => {
    const d = new Date(Date.UTC(1999, 11, 31, 23, 59, 59));
    expect(DC.ticksToDate(DC.dateToTicks(d)).getTime()).toBe(d.getTime());
  });
});

describe("Uuid", () => {
  it("stores raw bytes and formats canonically", () => {
    const u = new Uuid(DC.fromHex("78563412ab90efcd1234567890abcdef", null));
    expect(hex(u.data)).toBe("78563412ab90efcd1234567890abcdef");
    expect(u.toString()).toBe("78563412-ab90-efcd-1234-567890abcdef");
  });
});

describe("Decimal128 (.NET layout)", () => {
  it("matches the golden decimal vector", () => {
    const d = Decimal128.parse("1.2345678901234567890123456789");
    expect(hex(d.toBytes())).toBe("00001c00321be4271581396eb1c9be46");
  });

  it("round-trips parse -> bytes -> parse and toString", () => {
    const d = Decimal128.parse("-12.3450");
    const back = Decimal128.fromBytes(d.toBytes());
    expect(back.toString()).toBe("-12.3450");
    expect(back.negative).toBe(true);
    expect(back.scale).toBe(4);
  });
});

describe("Int128 / UInt128", () => {
  it("splits into msb/lsb", () => {
    const u = new UInt128(0x1122334455667788n, 0x99aabbccddeeff00n);
    expect(u.lsb).toBe(0x1122334455667788n);
    expect(u.msb).toBe(0x99aabbccddeeff00n);
    expect(u.value).toBe((0x99aabbccddeeff00n << 64n) | 0x1122334455667788n);
  });

  it("interprets the high sign bit for Int128", () => {
    const negOne = new Int128(0xffffffffffffffffn, 0xffffffffffffffffn);
    expect(negOne.value).toBe(-1n);
  });
});
