import { describe, it, expect } from "vitest";
import { compose, parse } from "../../src/data/Codec.js";
import { TypeDefInfo } from "../../src/data/types/TypeDefInfo.js";
import { PropertyDefInfo } from "../../src/data/types/PropertyDefInfo.js";
import { FunctionDefInfo } from "../../src/data/types/FunctionDefInfo.js";
import { EventDefInfo } from "../../src/data/types/EventDefInfo.js";
import { FunctionDefFlags } from "../../src/data/types/FunctionDefFlags.js";
import { EventDefFlags } from "../../src/data/types/EventDefFlags.js";
import { TypeDefKind } from "../../src/data/types/ITypeDef.js";
import { typeDefInfoFromTypeDef } from "../../src/resource/typeDefInfoCompose.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, AutoDelivered, event, type EventSource } from "../../src/resource/decorators.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { t } from "../../src/data/descriptors.js";

class SampleResource extends Resource {
  @Export(t.i32) accessor count = 0;

  @Export(t.string, [t.string, t.i32])
  greet(name: string, times: number): string {
    return `${name}x${times}`;
  }

  @Export(t.string) changed: EventSource<string> = event<string>();
  @Export(t.string) @AutoDelivered() tick: EventSource<string> = event<string>();

  @Export(t.i32)
  static count(): number {
    return 1;
  }
}

describe("typeDefInfoFromTypeDef", () => {
  it("round-trips a decorated resource's TypeDef through Codec.compose/parse", () => {
    const wh = new Warehouse();
    const local = wh.getLocalTypeDefByType(SampleResource);
    const info = typeDefInfoFromTypeDef(local.id, local.kind, wh.getTypeDef(SampleResource));

    const bytes = compose(info);
    const decoded = parse(bytes) as TypeDefInfo;
    expect(decoded).toBeInstanceOf(TypeDefInfo);

    expect(decoded.id).toBe(local.id);
    expect(decoded.kind).toBe(TypeDefKind.Resource);
    expect(decoded.name).toBe("SampleResource");

    expect(decoded.properties).toHaveLength(1);
    const count = decoded.properties!.find((p) => p.name === "count")!;
    expect(count).toBeInstanceOf(PropertyDefInfo);

    expect(decoded.functions).toHaveLength(2);
    const greet = decoded.functions!.find((f) => f.name === "greet")!;
    expect(greet).toBeInstanceOf(FunctionDefInfo);
    expect(greet.arguments).toHaveLength(2);
    // ts decorators can't introspect real parameter names — @Export
    // synthesizes arg0/arg1/... (see typeDefInfoCompose.ts's own doc comment).
    expect(greet.arguments![0].name).toBe("arg0");
    expect(greet.arguments![1].name).toBe("arg1");
    expect(greet.flags & FunctionDefFlags.Static).toBe(0);

    // `static count()` — @Export auto-detects the `static` keyword via the
    // decorator context, no separate option needed (see decorators.ts).
    const staticCount = decoded.functions!.find((f) => f.name === "count")!;
    expect(staticCount.flags & FunctionDefFlags.Static).toBe(FunctionDefFlags.Static);

    expect(decoded.events).toHaveLength(2);
    const changed = decoded.events!.find((e) => e.name === "changed")!;
    expect(changed).toBeInstanceOf(EventDefInfo);
    // Default (subscribable): not AutoDelivered.
    expect(changed.flags & EventDefFlags.AutoDelivered).toBe(0);
    const tick = decoded.events!.find((e) => e.name === "tick")!;
    expect(tick.flags & EventDefFlags.AutoDelivered).toBe(EventDefFlags.AutoDelivered);
  });
});
