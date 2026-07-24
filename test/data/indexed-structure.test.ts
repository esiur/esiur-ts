import { describe, it, expect } from "vitest";
import { compose, parse } from "../../src/data/Codec.js";
import { IndexedStructure } from "../../src/data/IndexedStructure.js";
import { Index } from "../../src/data/IndexAttribute.js";
import { toIndexedMap, fromIndexedMap } from "../../src/data/IndexedStructureCodec.js";
import { TduIdentifier } from "../../src/data/TduIdentifier.js";
import { TruPrimitive } from "../../src/data/Tru.js";
import { TruIdentifier } from "../../src/data/TruIdentifier.js";
import { TypeDefInfo } from "../../src/data/types/TypeDefInfo.js";
import { PropertyDefInfo } from "../../src/data/types/PropertyDefInfo.js";
import { FunctionDefInfo } from "../../src/data/types/FunctionDefInfo.js";
import { ArgumentDefInfo } from "../../src/data/types/ArgumentDefInfo.js";
import { TypeDefKind } from "../../src/data/types/ITypeDef.js";
import { MemberDefFlags } from "../../src/data/types/MemberDefFlags.js";
import { PropertyDefFlags } from "../../src/data/types/PropertyDefFlags.js";

class Sample extends IndexedStructure {
  @Index(0x00) name = "";
  @Index(0x05) count: number | undefined;
}

class SampleChild extends Sample {
  @Index(0x03) extra = "";
}

describe("IndexedStructure / @Index", () => {
  it("round-trips a flat structure through toIndexedMap/fromIndexedMap", () => {
    const s = new Sample();
    s.name = "hello";
    s.count = 7;
    const map = toIndexedMap(s);
    // TypedMap stores entries as [key, value] pairs, sorted by index.
    expect(map.entries).toEqual([
      [0x00, "hello"],
      [0x05, 7],
    ]);

    const restored = fromIndexedMap(Sample, new Map(map.entries));
    expect(restored.name).toBe("hello");
    expect(restored.count).toBe(7);
  });

  it("omits null/undefined members (sparse)", () => {
    const s = new Sample();
    s.name = "only-name";
    const map = toIndexedMap(s);
    expect(map.entries).toEqual([[0x00, "only-name"]]);
  });

  it("is version tolerant: unknown indices on decode are ignored", () => {
    const decoded = fromIndexedMap(
      Sample,
      new Map<number, unknown>([
        [0x00, "x"],
        [0x99, "unknown-future-field"],
      ]),
    );
    expect(decoded.name).toBe("x");
  });

  it("subclass fields don't corrupt the base class's own index registry", () => {
    // Regression test: an earlier bug had `@Index` mutate the *inherited*
    // metadata array via prototype lookup, so decorating one subclass leaked
    // its indices into the base class (and any sibling subclass).
    const base = new Sample();
    base.name = "base";
    base.count = 1;
    const baseMap = toIndexedMap(base);
    expect(baseMap.entries).toEqual([
      [0x00, "base"],
      [0x05, 1],
    ]);

    const child = new SampleChild();
    child.name = "child";
    child.count = 2;
    child.extra = "extra";
    const childMap = toIndexedMap(child);
    expect(childMap.entries).toEqual([
      [0x00, "child"],
      [0x03, "extra"],
      [0x05, 2],
    ]);
  });

  it("rejects a duplicate index within the same type", () => {
    expect(() => {
      class Bad extends IndexedStructure {
        @Index(0x01) a = 0;
        @Index(0x01) b = 0;
      }
      return Bad;
    }).toThrow(/already used/);
  });
});

describe("TduIdentifier.TypeDef (0x81) / TRU (0x82) wire framing", () => {
  it("composes a bare Tru value with the dedicated 0x82 identifier and no metadata", () => {
    const value = new TruPrimitive(TruIdentifier.String);
    const bytes = compose(value);
    expect(bytes[0] & 0xc7).toBe(TduIdentifier.TRU);

    const decoded = parse(bytes);
    expect(decoded).toBeInstanceOf(TruPrimitive);
    expect((decoded as TruPrimitive).identifier).toBe(TruIdentifier.String);
  });

  it("composes an IndexedStructure as a plain Typed (0x80) TypedMap<u8,dynamic>", () => {
    const s = new Sample();
    s.name = "n";
    s.count = 3;
    const bytes = compose(s);
    expect(bytes[0] & 0xc7).toBe(TduIdentifier.Typed);

    const decoded = parse(bytes);
    expect(decoded).toBeInstanceOf(Map);
    expect((decoded as Map<unknown, unknown>).get(0)).toBe("n");
    expect((decoded as Map<unknown, unknown>).get(5)).toBe(3);
  });

  it("composes and decodes a TypeDefInfo through the dedicated 0x81 slot", () => {
    const info = new TypeDefInfo();
    info.version = 1;
    info.id = 42;
    info.name = "MyResource";
    info.kind = TypeDefKind.Resource;

    const prop = new PropertyDefInfo();
    prop.index = 0;
    prop.name = "value";
    prop.flags = PropertyDefFlags.ReadOnly;
    prop.valueType = new TruPrimitive(TruIdentifier.Int32);
    info.properties = [prop];

    const fn = new FunctionDefInfo();
    fn.index = 0;
    fn.name = "doThing";
    fn.flags = MemberDefFlags.Inherited;
    fn.returnType = new TruPrimitive(TruIdentifier.Void);
    const arg = new ArgumentDefInfo();
    arg.index = 0;
    arg.name = "x";
    arg.valueType = new TruPrimitive(TruIdentifier.String);
    fn.arguments = [arg];
    info.functions = [fn];

    const bytes = compose(info);
    // Only the *outer* TypeDefInfo uses the dedicated TypeDef (0x81) slot;
    // nested PropertyDefInfo/FunctionDefInfo/ArgumentDefInfo compose through
    // the plain Typed (0x80) path, verified above.
    expect(bytes[0] & 0xc7).toBe(TduIdentifier.TypeDef);

    const decoded = parse(bytes);
    expect(decoded).toBeInstanceOf(TypeDefInfo);
    const d = decoded as TypeDefInfo;
    expect(d.id).toBe(42);
    expect(d.name).toBe("MyResource");
    expect(d.kind).toBe(TypeDefKind.Resource);

    expect(d.properties).toHaveLength(1);
    expect(d.properties![0]).toBeInstanceOf(PropertyDefInfo);
    expect(d.properties![0].name).toBe("value");
    expect(d.properties![0].flags).toBe(PropertyDefFlags.ReadOnly);
    expect(d.properties![0].valueType).toBeInstanceOf(TruPrimitive);
    expect((d.properties![0].valueType as TruPrimitive).identifier).toBe(TruIdentifier.Int32);

    expect(d.functions).toHaveLength(1);
    expect(d.functions![0]).toBeInstanceOf(FunctionDefInfo);
    expect(d.functions![0].arguments).toHaveLength(1);
    expect(d.functions![0].arguments![0]).toBeInstanceOf(ArgumentDefInfo);
    expect(d.functions![0].arguments![0].name).toBe("x");
  });
});
