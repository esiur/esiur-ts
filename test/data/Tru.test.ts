import { describe, it, expect } from "vitest";
import { TruTypeDef } from "../../src/data/Tru.js";
import { TruIdentifier } from "../../src/data/TruIdentifier.js";
import { TypeDefKind, type ITypeDef } from "../../src/data/types/ITypeDef.js";
import * as DC from "../../src/data/DC.js";

function fakeTypeDef(id: number): ITypeDef {
  return {
    id,
    kind: TypeDefKind.Record,
    name: `Type${id}`,
    properties: [],
    createInstance: () => ({}),
    setProperty: () => {},
  };
}

describe("TruTypeDef width selection", () => {
  it.each([
    [0, TruIdentifier.LocalType8, 1],
    [255, TruIdentifier.LocalType8, 1],
    [256, TruIdentifier.LocalType16, 2],
    [65535, TruIdentifier.LocalType16, 2],
    [65536, TruIdentifier.LocalType32, 4],
    [4294967295, TruIdentifier.LocalType32, 4],
    [4294967296, TruIdentifier.LocalType64, 8],
  ])(
    "picks the narrowest sufficient identifier for id=%i",
    (id, expectedIdentifier, expectedIdBytes) => {
      const tru = new TruTypeDef(false, fakeTypeDef(id));
      expect(tru.identifier).toBe(expectedIdentifier);

      const bytes = tru.compose();
      expect(bytes.length).toBe(1 + expectedIdBytes);
      expect(bytes[0]).toBe(expectedIdentifier);

      let roundTripped: number;
      switch (expectedIdBytes) {
        case 1:
          roundTripped = bytes[1];
          break;
        case 2:
          roundTripped = DC.getUint16(bytes, 1);
          break;
        case 4:
          roundTripped = DC.getUint32(bytes, 1);
          break;
        default:
          roundTripped = Number(DC.getUint64(bytes, 1));
          break;
      }
      expect(roundTripped).toBe(id);
    },
  );

  it("sets the nullable bit in the header byte", () => {
    const tru = new TruTypeDef(true, fakeTypeDef(42));
    const bytes = tru.compose();

    expect(bytes[0]).toBe(0x80 | TruIdentifier.LocalType8);
    expect(bytes[1]).toBe(42);
  });
});
