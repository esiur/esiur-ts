import * as DC from "./DC.js";

/**
 * A 16-byte universally-unique identifier (port of C# `Uuid`).
 *
 * Stores the raw bytes as-is (no group reordering); {@link toString} formats
 * them in the canonical 8-4-4-4-12 grouping directly from byte order.
 */
export class Uuid {
  /** The raw 16 bytes. */
  readonly data: Uint8Array;

  constructor(data: Uint8Array, offset = 0) {
    if (offset + 16 > data.length)
      throw new Error("UUID data size must be at least 16 bytes");
    this.data = data.slice(offset, offset + 16);
  }

  toString(): string {
    return (
      `${DC.toHex(this.data, 0, 4)}-${DC.toHex(this.data, 4, 2)}-` +
      `${DC.toHex(this.data, 6, 2)}-${DC.toHex(this.data, 8, 2)}-` +
      `${DC.toHex(this.data, 10, 6)}`
    );
  }

  equals(other: unknown): boolean {
    if (!(other instanceof Uuid) || other.data.length !== this.data.length)
      return false;
    for (let i = 0; i < this.data.length; i++)
      if (this.data[i] !== other.data[i]) return false;
    return true;
  }

  /** Parse a canonical UUID string ("xxxxxxxx-xxxx-...") into raw bytes. */
  static parse(value: string): Uuid {
    return new Uuid(DC.fromHex(value.replace(/-/g, ""), null));
  }

  /** A random v4-style UUID (uses crypto when available). */
  static newUuid(): Uuid {
    const bytes = new Uint8Array(16);
    const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } };
    if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return new Uuid(bytes);
  }
}
