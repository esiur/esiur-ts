import { describe, it, expect } from "vitest";
import { compose, parse } from "../../src/data/Codec.js";
import * as DC from "../../src/data/DC.js";
import { t, typedList, typedMap, typedTuple } from "../../src/data/descriptors.js";
import { Tru, TruPrimitive, TruComposite } from "../../src/data/Tru.js";
import { TruIdentifier } from "../../src/data/TruIdentifier.js";

const hex = (b: Uint8Array) => DC.toHex(b);

describe("Tru compose/parse", () => {
  it("composes primitive and composite Trus", () => {
    expect(hex(t.i32.compose())).toBe("09"); // Int32
    expect(hex(t.string.compose())).toBe("12"); // String
    expect(hex(t.list(t.i32).compose())).toBe("4809"); // TypedList<Int32>
    expect(hex(t.map(t.string, t.f64).compose())).toBe("51120d"); // TypedMap<String,Float64>
    expect(hex(t.nullable(t.i32).compose())).toBe("89"); // nullable Int32 (0x80 | 0x09)
  });

  it("round-trips Trus through parse", () => {
    const cases: Tru[] = [t.i32, t.string, t.bool, t.list(t.i32), t.map(t.string, t.f64), t.tuple(t.i32, t.string, t.bool)];
    for (const tru of cases) {
      const bytes = tru.compose();
      const { value, size } = Tru.parseSync(bytes, 0);
      expect(size).toBe(bytes.length);
      expect(value.match(tru)).toBe(true);
    }
  });

  it("parses the Int32 sub-type of a TypedList metadata", () => {
    const { value } = Tru.parseSync(DC.fromHex("4809", null), 0);
    expect(value.identifier).toBe(TruIdentifier.TypedList);
    expect(value).toBeInstanceOf(TruComposite);
    const sub = (value as TruComposite).subTypes[0];
    expect(sub).toBeInstanceOf(TruPrimitive);
    expect(sub.identifier).toBe(TruIdentifier.Int32);
  });
});

describe("typed Int32 list (Gvwie)", () => {
  it("matches the golden typed-list vector", () => {
    expect(hex(compose(typedList(t.i32, [1, 2, 3])))).toBe("88054809020406");
  });

  it("round-trips typed Int32 arrays", () => {
    for (const arr of [[], [1, 2, 3], [-5, 0, 127, -128, 70000, -70000, 2147483647]]) {
      const decoded = parse(compose(typedList(t.i32, arr)));
      expect(decoded).toEqual(arr);
    }
  });

  it("round-trips a typed string list via the per-element path", () => {
    const decoded = parse(compose(typedList(t.string, ["a", "bb", "ccc"])));
    expect(decoded).toEqual(["a", "bb", "ccc"]);
  });

  it("round-trips typed numeric lists of every Gvwie width", () => {
    expect(parse(compose(typedList(t.i16, [1, -1, 32767, -32768])))).toEqual([
      1, -1, 32767, -32768,
    ]);
    expect(parse(compose(typedList(t.u16, [0, 255, 256, 65535])))).toEqual([0, 255, 256, 65535]);
    expect(parse(compose(typedList(t.u32, [0, 70000, 4294967295])))).toEqual([
      0, 70000, 4294967295,
    ]);
    expect(parse(compose(typedList(t.i64, [1n, -1n, 9_000_000_000_000n])))).toEqual([
      1n,
      -1n,
      9_000_000_000_000n,
    ]);
    expect(parse(compose(typedList(t.u64, [0n, 18_446_744_073_709_551_615n])))).toEqual([
      0n,
      18_446_744_073_709_551_615n,
    ]);
  });
});

describe("typed maps", () => {
  it("round-trips a string->i32 map", () => {
    const decoded = parse(
      compose(typedMap(t.string, t.i32, [["a", 1], ["b", 2], ["c", 3]])),
    ) as Map<string, number>;
    expect(decoded).toBeInstanceOf(Map);
    expect([...decoded.entries()]).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("round-trips an i32->i32 map (Gvwie keys and values)", () => {
    const src = new Map<number, number>([[1, 10], [2, 20], [70000, 80000]]);
    const decoded = parse(compose(typedMap(t.i32, t.i32, src))) as Map<number, number>;
    expect([...decoded.entries()]).toEqual([...src.entries()]);
  });
});

describe("typed tuples", () => {
  it("round-trips a (i32, string, bool) tuple", () => {
    const decoded = parse(compose(typedTuple([t.i32, t.string, t.bool], [1, "x", true])));
    expect(decoded).toEqual([1, "x", true]);
  });

  it("round-trips a tuple with a nested typed list (TypeOfTarget stripping)", () => {
    const decoded = parse(
      compose(typedTuple([t.i32, t.list(t.i32)], [5, typedList(t.i32, [1, 2, 3])])),
    );
    expect(decoded).toEqual([5, [1, 2, 3]]);
  });
});
