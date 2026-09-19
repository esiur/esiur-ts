import { describe, it, expect } from "vitest";
import { compose, parse } from "../../src/data/Codec.js";
import { TypeDefInfo } from "../../src/data/types/TypeDefInfo.js";
import { PropertyDefInfo } from "../../src/data/types/PropertyDefInfo.js";
import { FunctionDefInfo } from "../../src/data/types/FunctionDefInfo.js";
import { EventDefInfo } from "../../src/data/types/EventDefInfo.js";
import { ConstantDefInfo } from "../../src/data/types/ConstantDefInfo.js";
import { PropertyDefFlags } from "../../src/data/types/PropertyDefFlags.js";
import { FunctionDefFlags } from "../../src/data/types/FunctionDefFlags.js";
import { EventDefFlags } from "../../src/data/types/EventDefFlags.js";
import { ArgumentDefFlags } from "../../src/data/types/ArgumentDefFlags.js";
import { OrderingControl } from "../../src/data/OrderingControl.js";
import { OperationEffects } from "../../src/data/types/OperationEffects.js";
import { StreamMode } from "../../src/data/types/StreamMode.js";
import { TypeDefKind } from "../../src/data/types/ITypeDef.js";
import { typeDefInfoFromTypeDef } from "../../src/resource/typeDefInfoCompose.js";
import {
  ArgumentTemplate,
  ConstantTemplate,
  EventTemplate,
  FunctionTemplate,
  PropertyTemplate,
  TypeDef,
} from "../../src/resource/template.js";
import { RemoteTypeDef } from "../../src/protocol/RemoteTypeDef.js";
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

  it("preserves every TypeDef and member metadata field while relaying", async () => {
    const annotations = new Map([["owner", "operations"]]);
    const property = new PropertyTemplate(
      "temperature",
      3,
      t.f64,
      true,
      annotations,
      true,
      {
        inherited: true,
        deprecated: true,
        deprecationMessage: "Use ambientTemperature",
        description: "Measured temperature",
        usage: "Display and trend this value",
        examples: [22.5],
        tags: ["hvac", "sensor"],
        unit: "°C",
        minimum: -40,
        maximum: 125,
        allowedValues: [20, 21, 22],
        pattern: "^-?[0-9.]+$",
        format: "0.0",
        preconditions: ["sensor online"],
        postconditions: ["reading emitted"],
        effects: OperationEffects.EmitsEvents,
        warnings: ["calibration required"],
        relatedMembers: [4, 5],
        constant: true,
        volatile: true,
        orderingControl: OrderingControl.LatestOnly,
        historyControl: 7,
        defaultValue: 20,
      },
    );
    const argument = new ArgumentTemplate("target", t.f64, true, annotations, {
      variadic: true,
      defaultValue: 21,
    });
    const fn = new FunctionTemplate(
      "setTemperature",
      2,
      t.bool,
      [argument],
      true,
      annotations,
      StreamMode.Push,
      true,
      {
        inherited: true,
        deprecated: true,
        description: "Set the target",
        readOnly: true,
        idempotent: true,
        cancellable: true,
        effects: OperationEffects.ModifiesState,
      },
    );
    const event = new EventTemplate(
      "changed",
      1,
      t.f64,
      annotations,
      false,
      true,
      {
        inherited: true,
        deprecated: true,
        description: "Temperature changed",
        argumentName: "temperature",
        orderingControl: OrderingControl.Relaxed,
        historyControl: 9,
      },
    );
    const constant = new ConstantTemplate(
      "Nominal",
      0,
      t.i32,
      22,
      annotations,
      { inherited: true, deprecated: true, description: "Nominal target" },
    );
    const definition = new TypeDef(
      "Controller",
      [property, fn, event, constant],
      annotations,
      {
        version: 5,
        parentTypeId: 88n,
        namespace: "Building.Hvac",
        usage: "Controls a room",
        description: "HVAC controller",
        example: "enabled=true",
        category: "HVAC",
        since: "3.1",
      },
    );

    const first = typeDefInfoFromTypeDef(9_007_199_254_740_993n, TypeDefKind.Resource, definition);
    const remote = await RemoteTypeDef.parseAsync(compose(first));
    const relayed = parse(
      compose(typeDefInfoFromTypeDef(remote.id, remote.kind, remote.template)),
    ) as TypeDefInfo;

    expect(relayed).toMatchObject({
      version: 5,
      id: 9_007_199_254_740_993n,
      name: "Building.Hvac.Controller",
      namespace: "Building.Hvac",
      parent: 88n,
      usage: "Controls a room",
      description: "HVAC controller",
      example: "enabled=true",
      category: "HVAC",
      since: "3.1",
      annotations,
    });

    const relayedProperty = relayed.properties![0];
    expect(relayedProperty.flags & PropertyDefFlags.Inherited).toBeTruthy();
    expect(relayedProperty.flags & PropertyDefFlags.Deprecated).toBeTruthy();
    expect(relayedProperty.flags & PropertyDefFlags.ReadOnly).toBeTruthy();
    expect(relayedProperty.flags & PropertyDefFlags.Constant).toBeTruthy();
    expect(relayedProperty.flags & PropertyDefFlags.Volatile).toBeTruthy();
    expect(relayedProperty.flags & PropertyDefFlags.Historical).toBeTruthy();
    expect(relayedProperty).toMatchObject({
      description: "Measured temperature",
      usage: "Display and trend this value",
      examples: [22.5],
      tags: ["hvac", "sensor"],
      unit: "°C",
      minimum: -40,
      maximum: 125,
      allowedValues: [20, 21, 22],
      pattern: "^-?[0-9.]+$",
      format: "0.0",
      preconditions: ["sensor online"],
      postconditions: ["reading emitted"],
      effects: OperationEffects.EmitsEvents,
      warnings: ["calibration required"],
      relatedMembers: [4, 5],
      deprecationMessage: "Use ambientTemperature",
      orderingControl: OrderingControl.LatestOnly,
      historyControl: 7,
      defaultValue: 20,
      annotations,
    });

    const relayedFunction = relayed.functions![0];
    expect(relayedFunction.flags & FunctionDefFlags.Inherited).toBeTruthy();
    expect(relayedFunction.flags & FunctionDefFlags.Deprecated).toBeTruthy();
    expect(relayedFunction.flags & FunctionDefFlags.Static).toBeTruthy();
    expect(relayedFunction.flags & FunctionDefFlags.ReadOnly).toBeTruthy();
    expect(relayedFunction.flags & FunctionDefFlags.Idempotent).toBeTruthy();
    expect(relayedFunction.flags & FunctionDefFlags.Cancellable).toBeTruthy();
    expect(relayedFunction.flags & FunctionDefFlags.Pausable).toBeTruthy();
    expect(relayedFunction.streamMode).toBe(StreamMode.Push);
    expect(relayedFunction.arguments![0].flags & ArgumentDefFlags.Optional).toBeTruthy();
    expect(relayedFunction.arguments![0].flags & ArgumentDefFlags.Variadic).toBeTruthy();
    expect(relayedFunction.arguments![0].defaultValue).toBe(21);

    const relayedEvent = relayed.events![0];
    expect(relayedEvent.flags & EventDefFlags.Inherited).toBeTruthy();
    expect(relayedEvent.flags & EventDefFlags.Deprecated).toBeTruthy();
    expect(relayedEvent.flags & EventDefFlags.AutoDelivered).toBeTruthy();
    expect(relayedEvent.flags & EventDefFlags.Historical).toBeTruthy();
    expect(relayedEvent).toMatchObject({
      argumentName: "temperature",
      orderingControl: OrderingControl.Relaxed,
      historyControl: 9,
    });

    expect(relayed.constants![0]).toBeInstanceOf(ConstantDefInfo);
    expect(relayed.constants![0]).toMatchObject({
      index: 0,
      name: "Nominal",
      value: 22,
      description: "Nominal target",
      annotations,
    });
  });
});
