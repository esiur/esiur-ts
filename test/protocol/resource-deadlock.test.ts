import { describe, expect, it } from "vitest";
import { AsyncException } from "../../src/core/AsyncException.js";
import { AsyncReply } from "../../src/core/AsyncReply.js";
import { compose } from "../../src/data/Codec.js";
import { merge } from "../../src/data/DC.js";
import { TduIdentifier } from "../../src/data/TduIdentifier.js";
import { EpPacketRequest } from "../../src/net/packets/EpPacketRequest.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { PropertyTemplate, TypeDef } from "../../src/resource/template.js";

const referenceType = new TypeDef("ReferenceNode", [
  new PropertyTemplate("peer", 0, undefined, true),
]);

describe("EpConnection cyclic resource attachment", () => {
  it("completes independent A → B and B → A attaches without exposing duplicate requests", async () => {
    const connection = new EpConnection();
    const pending = new Map<number, AsyncReply>();
    const requestCounts = new Map<number, number>();

    connection.sendRequest = ((action: EpPacketRequest, ...args: unknown[]) => {
      expect(action).toBe(EpPacketRequest.AttachResource);
      const id = Number(args[0]);
      requestCounts.set(id, (requestCounts.get(id) ?? 0) + 1);
      const reply = new AsyncReply();
      pending.set(id, reply);
      return reply;
    }) as EpConnection["sendRequest"];

    const aReply = connection.attach(1, referenceType);
    const bReply = connection.attach(2, referenceType);

    pending.get(1)!.trigger(attachReply(1, resourceProperty(2)));
    await microtasks();
    pending.get(2)!.trigger(attachReply(2, resourceProperty(1)));

    const [a, b] = await withTimeout(
      Promise.all([Promise.resolve(aReply), Promise.resolve(bReply)]),
    );

    expect(requestCounts).toEqual(new Map([[1, 1], [2, 1]]));
    expect(a.peer.instanceId).toBe(2);
    expect(b.peer.instanceId).toBe(1);
    expect(a.peer.peer.instanceId).toBe(1);
    expect(b.peer.peer.instanceId).toBe(2);
  });

  it("coalesces independent callers while an attachment is in flight", async () => {
    const connection = new EpConnection();
    const transportReply = new AsyncReply();
    let requests = 0;

    connection.sendRequest = ((action: EpPacketRequest) => {
      expect(action).toBe(EpPacketRequest.AttachResource);
      requests++;
      return transportReply;
    }) as EpConnection["sendRequest"];

    const first = connection.attach(7, new TypeDef("Empty", []));
    const second = connection.attach(7, new TypeDef("Empty", []));
    expect(requests).toBe(1);

    transportReply.trigger(attachReply(7, new Uint8Array(0)));
    const [a, b] = await Promise.all([Promise.resolve(first), Promise.resolve(second)]);
    expect(a).toBe(b);
  });

  it("cleans failed attachment state so a later attempt can retry", async () => {
    const connection = new EpConnection();
    const attempts: AsyncReply[] = [];

    connection.sendRequest = (() => {
      const reply = new AsyncReply();
      attempts.push(reply);
      return reply;
    }) as EpConnection["sendRequest"];

    const first = connection.attach(9, new TypeDef("Empty", []));
    attempts[0].triggerError(new AsyncException(0, 1, "failed"));
    await expect(Promise.resolve(first)).rejects.toThrow("failed");

    const second = connection.attach(9, new TypeDef("Empty", []));
    expect(attempts).toHaveLength(2);
    attempts[1].trigger(attachReply(9, new Uint8Array(0)));
    await expect(Promise.resolve(second)).resolves.toMatchObject({ instanceId: 9 });
  });
});

function resourceProperty(peerId: number): Uint8Array {
  return merge(
    compose(1),
    compose(new Date(0)),
    Uint8Array.of(TduIdentifier.RemoteResource8, peerId),
  );
}

function attachReply(instanceId: number, raw: Uint8Array): unknown[] {
  return [1n, new Uint8Array(16), 1n, `resource/${instanceId}`, 0, raw];
}

async function microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for resource graph.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
