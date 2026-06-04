/**
 * A placeholder produced when a resource reference is decoded without a
 * connection/warehouse to resolve it (port of C# `ResourceId`). Carries whether
 * the reference is local and the numeric instance id.
 */
export class ResourceId {
  constructor(
    readonly local: boolean,
    readonly id: number,
  ) {}
}
