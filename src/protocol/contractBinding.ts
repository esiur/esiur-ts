import { TypeDef, type MemberTemplate } from "../resource/template.js";

/**
 * Finds a member by name: exactly first, then ignoring case. A stub is usually camelCase while a
 * .NET node exports PascalCase, and the two are the same member (docs/typedef-sync.md).
 */
export function matchMemberByName<T extends { name: string }>(
  candidates: readonly T[],
  name: string,
): T | undefined {
  const exact = candidates.find((candidate) => candidate.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return candidates.find((candidate) => candidate.name.toLowerCase() === lower);
}

type IndexedMember = MemberTemplate & { name: string; index: number };

/**
 * The contract compiled client code was built against (a template, or a stub class's definition),
 * with the member indexes of the definition the node serves now.
 *
 * Members keep the contract's own names and types, so application code does not change; only the
 * indexes follow the node. A member the node does not have is left out, which is what makes it
 * unavailable (a call or access then fails with a clear error). Returns the contract itself when
 * every member already has the node's index, which is the case until a node changes its type.
 */
export function adaptContract(contract: TypeDef, current: TypeDef): TypeDef {
  let changed = false;
  const members: MemberTemplate[] = [];

  const adapt = (member: IndexedMember, candidates: readonly { name: string; index: number }[]): void => {
    const match = matchMemberByName(candidates, member.name);
    if (!match) {
      changed = true;
      return;
    }
    if (match.index === member.index) {
      members.push(member);
      return;
    }
    const clone = Object.assign(Object.create(Object.getPrototypeOf(member)), member) as IndexedMember;
    clone.index = match.index;
    members.push(clone);
    changed = true;
  };

  for (const property of contract.properties) adapt(property, current.properties);
  for (const fn of contract.functions) adapt(fn, current.functions);
  for (const event of contract.events) adapt(event, current.events);
  // Constants carry values, not wire indexes.
  for (const constant of contract.constants) members.push(constant);

  if (!changed) return contract;

  const adapted = new TypeDef(contract.className, members, contract.annotations);
  adapted.version = contract.version;
  adapted.parentTypeId = contract.parentTypeId;
  adapted.namespace = contract.namespace;
  adapted.usage = contract.usage;
  adapted.description = contract.description;
  adapted.example = contract.example;
  adapted.category = contract.category;
  adapted.since = contract.since;
  return adapted;
}
