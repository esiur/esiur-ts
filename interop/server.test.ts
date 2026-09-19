import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { EpServer } from "../src/protocol/EpServer.js";
import { Resource } from "../src/resource/Resource.js";
import { Warehouse } from "../src/resource/Warehouse.js";
import { MemoryStore } from "../src/stores/MemoryStore.js";
import { Export, event, type EventSource } from "../src/resource/decorators.js";
import { t } from "../src/data/descriptors.js";
import { OrderingControl } from "../src/data/OrderingControl.js";
import { OperationEffects } from "../src/data/types/OperationEffects.js";
import { StreamMode } from "../src/data/types/StreamMode.js";

class MetadataResource extends Resource {
  @Export(t.i32) accessor value = 7;
  @Export(t.string, [t.string], { streamMode: StreamMode.None })
  echo(message: string): string { return message; }
  @Export(t.string) changed: EventSource<string> = event<string>();
}

const execFileAsync = promisify(execFile);

describe("cross-language: C# Esiur client ↔ TS server", () => {
  it("queries and auto-attaches a TypeScript child resource", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore());
    await warehouse.put("sys/parent", new Resource());
    await warehouse.put("sys/parent/kid", new Resource());
    const metadataType = warehouse.getTypeDef(MetadataResource);
    Object.assign(metadataType, {
      version: 6,
      namespace: "Interop.TypeScript",
      usage: "Validate TypeScript hosted metadata",
      description: "TS TypeDef fixture",
      example: "sys/metadata",
      category: "Conformance",
      since: "3.1",
    });
    Object.assign(metadataType.properties[0], {
      readOnly: true,
      historical: true,
      deprecated: true,
      deprecationMessage: "Use currentValue",
      description: "Current test value",
      usage: "Read this value",
      examples: [7],
      tags: ["interop", "property"],
      unit: "items",
      minimum: 0,
      maximum: 10,
      allowedValues: [7, 8],
      pattern: "^[0-9]+$",
      format: "N0",
      warnings: ["Fixture only"],
      relatedMembers: [0],
      orderingControl: OrderingControl.LatestOnly,
      historyControl: 3,
      defaultValue: 7,
    });
    Object.assign(metadataType.functions[0], {
      readOnly: true,
      idempotent: true,
      cancellable: true,
      deprecated: true,
      deprecationMessage: "Use echoV2",
      description: "Echo a message",
      preconditions: ["connected"],
      postconditions: ["message returned"],
      effects: OperationEffects.External,
    });
    Object.assign(metadataType.functions[0].args[0], {
      optional: true,
      variadic: true,
      defaultValue: "hello",
    });
    Object.assign(metadataType.events[0], {
      historical: true,
      subscribable: false,
      deprecated: true,
      description: "Value changed",
      argumentName: "message",
      orderingControl: OrderingControl.Relaxed,
      historyControl: 4,
    });
    await warehouse.put("sys/metadata", new MetadataResource());
    await warehouse.open();
    const server = await EpServer.listen({ port: 0, warehouse });

    try {
      const assembly = fileURLToPath(
        new URL("./bin/Release/net10.0/InteropServer.dll", import.meta.url),
      );
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync("dotnet", [assembly], {
          env: {
            ...process.env,
            ESIUR_INTEROP_CLIENT_ENDPOINT: `ws://127.0.0.1:${server.port}`,
          },
          timeout: 15_000,
        }));
      } catch (error) {
        const details = error as Error & { stdout?: string; stderr?: string };
        throw new Error(
          `${details.message}\nstdout:\n${details.stdout ?? ""}\nstderr:\n${details.stderr ?? ""}`,
        );
      }
      expect(stdout).toContain("ESIUR-DOTNET-CLIENT-OK sys/parent/kid");
      expect(stdout).toContain("ESIUR-DOTNET-TYPEDEF-OK Interop.TypeScript.MetadataResource");
    } finally {
      await server.close();
      await warehouse.close();
    }
  }, 20_000);
});
