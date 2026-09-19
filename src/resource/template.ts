import type { Tru } from "../data/Tru.js";
import { OrderingControl } from "../data/OrderingControl.js";
import { OperationEffects } from "../data/types/OperationEffects.js";
import { StreamMode } from "../data/types/StreamMode.js";

/**
 * Lightweight TypeDef describing a resource's exported members, built from
 * decorator metadata instead of reflection.
 */
export enum MemberType {
  Function = 0,
  Property = 1,
  Event = 2,
  Constant = 3,
}

/** Documentation and operational metadata shared by every exported member. */
export interface MemberMetadata {
  inherited?: boolean;
  deprecated?: boolean;
  deprecationMessage?: string;
  description?: string;
  usage?: string;
  examples?: unknown[];
  tags?: string[];
  unit?: string;
  minimum?: unknown;
  maximum?: unknown;
  allowedValues?: unknown[];
  pattern?: string;
  format?: string;
  preconditions?: string[];
  postconditions?: string[];
  effects?: OperationEffects;
  warnings?: string[];
  relatedMembers?: number[];
}

/** Metadata carried by a complete TypeDef, matching dotnet's TypeDefInfo surface. */
export interface TypeDefMetadata {
  version?: number;
  parentTypeId?: bigint;
  namespace?: string;
  usage?: string;
  description?: string;
  example?: unknown;
  category?: string;
  since?: string;
}

abstract class MetadataMemberTemplate implements MemberMetadata {
  inherited = false;
  deprecated = false;
  deprecationMessage?: string;
  description?: string;
  usage?: string;
  examples?: unknown[];
  tags?: string[];
  unit?: string;
  minimum?: unknown;
  maximum?: unknown;
  allowedValues?: unknown[];
  pattern?: string;
  format?: string;
  preconditions?: string[];
  postconditions?: string[];
  effects: OperationEffects = OperationEffects.None;
  warnings?: string[];
  relatedMembers?: number[];

  protected applyMetadata(metadata: MemberMetadata | undefined): void {
    if (metadata) Object.assign(this, metadata);
  }
}

export class ArgumentTemplate {
  variadic = false;
  defaultValue?: unknown;
  constructor(
    public name: string,
    public type: Tru | undefined,
    public optional = false,
    public annotations?: Map<string, string>,
    metadata?: { variadic?: boolean; defaultValue?: unknown },
  ) {
    if (metadata) Object.assign(this, metadata);
  }
}

export class PropertyTemplate extends MetadataMemberTemplate {
  readonly memberType = MemberType.Property;
  /** Named Warehouse rate policy applied by `@RateControl(name)`. */
  ratePolicyName?: string;
  constant = false;
  volatile = false;
  orderingControl: OrderingControl = OrderingControl.Strict;
  historyControl = 0;
  defaultValue?: unknown;
  constructor(
    public name: string,
    public index: number,
    public valueType: Tru | undefined,
    public readOnly = false,
    public annotations?: Map<string, string>,
    public historical = false,
    metadata?: MemberMetadata & {
      constant?: boolean;
      volatile?: boolean;
      orderingControl?: OrderingControl;
      historyControl?: number;
      defaultValue?: unknown;
    },
  ) {
    super();
    this.applyMetadata(metadata);
    if (metadata) Object.assign(this, metadata);
  }
}

export class FunctionTemplate extends MetadataMemberTemplate {
  readonly memberType = MemberType.Function;
  /** Named Warehouse rate policy applied by `@RateControl(name)`. */
  ratePolicyName?: string;
  readOnly = false;
  idempotent = false;
  cancellable = false;
  constructor(
    public name: string,
    public index: number,
    public returnType: Tru | undefined,
    public args: ArgumentTemplate[] = [],
    public isStatic = false,
    public annotations?: Map<string, string>,
    /** `None` for an ordinary call; `Push`/`Pull` for a streamed one (see `@Export`'s `streamMode` option). */
    public streamMode: StreamMode = StreamMode.None,
    /** Whether an in-flight stream from this function can be halted/resumed. Meaningless when `streamMode` is `None`. */
    public pausable = false,
    metadata?: MemberMetadata & {
      readOnly?: boolean;
      idempotent?: boolean;
      cancellable?: boolean;
    },
  ) {
    super();
    this.applyMetadata(metadata);
    if (metadata) Object.assign(this, metadata);
  }
}

export class EventTemplate extends MetadataMemberTemplate {
  readonly memberType = MemberType.Event;
  argumentName?: string;
  orderingControl: OrderingControl = OrderingControl.Strict;
  historyControl = 0;
  constructor(
    public name: string,
    public index: number,
    public argType: Tru | undefined,
    public annotations?: Map<string, string>,
    // Matches dotnet: an event requires an explicit Subscribe by default;
    // `@AutoDelivered()` (port of C#'s `[AutoDelivery]`) opts out of that.
    public subscribable = true,
    public historical = false,
    metadata?: MemberMetadata & {
      argumentName?: string;
      orderingControl?: OrderingControl;
      historyControl?: number;
    },
  ) {
    super();
    this.applyMetadata(metadata);
    if (metadata) Object.assign(this, metadata);
  }
}

export class ConstantTemplate extends MetadataMemberTemplate {
  readonly memberType = MemberType.Constant;
  constructor(
    public name: string,
    public index: number,
    public valueType: Tru | undefined,
    public value: unknown,
    public annotations?: Map<string, string>,
    metadata?: MemberMetadata,
  ) {
    super();
    this.applyMetadata(metadata);
  }
}

export type MemberTemplate =
  | PropertyTemplate
  | FunctionTemplate
  | EventTemplate
  | ConstantTemplate;

/** Describes the exported surface of a resource type. */
export class TypeDef {
  version = 0;
  parentTypeId?: bigint;
  namespace?: string;
  usage?: string;
  description?: string;
  example?: unknown;
  category?: string;
  since?: string;

  constructor(
    public className: string,
    public members: MemberTemplate[],
    public annotations?: Map<string, string>,
    metadata?: TypeDefMetadata,
  ) {
    if (metadata) Object.assign(this, metadata);
  }

  get properties(): PropertyTemplate[] {
    return this.members.filter((m): m is PropertyTemplate => m.memberType === MemberType.Property);
  }
  get functions(): FunctionTemplate[] {
    return this.members.filter((m): m is FunctionTemplate => m.memberType === MemberType.Function);
  }
  get events(): EventTemplate[] {
    return this.members.filter((m): m is EventTemplate => m.memberType === MemberType.Event);
  }
  get constants(): ConstantTemplate[] {
    return this.members.filter((m): m is ConstantTemplate => m.memberType === MemberType.Constant);
  }

  getPropertyByName(name: string): PropertyTemplate | undefined {
    return this.properties.find((p) => p.name === name);
  }
  getPropertyByIndex(index: number): PropertyTemplate | undefined {
    return this.properties.find((p) => p.index === index);
  }
  getFunctionByName(name: string): FunctionTemplate | undefined {
    return this.functions.find((f) => f.name === name);
  }
  getFunctionByIndex(index: number): FunctionTemplate | undefined {
    return this.functions.find((f) => f.index === index);
  }
  getEventByName(name: string): EventTemplate | undefined {
    return this.events.find((e) => e.name === name);
  }
  getEventByIndex(index: number): EventTemplate | undefined {
    return this.events.find((e) => e.index === index);
  }
}

/** @deprecated Use {@link TypeDef}. */
export { TypeDef as TypeTemplate };
