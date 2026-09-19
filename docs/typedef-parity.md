# Esiur TypeDef parity contract

This document defines protocol-semantic parity between `esiur-dotnet` and
`esiur-ts`. It intentionally does not require identical runtime class shapes.

## Conformance surface

| Area | Required behavior |
| --- | --- |
| Wire formats | Decode and encode legacy TypeDefs and indexed `TypeDefInfo` payloads. |
| Identifiers | Preserve local and remote identifiers without numeric loss. |
| Metadata | Preserve namespace, usage, description, example, category, since, annotations, and member metadata. |
| References | Resolve local TypeDefs from the Warehouse and remote TypeDefs through the active connection. |
| Dependency cycles | Break genuine same-chain and cross-chain wait cycles with stable in-progress placeholders. |
| Lifecycle | Reuse canonical remote definitions and proxies across attachment and reconnection. |
| Safety | Enforce packet, allocation, collection, and recursive type-metadata budgets. |
| Failure cleanup | Remove wait edges and incomplete requests after error, timeout, cancellation, or disconnect. |

## Canonical scenarios

Every implementation must pass the following cases for both legacy and indexed
payloads where the format supports them:

1. Flat resource, record, enum, and function definitions.
2. Every top-level and member metadata field populated.
3. Local and remote references encoded at 8, 16, 32, and 64 bits.
4. Self-cycle, two-node cycle, multi-node cycle, and concurrent cross-chain cycle.
5. Acyclic chain, diamond, and shared dependency without false cycle breaking.
6. Disconnect, cancellation, and malformed payload during dependency resolution.
7. Maximum allowed nesting and one level beyond the configured parser budget.

## Fixture contract

Cross-runtime fixtures consist of the exact binary payload plus normalized JSON
describing the expected semantic TypeDef. Binary equality is required only when
the protocol defines a canonical encoding; semantic equality is always required.

Fixture producers must identify their runtime and protocol version. CI must test
both directions: dotnet-produced fixtures in TypeScript and TypeScript-produced
fixtures in dotnet.
