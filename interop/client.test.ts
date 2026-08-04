import { describe, it, expect } from "vitest";
import { EpConnection } from "../src/protocol/EpConnection.js";
import { ResourceId } from "../src/data/ResourceId.js";
import { Resource } from "../src/resource/Resource.js";
import { Export, getTemplate } from "../src/resource/decorators.js";
import { t } from "../src/data/descriptors.js";

// Client-side stub matching the C# `Hello` resource (interop/Hello.cs):
// counts (int, prop 0), label (string, prop 1), SayHi(string) (func 0).
class HelloStub extends Resource {
  @Export(t.i32) accessor counts = 0;
  @Export(t.string) accessor label = "";
  @Export(t.string, [t.string]) sayHi(_msg: string): string {
    return "";
  }
}

/**
 * Cross-language test: the TypeScript client connects to the *real C# Esiur
 * server* (interop/Program.cs, EpServer on the caller-provided port with
 * AllowUnauthorizedAccess) and completes the anonymous IIP handshake.
 *
 * Run the C# server first:
 *   set ESIUR_INTEROP_PORT to an available port
 *   dotnet interop/bin/Release/net10.0/InteropServer.dll
 * then: npx vitest run interop/client.test.ts
 */
describe("cross-language: TS client ↔ C# Esiur server", () => {
  const port = Number(process.env.ESIUR_INTEROP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error("Set ESIUR_INTEROP_PORT to the interop server's port.");
  const endpoint = `ws://127.0.0.1:${port}`;

  it("completes the anonymous handshake over WebSocket", async () => {
    const client = await EpConnection.connect(endpoint);
    expect(client.isConnected).toBe(true);
    client.close();
  }, 15000);

  it("resolves a resource link to a resource id (request/reply both ways)", async () => {
    const client = await EpConnection.connect(endpoint);

    // TS composes the link string → C# parses it, queries the resource, and
    // replies with a resource reference → TS decodes it to a ResourceId.
    const rid = await client.getResourceIdByLink("sys/hello");
    expect(rid).toBeInstanceOf(ResourceId);
    expect((rid as ResourceId).id).toBeGreaterThan(0);

    // A missing path returns a management error (ResourceNotFound).
    await expect(
      client.getResourceIdByLink("sys/does-not-exist") as PromiseLike<unknown>,
    ).rejects.toBeTruthy();

    client.close();
  }, 15000);

  it("attaches a C# resource: reads properties, invokes a function, tracks changes", async () => {
    const client = await EpConnection.connect(endpoint);
    const rid = (await client.getResourceIdByLink("sys/hello")) as ResourceId;

    const res = (await client.attach(rid.id, getTemplate(HelloStub))) as Record<
      string,
      unknown
    > & { counts: number; label: string; sayHi: (m: string) => PromiseLike<string> };

    // Property values came from the C# server's attach reply.
    expect(res.label).toBe("Hello from C#");
    expect(res.counts).toBe(0);

    // Invoke the C# function; its return value comes back over the wire.
    expect(await res.sayHi("Ahmed")).toBe("Welcome, Ahmed");

    // The C# side incremented Counts and pushed a PropertyModified notification.
    expect(res.counts).toBe(1);

    client.close();
  }, 15000);
});
