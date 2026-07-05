import { describe, expect, it } from "vitest";
import { AsyncReply } from "../../src/core/AsyncReply.js";
import { TypeDefKind } from "../../src/data/types/ITypeDef.js";
import { int32ToBytes, merge, uint16ToBytes, uint64ToBytes } from "../../src/data/DC.js";
import { TruTypeDef } from "../../src/data/Tru.js";
import { EpPacketRequest } from "../../src/net/packets/EpPacketRequest.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";

describe("EpConnection.fetchTypeDef", () => {
  it("breaks cyclic remote TypeDef dependencies with in-progress placeholders", async () => {
    const payloads = new Map<number, Uint8Array>([
      [1, typeDefPayload(1, "A", "b", 2)],
      [2, typeDefPayload(2, "B", "a", 1)],
    ]);
    const requested: number[] = [];
    const connection = new EpConnection();

    connection.sendRequest = ((action: EpPacketRequest, ...args: unknown[]) => {
      expect(action).toBe(EpPacketRequest.TypeDefById);
      const id = Number(args[0]);
      requested.push(id);
      const payload = payloads.get(id);
      if (!payload) throw new Error(`Unexpected TypeDef request ${id}.`);
      return AsyncReply.fromResult(payload);
    }) as EpConnection["sendRequest"];

    const a = await connection.fetchTypeDef(1);
    const bRef = a.properties[0].valueType;

    expect(requested).toEqual([1, 2]);
    expect(bRef).toBeInstanceOf(TruTypeDef);

    const b = (bRef as TruTypeDef).typeDef;
    const aRef = b.properties[0].valueType;

    expect(b.id).toBe(2);
    expect(aRef).toBeInstanceOf(TruTypeDef);
    expect((aRef as TruTypeDef).typeDef).toBe(a);

    await expect(connection.fetchTypeDef(2) as PromiseLike<unknown>).resolves.toBe(b);
    expect(requested).toEqual([1, 2]);
  });
});

function typeDefPayload(
  id: number,
  name: string,
  propertyName: string,
  remoteTypeId: number,
): Uint8Array {
  return merge(
    Uint8Array.of(TypeDefKind.Record),
    uint64ToBytes(BigInt(id)),
    nameBytes(name),
    int32ToBytes(0),
    uint16ToBytes(1),
    propertyDef(propertyName, remoteTypeId),
  );
}

function propertyDef(name: string, remoteTypeId: number): Uint8Array {
  return merge(
    Uint8Array.of(0x20),
    nameBytes(name),
    Uint8Array.of(0x41, remoteTypeId),
  );
}

function nameBytes(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return merge(Uint8Array.of(bytes.length), bytes);
}
