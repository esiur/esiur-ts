import type { Tru } from "../data/Tru.js";

/**
 * Lightweight TypeDef describing a resource's exported members, built from
 * decorator metadata instead of reflection.
 */
export enum MemberType {
  Function = 0,
  Property = 1,
  Event = 2,
}

export class ArgumentTemplate {
  constructor(
    public name: string,
    public type: Tru | undefined,
    public optional = false,
    public annotations?: Map<string, string>,
  ) {}
}

export class PropertyTemplate {
  readonly memberType = MemberType.Property;
  constructor(
    public name: string,
    public index: number,
    public valueType: Tru | undefined,
    public readOnly = false,
    public annotations?: Map<string, string>,
  ) {}
}

export class FunctionTemplate {
  readonly memberType = MemberType.Function;
  constructor(
    public name: string,
    public index: number,
    public returnType: Tru | undefined,
    public args: ArgumentTemplate[] = [],
    public isStatic = false,
    public annotations?: Map<string, string>,
  ) {}
}

export class EventTemplate {
  readonly memberType = MemberType.Event;
  constructor(
    public name: string,
    public index: number,
    public argType: Tru | undefined,
    public annotations?: Map<string, string>,
    public subscribable = false,
  ) {}
}

export type MemberTemplate = PropertyTemplate | FunctionTemplate | EventTemplate;

/** Describes the exported surface of a resource type. */
export class TypeDef {
  constructor(
    public className: string,
    public members: MemberTemplate[],
    public annotations?: Map<string, string>,
  ) {}

  get properties(): PropertyTemplate[] {
    return this.members.filter((m): m is PropertyTemplate => m.memberType === MemberType.Property);
  }
  get functions(): FunctionTemplate[] {
    return this.members.filter((m): m is FunctionTemplate => m.memberType === MemberType.Function);
  }
  get events(): EventTemplate[] {
    return this.members.filter((m): m is EventTemplate => m.memberType === MemberType.Event);
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
