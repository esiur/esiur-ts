// Public entry point for the `esiur` package.
// Re-exports are added phase-by-phase as the port progresses.

import "./internal/metadata.js";

// Phase 1 — Foundation
export * from "./core/index.js";
export * from "./data/index.js";

// Phase 3 — Resource model + stores
export * from "./resource/index.js";
export * from "./stores/index.js";

// Phase 4 — Networking
export * from "./net/index.js";

// Phase 5 — IIP/Ep protocol
export * from "./protocol/index.js";

// Phase 6 — Security / auth
export * from "./security/index.js";
