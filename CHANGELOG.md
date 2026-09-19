# Release notes

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
