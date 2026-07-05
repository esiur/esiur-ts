/** Stored salted password hash and salt for a hosted account. */
export class PasswordHash {
  constructor(
    readonly hash: Uint8Array | null = null,
    readonly salt: Uint8Array | null = null,
  ) {}
}
