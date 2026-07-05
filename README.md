# Esiur for TypeScript

TypeScript implementation of Esiur v3, a distributed resource framework for
real-time properties, asynchronous function invocation, and events over the
Esiur EP protocol.

This package targets browser and Node.js clients, and includes Node.js server
support through the optional `ws` package.

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

## Use

```ts
import { EpConnection, Warehouse } from "esiur";

const connection = await EpConnection.connect("ws://127.0.0.1:10901");
```

Password authentication uses the same `"hash"` provider model as Esiur for .NET:

```ts
import {
  AuthenticationMode,
  EpConnection,
  EpConnectionContext,
  PasswordAuthenticationProvider,
  Warehouse,
} from "esiur";

const warehouse = new Warehouse();
warehouse.RegisterAuthenticationProvider(new MyPasswordProvider());

const connection = await warehouse.Get<EpConnection>(
  "ep://localhost:10901",
  new EpConnectionContext({
    AuthenticationMode: AuthenticationMode.InitializerIdentity,
    Identity: "alice",
    AuthenticationProtocol: "hash",
    Domain: "test",
  }),
);
```

Servers register password providers on the served warehouse:

```ts
warehouse.RegisterAuthenticationProvider(new MyPasswordProvider());
```

`Warehouse.get` accepts local paths and EP URLs. A bare EP URL returns a
connection:

```ts
const connection = await Warehouse.default.get("ep://127.0.0.1:10901");
```

An EP URL with a path returns an attached remote proxy when you provide a
decorated resource class or `TypeDef`:

```ts
const resource = await Warehouse.default.get(
  "ep://127.0.0.1:10901/sys/recovery",
  RecoveryTestResource,
);
```

`ep://` is transported as `ws://`; `eps://` is transported as `wss://`.

## Build

```bash
npm install
npm run check
npm run build
```

`npm run check` runs type checking, ESLint, and the test suite. The runtime
package supports Node.js 18+. The dev toolchain requires Node.js 18.18+.

## Status

The v3 TypeScript port is in active development. The current package includes
the core async primitives, binary codec, resource model, in-memory store,
WebSocket EP client/server transport, anonymous and password-hash
authentication handshakes, resource attach, function invocation, property
updates, reconnect/reattach support, runtime TypeDef parsing, and
`Warehouse.get` for EP URLs.

Known incomplete areas include encrypted sessions, direct raw TCP transport,
persistent stores, and typed remote resource value decoding.

## License

MIT
