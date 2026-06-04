import { describe, it, expect } from "vitest";
import { compose } from "../../src/data/Codec.js";
import * as DC from "../../src/data/DC.js";
import { u32, u64, char16 } from "../../src/data/widths.js";
import { Uuid } from "../../src/data/Uuid.js";
import { Decimal128 } from "../../src/data/Decimal128.js";

/**
 * Mirror of esiur-dotnet `Tests/Unit/WireFormatGoldenTests.cs`. Pins the exact
 * on-wire bytes of `compose` for a representative value of each primitive TDU
 * family. These vectors guarantee byte-compatibility with the C# v3 server.
 */
const hex = (value: unknown) => DC.toHex(compose(value));

describe("wire format golden vectors (vs esiur-dotnet)", () => {
  it.each<[string, unknown, string]>([
    // fixed, zero-payload tokens
    ["null", null, "00"],
    ["bool_false", false, "01"],
    ["bool_true", true, "02"],
    // signed integers, narrowed to the smallest width
    ["int_0", 0, "0900"],
    ["int_1", 1, "0901"],
    ["int_minus1", -1, "09ff"],
    ["int_127", 127, "097f"],
    ["int_128", 128, "118000"],
    ["int_200", 200, "11c800"],
    ["int_40000", 40000, "19409c0000"],
    ["int_70000", 70000, "1970110100"],
    ["long_5e9", 5000000000n, "2100f2052a01000000"],
    // unsigned integers (explicit width)
    ["uint_255", u32(255), "08ff"],
    ["uint_256", u32(256), "100001"],
    ["ulong_max", u64(0xffffffffffffffffn), "20ffffffffffffffff"],
    // floating point
    ["float_1p5", 1.5, "1a0000c03f"],
    ["double_0p1", 0.1, "229a9999999999b93f"],
    // char
    ["char_A", char16("A"), "124100"],
    // strings (length-prefixed UTF-8)
    ["string_Hi", "Hi", "49024869"],
    ["string_empty", "", "41"],
  ])("composes %s", (_name, value, expected) => {
    expect(hex(value)).toBe(expected);
  });

  it("composes high-precision decimal", () => {
    expect(hex(Decimal128.parse("1.2345678901234567890123456789"))).toBe(
      "2a00001c00321be4271581396eb1c9be46",
    );
  });

  it("composes DateTime", () => {
    expect(hex(new Date(Date.UTC(2026, 5, 2, 13, 45, 30)))).toBe(
      "230039f035adc0de08",
    );
  });

  it("composes Uuid", () => {
    const u = new Uuid(DC.fromHex("78563412ab90efcd1234567890abcdef", null));
    expect(hex(u)).toBe("2b78563412ab90efcd1234567890abcdef");
  });

  it.each([NaN, Infinity, -Infinity])(
    "encodes NaN/Infinity %s to a single token",
    (value) => {
      expect(hex(value)).toBe("04");
    },
  );
});
