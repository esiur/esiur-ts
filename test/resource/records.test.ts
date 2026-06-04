import { describe, it, expect } from "vitest";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { Record } from "../../src/resource/records.js";
import { Export } from "../../src/resource/decorators.js";
import { compose, parse } from "../../src/data/Codec.js";
import { t, typedList } from "../../src/data/descriptors.js";
import * as DC from "../../src/data/DC.js";

class PointRecord extends Record {
  @Export(t.i32) accessor x = 0;
  @Export(t.i32) accessor y = 0;
}

class PathRecord extends Record {
  @Export(t.string) accessor name = "";
  @Export(t.list(t.i32)) accessor points: number[] = [];
}

describe("records (local round-trip)", () => {
  it("round-trips a primitive record and pins its bytes", () => {
    const wh = new Warehouse();
    const p = new PointRecord();
    p.x = 3;
    p.y = 4;

    const bytes = compose(p, wh);
    // Typed TDU 0x88, len 6: TruTypeDef(LocalType8 id=1)="4001", then x=Int8 3, y=Int8 4.
    expect(DC.toHex(bytes)).toBe("8806400109030904");

    const decoded = parse(bytes, 0, wh) as PointRecord;
    expect(decoded).toBeInstanceOf(PointRecord);
    expect(decoded.x).toBe(3);
    expect(decoded.y).toBe(4);
  });

  it("round-trips a record with a typed-list property (TypeOfTarget stripping)", () => {
    const wh = new Warehouse();
    const r = new PathRecord();
    r.name = "seg";
    // The property value carries its type so it encodes via the typed Gvwie path.
    r.points = typedList(t.i32, [1, 2, 3]) as unknown as number[];

    const decoded = parse(compose(r, wh), 0, wh) as PathRecord;
    expect(decoded).toBeInstanceOf(PathRecord);
    expect(decoded.name).toBe("seg");
    expect(decoded.points).toEqual([1, 2, 3]);
  });

  it("uses distinct ids for distinct record types in one warehouse", () => {
    const wh = new Warehouse();
    const a = wh.getLocalTypeDefByType(PointRecord);
    const b = wh.getLocalTypeDefByType(PathRecord);
    expect(a.id).not.toBe(b.id);
    expect(wh.getLocalTypeDefByType(PointRecord)).toBe(a); // cached
    expect(wh.getLocalTypeDefById(a.id)).toBe(a);
  });
});
