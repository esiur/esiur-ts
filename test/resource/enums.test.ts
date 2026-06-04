import { describe, it, expect } from "vitest";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { defineEnum, enumValue } from "../../src/resource/enums.js";
import { compose, parse } from "../../src/data/Codec.js";
import * as DC from "../../src/data/DC.js";

const Color = defineEnum("Color", { Red: 0, Green: 1, Blue: 2 });

describe("enums (local round-trip)", () => {
  it("round-trips an enum value and pins its bytes", () => {
    const wh = new Warehouse();
    const bytes = compose(enumValue(Color, 2 /* Blue */), wh);
    // Typed TDU 0x88, len 3: TruTypeDef(LocalType8 id=1)="4001", then constant index 0x02.
    expect(DC.toHex(bytes)).toBe("8803400102");
    expect(parse(bytes, 0, wh)).toBe(2);
  });

  it("maps the wire index back to the enum value (non-contiguous values)", () => {
    const Status = defineEnum("Status", { Ok: 10, Fail: 20 });
    const wh = new Warehouse();
    expect(parse(compose(Status.value(20), wh), 0, wh)).toBe(20);
    expect(parse(compose(Status.value(10), wh), 0, wh)).toBe(10);
  });
});
