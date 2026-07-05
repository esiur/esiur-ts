/** Identity plus raw password bytes returned by a password provider for itself. */
export class IdentityPassword {
  constructor(
    readonly identity: string | null = null,
    readonly password: Uint8Array | null = null,
  ) {}
}
