import { describe, expect, it } from "vitest";
import { merge } from "../../src/data/DC.js";
import { ParserLimitException } from "../../src/data/ParserGuard.js";
import { Tru } from "../../src/data/Tru.js";
import { TruIdentifier } from "../../src/data/TruIdentifier.js";
import { Warehouse, WarehouseConfiguration } from "../../src/resource/index.js";

function nestedTypedLists(depth: number): Uint8Array {
  let value: Uint8Array = Uint8Array.of(TruIdentifier.Int32);
  for (let index = 1; index < depth; index++)
    value = merge(Uint8Array.of(TruIdentifier.TypedList), value);
  return value;
}

describe("TRU parser metadata depth", () => {
  it("accepts the configured maximum depth", () => {
    expect(Tru.parseSync(nestedTypedLists(64), 0).size).toBe(64);
  });

  it("rejects metadata deeper than the default budget in both parsers", async () => {
    const encoded = nestedTypedLists(65);
    expect(() => Tru.parseSync(encoded, 0)).toThrow(ParserLimitException);
    await expect(Tru.parseAsync(encoded, 0)).rejects.toThrow(ParserLimitException);
  });

  it("uses the owning Warehouse parser configuration", () => {
    const configuration = new WarehouseConfiguration();
    configuration.parser.maximumTypeMetadataDepth = 3;
    const warehouse = new Warehouse(configuration);

    expect(() => Tru.parseSync(nestedTypedLists(4), 0, warehouse)).toThrow(
      "TRU type metadata depth of 4 exceeds the configured limit of 3.",
    );
  });
});
