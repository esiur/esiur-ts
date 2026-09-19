import { describe, it, expect } from "vitest";
import { PlainTdu } from "../../src/data/PlainTdu.js";
import { ParsedTdu } from "../../src/data/ParsedTdu.js";
import { TduClass } from "../../src/data/TduClass.js";
import {
  ParserLimitException,
  RemoteParserLimitException,
  DEFAULT_MAXIMUM_PAYLOAD_LENGTH,
} from "../../src/data/ParserGuard.js";
import { compose, parse, parseAsync } from "../../src/data/Codec.js";
import { typedList } from "../../src/data/descriptors.js";
import { t } from "../../src/data/descriptors.js";
import { Warehouse } from "../../src/resource/Warehouse.js";

/**
 * Mirror of esiur-dotnet `Tests/Unit/ParserSecurityTests.cs`
 * (`PacketParser_RejectsOversizedDeclarationBeforePayloadArrives`): a
 * Dynamic-class (RawData) TDU header declaring `length` via a `lengthBytes`-
 * byte big-endian prefix. `includePayload` controls whether the declared
 * payload bytes are actually appended, so an over-limit declaration can be
 * tested without allocating the declared amount.
 */
function buildDynamicTdu(length: number, lengthBytes: number, includePayload: boolean): Uint8Array {
  const header = 0x40 | (lengthBytes << 3); // TduClass.Dynamic, index 0
  const out = new Uint8Array(1 + lengthBytes + (includePayload ? length : 0));
  out[0] = header;
  for (let i = 0; i < lengthBytes; i++) out[1 + i] = (length >>> ((lengthBytes - 1 - i) * 8)) & 0xff;
  return out;
}

describe("TDU parser payload-length guard", () => {
  describe("PlainTdu.parse", () => {
    it("accepts a declared length within the limit", () => {
      const data = buildDynamicTdu(4, 1, true);
      const tdu = PlainTdu.parse(data, 0, data.length, 16);
      expect(tdu.tduClass).toBe(TduClass.Dynamic);
      expect(tdu.payloadLength).toBe(4);
      expect(tdu.totalLength).toBe(data.length);
    });

    it("throws on a declared length beyond the limit, before waiting for the payload", () => {
      // Declares 1000 bytes but supplies none of them. A plain completeness
      // check would report this as merely "incomplete"; the guard must
      // reject the declaration itself instead.
      const data = buildDynamicTdu(1000, 2, false);
      expect(() => PlainTdu.parse(data, 0, data.length, 16)).toThrow(ParserLimitException);
    });

    it("applies the default 8 MiB bound when no limit is supplied", () => {
      const oversized = buildDynamicTdu(DEFAULT_MAXIMUM_PAYLOAD_LENGTH + 1, 4, false);
      expect(() => PlainTdu.parse(oversized, 0, oversized.length)).toThrow(ParserLimitException);

      const withinDefault = buildDynamicTdu(4, 1, true);
      expect(() => PlainTdu.parse(withinDefault, 0, withinDefault.length)).not.toThrow();
    });

    it("treats a limit of 0 as unlimited", () => {
      const data = buildDynamicTdu(1000, 2, false);
      const tdu = PlainTdu.parse(data, 0, data.length, 0);
      expect(tdu.tduClass).toBe(TduClass.Invalid);
    });
  });

  describe("ParsedTdu.parseSync", () => {
    it("accepts a declared length within the limit", () => {
      const data = buildDynamicTdu(4, 1, true);
      const tdu = ParsedTdu.parseSync(data, 0, data.length, null, 16);
      expect(tdu.tduClass).toBe(TduClass.Dynamic);
      expect(tdu.payloadLength).toBe(4);
    });

    it("throws on a declared length beyond the limit, before waiting for the payload", () => {
      const data = buildDynamicTdu(1000, 2, false);
      expect(() => ParsedTdu.parseSync(data, 0, data.length, null, 16)).toThrow(ParserLimitException);
    });

    it("applies the default 8 MiB bound when no limit is supplied", () => {
      const oversized = buildDynamicTdu(DEFAULT_MAXIMUM_PAYLOAD_LENGTH + 1, 4, false);
      expect(() => ParsedTdu.parseSync(oversized, 0, oversized.length, null)).toThrow(ParserLimitException);
    });
  });

  describe("ParsedTdu.parseAsync", () => {
    it("accepts a declared length within the limit", async () => {
      const data = buildDynamicTdu(4, 1, true);
      const tdu = await ParsedTdu.parseAsync(data, 0, data.length, null, null, null, 16);
      expect(tdu.tduClass).toBe(TduClass.Dynamic);
      expect(tdu.payloadLength).toBe(4);
    });

    it("rejects a declared length beyond the limit, before waiting for the payload", async () => {
      const data = buildDynamicTdu(1000, 2, false);
      await expect(ParsedTdu.parseAsync(data, 0, data.length, null, null, null, 16)).rejects.toThrow(
        ParserLimitException,
      );
    });

    it("applies the default 8 MiB bound when no limit is supplied", async () => {
      const oversized = buildDynamicTdu(DEFAULT_MAXIMUM_PAYLOAD_LENGTH + 1, 4, false);
      await expect(ParsedTdu.parseAsync(oversized, 0, oversized.length, null, null, null)).rejects.toThrow(
        ParserLimitException,
      );
    });
  });
});

describe("decoded allocation and collection guards", () => {
  it("rejects values above the peer-advertised budgets before send", () => {
    const connection = {
      session: {
        remoteMaximumPacketSize: 64,
        remoteMaximumAllocationSize: 6,
        remoteMaximumCollectionItems: 2,
      },
    };

    expect(() => compose("four", null, connection)).toThrow(RemoteParserLimitException);
    expect(() => compose([1, 2, 3], null, connection)).toThrow(RemoteParserLimitException);

    connection.session.remoteMaximumAllocationSize = 0;
    connection.session.remoteMaximumCollectionItems = 0;
    connection.session.remoteMaximumPacketSize = 3;
    expect(() => compose(Uint8Array.of(1, 2, 3, 4), null, connection)).toThrow(
      RemoteParserLimitException,
    );
  });

  it("uses the Warehouse packet-size override", () => {
    const warehouse = new Warehouse();
    warehouse.configuration.parser.maximumPacketSize = 3;
    const data = buildDynamicTdu(4, 1, true);
    expect(() => ParsedTdu.parseSync(data, 0, data.length, warehouse)).toThrow(
      ParserLimitException,
    );
  });

  it("rejects string and raw-data allocations before copying", () => {
    const warehouse = new Warehouse();
    warehouse.configuration.parser.maximumAllocationSize = 3;
    expect(() => parse(compose("ab"), 0, warehouse)).toThrow(ParserLimitException);
    expect(() => parse(compose(Uint8Array.of(1, 2, 3, 4)), 0, warehouse)).toThrow(
      ParserLimitException,
    );
  });

  it("rejects compressed typed collections above the item limit", () => {
    const warehouse = new Warehouse();
    warehouse.configuration.parser.maximumCollectionItems = 2;
    const data = compose(typedList(t.i32, [1, 2, 3]));
    expect(() => parse(data, 0, warehouse)).toThrow(ParserLimitException);
  });

  it("applies the same collection limit in async decoding", async () => {
    const warehouse = new Warehouse();
    warehouse.configuration.parser.maximumCollectionItems = 2;
    const data = compose(typedList(t.i32, [1, 2, 3]));
    await expect(parseAsync(data, 0, warehouse, undefined, null)).rejects.toThrow(
      ParserLimitException,
    );
  });
});
