import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RemoteTypeDef, type RemoteTypeDefSnapshot } from "../../src/protocol/RemoteTypeDef.js";

interface TypeDefFixture {
  fixtureVersion: number;
  protocolVersion: string;
  producer: string;
  encoding: string;
  payloadBase64: string;
  expected: RemoteTypeDefSnapshot;
}

function readFixture(name: string): TypeDefFixture {
  const location = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(location, "utf8")) as TypeDefFixture;
}

describe("TypeDef cross-runtime conformance fixtures", () => {
  it("decodes the canonical flat indexed TypeDefInfo fixture", async () => {
    const fixture = readFixture("typedef-info-v3-flat.json");
    const payload = Uint8Array.from(Buffer.from(fixture.payloadBase64, "base64"));
    const decoded = await RemoteTypeDef.parseAsync(payload, null);

    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.protocolVersion).toBe("3.1");
    expect(decoded.toJSON()).toEqual(fixture.expected);
  });
});
