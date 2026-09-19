import { describe, expect, it } from "vitest";
import { compose, parseAsync } from "../../src/data/Codec.js";
import { TypeDefInfo } from "../../src/data/types/TypeDefInfo.js";
import { TypeDefKind } from "../../src/data/types/ITypeDef.js";
import { RemoteTypeDef } from "../../src/protocol/RemoteTypeDef.js";

describe("RemoteTypeDef indexed metadata", () => {
  it("preserves and qualifies all top-level TypeDefInfo metadata", async () => {
    const info = new TypeDefInfo();
    info.id = 17n;
    info.kind = TypeDefKind.Resource;
    info.name = "Pump";
    info.namespace = "Building.Automation";
    info.version = 3;
    info.usage = "Controls a circulation pump.";
    info.description = "Pump controller";
    info.example = new Map<string, unknown>([["enabled", true]]);
    info.category = "HVAC";
    info.since = "3.1";
    info.annotations = new Map([["owner", "operations"]]);

    const payload = compose(info);
    const decoded = await RemoteTypeDef.parseAsync(payload, null);

    expect(decoded.name).toBe("Building.Automation.Pump");
    expect(decoded.namespace).toBe("Building.Automation");
    expect(decoded.usage).toBe(info.usage);
    expect(decoded.description).toBe(info.description);
    expect(decoded.example).toEqual(info.example);
    expect(decoded.category).toBe(info.category);
    expect(decoded.since).toBe(info.since);
    expect(decoded.annotations).toEqual(info.annotations);
    expect(decoded.toJSON()).toMatchObject({
      namespace: "Building.Automation",
      usage: info.usage,
      description: info.description,
      category: info.category,
      since: info.since,
    });

    const parsed = await parseAsync(payload, 0, null, undefined, null);
    expect(parsed.length).toBe(payload.length);
  });

  it("does not duplicate an already-qualified TypeDefInfo name", async () => {
    const info = new TypeDefInfo();
    info.id = 18n;
    info.name = "Building.Automation.Pump";
    info.namespace = "Building.Automation";

    const decoded = await RemoteTypeDef.parseAsync(compose(info), null);
    expect(decoded.name).toBe("Building.Automation.Pump");
  });

  it("preserves UInt64 TypeDef ids beyond JavaScript's safe integer range", async () => {
    const info = new TypeDefInfo();
    info.id = 9_007_199_254_740_993n;
    info.name = "LargeIdentifier";

    const decoded = await RemoteTypeDef.parseAsync(compose(info), null);

    expect(decoded.id).toBe(info.id);
    expect(decoded.toJSON().id).toBe("9007199254740993");
  });
});
