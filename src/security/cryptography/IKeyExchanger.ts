/** A key-exchange algorithm (port of C# `IKeyExchanger`). */
export interface IKeyExchanger {
  readonly identifier: number;
  getPublicKey(): Uint8Array;
  computeSharedKey(key: Uint8Array): Uint8Array;
}
