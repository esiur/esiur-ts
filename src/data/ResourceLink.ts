/**
 * A textual link to a resource, e.g. "iip://host/path" (port of C#
 * `ResourceLink`, which is implicitly convertible to/from string).
 */
export class ResourceLink {
  constructor(readonly link: string) {}
  toString(): string {
    return this.link;
  }
}
