# esiur-dotnet / esiur-ts parity matrix

This matrix is the implementation checklist for Esiur 3.1. A row is only
`Complete` when behavior is covered by a TypeScript test and, for wire-visible
behavior, a reciprocal dotnet fixture or interoperability test.

| Surface | Status | Evidence / remaining work |
| --- | --- | --- |
| Primitive and dynamic TDU wire values | Complete | `wire-golden`, `decode-roundtrip`, and dotnet interop tests. |
| Gvwie typed integer arrays | Complete | All signed/unsigned widths plus decoded-count and allocation guards. |
| TRU primitives, composites, and local references | Complete | Golden vectors, nullable/composite tests, depth limit. |
| Remote TypeDef references | Complete | Shared fetches, placeholder cycles, wait graph, malformed cleanup tests. |
| TypeDef top-level metadata | Complete | Canonical indexed fixture produced/consumed by both runtimes. |
| TypeDef 64-bit identifiers | Complete | TypeScript uses `bigint`; fixture test covers values beyond `Number.MAX_SAFE_INTEGER`. |
| TypeDef member metadata | Complete | Reciprocal fixtures cover function/property/event/constant annotations, argument metadata, control flags, and related-member links. |
| Parser packet/depth budgets | Complete | Matches dotnet defaults: 8 MiB and depth 64. |
| Parser allocation/collection budgets | Complete | Matches dotnet defaults: 4 MiB and 65,536 items; sync/async and compressed arrays covered. |
| Resource-reference encoding/decoding | Complete | Local/remote references and homogeneous resource lists compose in both directions; async packet decoding attaches references through the active connection; cyclic graphs and reciprocal dotnet↔TypeScript Query/invocation tests are covered. |
| Attach/detach/reattach | Complete | Canonical proxy reuse, duplicate attach coalescing, same-chain and cross-chain cycle detection, failure cleanup, explicit detach, and reconnect restoration are covered. |
| Property/event cursors and journal replay | Complete | Generation/revision cursor, query, replay, and reconnect tests. |
| Event subscribe/unsubscribe | Complete | Ref-counted subscription and reconnect resubscription tests. |
| Streaming invocation lifecycle | Complete | Stream start/chunk/pull/halt/resume/terminate/completion tests, including ordered resolver-aware resource chunks. |
| Authentication and encryption | Complete for implemented providers | Anonymous/password and AES transport suites pass; stalled handshakes and oversized encrypted records are bounded. Provider-by-provider fixture expansion remains release work. |
| Connection/resource admission limits | Complete | Global/per-IP connection and attempt windows, pending/attached resource budgets, duplicate rejection, and release-on-close are covered. |
| HTTP/WebSocket parser limits | Complete for applicable surface | Upgrade headers, header count, WebSocket payloads, EP packets, encryption records, and decoded allocations are bounded. TypeScript does not host dotnet's form/multipart HTTP application stack. |
| Failure/cancellation cleanup | Complete | Request, resource, TypeDef, stream, notification, and decode queues settle or clear on failure/disconnect; replay and public-call ordering are covered. |

## Merge gate

Every parity change must pass:

1. Type checking and lint
2. the complete TypeScript unit/conformance/fuzz suite
3. reciprocal dotnet conformance fixtures
4. the TypeScript↔dotnet process-level transport suite
5. the distributable package build

Run the complete release gate with `npm run check:release`, or only the
reciprocal transport suite with `npm run test:interop`.

The canonical contract and required cycle/failure scenarios are defined in
[`typedef-parity.md`](./typedef-parity.md).
