import { describe, it, expect } from "vitest";
import { compose, parse } from "../../src/data/Codec.js";
import * as DC from "../../src/data/DC.js";
import { t, typedList } from "../../src/data/descriptors.js";
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
});
