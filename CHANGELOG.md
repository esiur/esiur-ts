# Release notes

## Unreleased (3.2.0)

- **Breaking protocol change: TypeDef cache synchronization.** The `Warehouse` keeps remote
  definitions by domain and class name, and `EpConnection` validates them during connection
  establishment (also after an automatic reconnect, before resources are reattached) with the
  new `SyncTypeDefs` request (0xF). Cached definitions are updated in place, attached resources
  rebind by member name, and the connection starts with its type-id map built, saving a
  `TypeDefById` round trip per type. `TypeDefInfo.signature` (index 0x0A) is an id-independent
  hash of the definition. A TypeScript node answers `SyncTypeDefs` too. See
  `docs/typedef-sync.md`.
- Compiled stubs and templates bind by name: `EpResource` gains `_FunctionIndex`,
  `_PropertyIndex`, `_EventIndex`, `_PropertyValue` and the `_EmitEventByName` override point.
  Attaching with a template or stub class fetches the node's current definition (once per type
  per connection) and keeps the template as `expectedTypeDef`; a member the node removed fails
  with `EpMemberUnavailableError` (function call, property get/set, event subscription).
- Connection establishment waits at most `EpConnection.typeDefSyncTimeoutMs` (15 s) for a node
  that predates `SyncTypeDefs`, then drops the cache and carries on.
- Add a dependency-free synchronous SHA-256 (`src/data/sha256.ts`) for the signature.

### Migration notes

- Use matching 3.2 runtimes on both ends to benefit from the cache; an older node ignores the
  request and the cache is dropped after the timeout.
- Attaching with a template (`attach(id, template)` or a stub class) now makes one extra
  `TypeDefById` request per type and connection unless the definition is already cached.

## 3.1.0

- Preserve complete TypeDef/member metadata and exact 64-bit identifiers.
- Decode resource-valued replies, notifications, and stream chunks in order;
  coalesce attachments and handle cyclic and concurrent resource/type graphs.
- Add resource journals, generation/revision cursors, history queries, and
  reconnect replay; restore active event subscriptions after reconnecting.
- Bound parser allocations, collection sizes, metadata depth, authentication
  handshakes, encrypted records, connections, and resource attachments.
- Yield during large notification bursts and fail pending work promptly when
  a WebSocket closes.
- Add opt-in connection diagnostics and EP endpoint normalization.
- Add .NET interoperability, browser, conformance, and parser fuzz tests.
- Update and audit the development toolchain; it is not included as runtime
  dependencies in the published package.

### Migration notes

- TypeDef identifiers (including `ITypeDef.id`, `TypeDefInfo.id`, and parent
  identifiers) are now `bigint`, not `number`. Use bigint literals/comparisons
  and convert IDs to strings when serializing application JSON. Do not convert
  arbitrary 64-bit IDs to JavaScript numbers.
- An EP endpoint without an explicit port now uses 51018. Specify a port or a
  WebSocket URI explicitly for deployments using a different endpoint.
- Parser and connection budgets are enabled by default. Configure the
  warehouse limits deliberately for workloads with larger payloads.
- The distributed package still targets ES2022 and Node.js 18+. Development
  and release checks use Node.js 22.12+ and the sibling `esiur-dotnet` checkout.

Run `npm ci`, `npm run check:release`, and `npm audit` before packaging.
The release checks build the .NET interop fixture; they do not publish either
NuGet or npm packages.
