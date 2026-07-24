/**
 * Marker base for local, schema-less types whose members are identified by
 * byte indexes on the wire (port of C# `IndexedStructure`). Composed as a
 * sparse `TypedMap<u8, dynamic>` — `null`/`undefined` members are omitted,
 * and unknown indices are silently ignored on decode (version tolerant).
 */
export abstract class IndexedStructure {}
