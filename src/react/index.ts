// Optional React bindings for `esiur` (import from `"esiur/react"`).
//
// This entry point is the *only* place in the package that imports `react` —
// the core library (`"esiur"`) has no React dependency at all, and building
// it never touches this file. `react` is a peer dependency here, matching
// the `ws` peer-dependency pattern already used for the optional Node
// WebSocket fallback.
export { useProperty } from "./useProperty.js";
export { useResource } from "./useResource.js";
export { useResourceEvent } from "./useResourceEvent.js";
