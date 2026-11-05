/**
 * A member that compiled client code (a generated stub class, or a template the application
 * attached with) was built against does not exist on the definition the node serves now.
 *
 * The member name is stable, its index is not: stubs resolve the current index by name at run
 * time, so a node that renumbered or extended its type keeps working, and a member the node
 * removed fails with this error naming the member and the type (docs/typedef-sync.md).
 */
export class EpMemberUnavailableError extends Error {
  readonly typeName: string;
  readonly memberName: string;
  /** "function", "property" or "event". */
  readonly memberKind: string;

  constructor(typeName: string, memberName: string, memberKind: string, reason?: string) {
    super(
      `The ${memberKind} '${memberName}' is no longer available on '${typeName}'` +
        (reason ? ` (${reason})` : "") +
        ". The server definition changed; update the client code that uses it.",
    );
    this.name = "EpMemberUnavailableError";
    this.typeName = typeName;
    this.memberName = memberName;
    this.memberKind = memberKind;
  }
}
