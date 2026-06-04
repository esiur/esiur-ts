import { TduClass } from "./TduClass.js";
import { TduIdentifier } from "./TduIdentifier.js";

/**
 * A decoded TDU header pointing back into the source buffer (port of C#
 * `ParsedTdu`). `parseSync` reads the identifier/length framing and locates the
 * payload; the actual value is produced by the parsers in `DataDeserializer`.
 */
export class ParsedTdu {
  identifier: TduIdentifier = TduIdentifier.Null;
  index = 0;
  tduClass: TduClass = TduClass.Invalid;
  payloadOffset = 0;
  payloadLength = 0;
  data: Uint8Array = new Uint8Array(0);
  exponent = 0;
  totalLength = 0;
  /** Type metadata (Tru) for {@link TduClass.Typed}; populated in Step B. */
  metadata: unknown = null;
  ends = 0;

  static invalid(totalLength: number): ParsedTdu {
    const t = new ParsedTdu();
    t.tduClass = TduClass.Invalid;
    t.totalLength = totalLength;
    return t;
  }

  /** Parse a TDU header at `offset` (sync path; resolves typed metadata via warehouse). */
  static parseSync(
    data: Uint8Array,
    offset: number,
    ends: number,
    warehouse: unknown = null,
  ): ParsedTdu {
    let pos = offset;
    const h = data[pos++];
    const cls = (h >> 6) as TduClass;

    if (cls === TduClass.Fixed) {
      const exp = (h & 0x38) >> 3;
      const t = new ParsedTdu();
      t.data = data;
      t.tduClass = cls;
      t.identifier = h as TduIdentifier;
      t.exponent = exp;
      t.index = h & 0x7;
      t.ends = ends;

      if (exp === 0) {
        t.payloadOffset = pos;
        t.payloadLength = 0;
        t.totalLength = 1;
        return t;
      }

      const cl = 1 << (exp - 1);
      if (ends - pos < cl) return ParsedTdu.invalid(cl - (ends - pos));

      t.payloadOffset = pos;
      t.payloadLength = cl;
      t.totalLength = 1 + cl;
      return t;
    }

    // Dynamic / Typed / Extension: read `cll` big-endian length bytes.
    const cll = (h >> 3) & 0x7;
    if (ends - pos < cll) return ParsedTdu.invalid(cll - (ends - pos));

    let cl = 0;
    for (let i = 0; i < cll; i++) cl = cl * 256 + data[pos++];
    if (ends - pos < cl) return ParsedTdu.invalid(cl - (ends - pos));

    if (cls === TduClass.Typed) {
      const { value: tru, size } = parseTruSync(data, pos, warehouse);
      pos += size;
      const t = new ParsedTdu();
      t.data = data;
      t.tduClass = cls;
      t.identifier = (h & 0xc7) as TduIdentifier;
      t.index = h & 0x7;
      t.payloadOffset = pos;
      t.payloadLength = cl - size;
      t.totalLength = 1 + cl + cll;
      t.metadata = tru;
      t.ends = ends;
      return t;
    }

    const t = new ParsedTdu();
    t.data = data;
    t.tduClass = cls;
    t.identifier = (h & 0xc7) as TduIdentifier;
    t.index = h & 0x7;
    t.payloadOffset = pos;
    t.payloadLength = cl;
    t.totalLength = 1 + cl + cll;
    t.ends = ends;
    return t;
  }
}

/**
 * Pluggable Tru (type-representation) parser. Replaced by the real implementation
 * when the Tru family lands (Phase 2 Step B); until then, typed TDUs are not
 * decodable.
 */
let parseTruSync: (
  data: Uint8Array,
  offset: number,
  warehouse: unknown,
) => { value: unknown; size: number } = () => {
  throw new Error("Typed TDU parsing requires the Tru family (Phase 2 continuation).");
};

/** Wire up the Tru parser (called by the Tru module on import). */
export function registerTruParser(
  fn: (data: Uint8Array, offset: number, warehouse: unknown) => { value: unknown; size: number },
): void {
  parseTruSync = fn;
}
