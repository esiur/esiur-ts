# Esiur for TypeScript

TypeScript implementation of Esiur v3, a distributed resource framework for
real-time properties, asynchronous function invocation, and events over the
Esiur EP protocol. Wire-compatible with [esiur-dotnet](https://github.com/esiur/esiur-dotnet).

This package targets browser and Node.js clients, and includes Node.js server
support (hosting your own resources) through the optional `ws` package.

## Install

```bash
npm install esiur
```

For Node.js 18-20 clients or Node.js servers, install the optional WebSocket
peer dependency as well:

```bash
npm install esiur ws
```

Node.js 21+ and browsers can use the native `WebSocket` implementation for
clients. `EpServer` is Node-only and always uses `ws`.

## Connect to a remote resource

```ts
import { Warehouse } from "esiur";

const resource = await Warehouse.default.get("ep://127.0.0.1:10901/sys/counter");

console.log(resource.count);
resource.on("changed", () => console.log("updated:", resource.count));
await resource.increment();
```

`Warehouse.get` accepts local paths and EP URLs. `ep://` is transported as
`ws://`; `eps://` is transported as `wss://`. A bare EP URL (no path) returns
just the connection:

```ts
const connection = await Warehouse.default.get("ep://127.0.0.1:10901");
```

A path can be resolved without knowing the remote type ahead of time — the
server answers a `TypeDef` query on demand and the client builds a dynamic
proxy (`EpResource`) from it. If you have a decorated resource class or
`TypeDef` for the remote type, passing it skips that round trip and gives you
a typed reference instead:

```ts
const resource = await Warehouse.default.get(
  "ep://127.0.0.1:10901/sys/counter",
  Counter,
);
```

## Host resources

Define a resource by extending `Resource` and exporting properties, events,
and functions; put it in a `Warehouse` backed by a store; serve the warehouse
with `EpServer`:

```ts
import { Resource, Export, Warehouse, MemoryStore, EpServer, t } from "esiur";

class Greeter extends Resource {
  @Export(t.i32) accessor visits = 0;

  @Export(t.string, [t.string])
  greet(name: string): string {
    this.visits++;
    return `Hi ${name}`;
  }
}

const warehouse = new Warehouse();
await warehouse.put("sys", new MemoryStore());
await warehouse.put("sys/greeter", new Greeter());
await warehouse.open();

const server = await EpServer.listen({ port: 10901, warehouse });
```

Any client — TypeScript, JavaScript, or a .NET Esiur client — can then attach
to `ep://host:10901/sys/greeter`, read/write `visits`, call `greet()`, and
receive property-change notifications, all without any code generation step.

### Events

```ts
import { Resource, Export, event, type EventSource } from "esiur";

class Counter extends Resource {
  @Export(t.i32) accessor count = 0;
  @Export(t.string) changed: EventSource<string> = event<string>();

  @Export(t.i32)
  increment(): number {
    this.count++;
    this.changed.emit(`now ${this.count}`);
    return this.count;
  }
}
```

## Federation and relay

A resource fetched from one node can be handed to another node's own
`Warehouse` and re-served from there — attaching, property access, function
calls, and events all forward transparently through the relaying node:

```ts
// Node B fetches a resource from node A, without a local TypeDef.
const fromA = await connectionToA.get("sys/counter");
const raw = connectionToA.getAttachedResource(fromA.instanceId)!;

// Put it into B's own warehouse — it's now a first-class member there too.
await warehouseB.put("sys/relay", raw);
```

A third node connecting only to B can now attach `sys/relay` and use it
exactly as if it were local to B, including calls and events that round-trip
back through B to the original resource on A.

## Resource lifecycle, static calls, and streaming

Beyond property/function/event access, a server built with `EpServer`
answers the full EP resource-management surface:

```ts
// Create a resource of a registered type, with initial property values.
const id = await client.createResource("sys/counter", typeDefId, new Map([[0, 42]]));

// Static/class-level calls — no resource instance required.
const sum = await client.staticCall(typeDefId, addFunctionIndex, 3, 4);

// Rename, detach (stop this connection's subscription), or delete.
await client.moveResource(id, "renamed");
await client.detach(id);
await client.deleteResource(id);
```

Exported functions can also be async generators, streamed back to the caller
chunk by chunk and pausable mid-stream:

```ts
import { StreamMode } from "esiur";

class Counter extends Resource {
  @Export(t.i32, [t.i32], { streamMode: StreamMode.Pull, pausable: true })
  async *countTo(n: number): AsyncGenerator<number> {
    for (let i = 1; i <= n; i++) yield i;
  }
}
```

The client calls it with `invokeStream(streamMode, instanceId, index, ...args)`,
which returns an `AsyncStreamReply` — an async iterable, so you can consume it
with `for await`, or drive it manually with `.pull()`/`.halt()`/`.resume()`/
`.terminate()`:

```ts
for await (const n of client.invokeStream(StreamMode.Pull, instanceId, countToIndex, 5)) {
  console.log(n);
}
```

## Authentication

```ts
import {
  AuthenticationMode,
  EpConnectionContext,
  Warehouse,
} from "esiur";

const warehouse = new Warehouse();
warehouse.registerAuthenticationProvider(new MyPasswordProvider());

const connection = await warehouse.get(
  "ep://localhost:10901",
  new EpConnectionContext({
    authenticationMode: AuthenticationMode.InitializerIdentity,
    identity: "alice",
    authenticationProtocol: "password-sha3-v1",
    domain: "test",
  }),
);
```

Servers register password providers on the served warehouse the same way:

```ts
warehouse.registerAuthenticationProvider(new MyPasswordProvider());
```

`EpConnectionContext` and `Warehouse`'s auth methods also accept the
PascalCase field/method names used by Esiur for .NET
(`RegisterAuthenticationProvider`, `new EpConnectionContext({ AuthenticationMode, Identity, Domain })`)
as aliases, for convenience when porting code between the two platforms.

## React bindings

Optional hooks, importable from `esiur/react` (has no effect on the core
bundle — `react` is only touched if you import this entry point):

```tsx
import { useProperty, useResource, useResourceEvent } from "esiur/react";

function CounterView({ counter }: { counter: unknown }) {
  const count = useProperty<number>(counter, "count");
  return <div>{count}</div>;
}
```

## CLI

`esiur` installs a `bin/esiur` command that forwards to
[`Esiur.CLI`](https://www.nuget.org/packages/Esiur.CLI), a .NET global tool
used for tasks like generating typed client stubs from resource definitions.
If the tool isn't installed yet, running `npx esiur` prints install
instructions (`dotnet tool install -g Esiur.CLI`); otherwise it forwards
argv/stdio straight through and propagates the exit code.

## Build

```bash
npm install
npm run check
npm run build
```

`npm run check` runs type checking, ESLint, and the test suite. The runtime
package supports Node.js 18+. The dev toolchain requires Node.js 18.18+.

## Status

The v3 TypeScript port implements the full EP wire protocol: attach/reattach
(including reconnect resubscription), property read/write with change
notifications, function invocation, ref-counted event subscription (`.on()`/
`.off()`), server-side TypeDef answering (so clients can attach without a
predeclared type), resource lifecycle (create/delete/move/detach), static
calls, streaming function replies (pull/push, pausable, terminable), AES
transport encryption, and the permissions/rate-limiting/auditing manager
layer. `EpResource` implements `IResource`, so a resource fetched from one
node can be relayed through another node's warehouse to a third.

Known gaps: only an in-memory store ships in this package (other backends
are separate packages by design); no compose-side support yet for resource
references inside arbitrary composed values (a few handlers that would
otherwise send live resource references send `[id, link]` pairs instead —
noted at the relevant call sites); direct raw TCP transport is client-only
(no raw-TCP server).

## License

MIT
