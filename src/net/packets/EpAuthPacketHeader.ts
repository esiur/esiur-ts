/** Header keys carried in an auth packet's TypedMap (port of C# `EpAuthPacketHeader`). */
export enum EpAuthPacketHeader {
  Version = 0,
  Domain = 1,
  SupportedAuthentications = 2,
  SupportedHashAlgorithms = 3,
  SupportedCiphers = 4,
  SupportedCompression = 5,
  SupportedMultiFactorAuthentications = 6,
  CipherType = 7,
  CipherKey = 8,
  SoftwareIdentity = 9,
  Referrer = 10,
  Time = 11,
  IPAddress = 12,
  Identity = 13,
  AuthenticationProtocol = 14,
  AuthenticationData = 15,
  ErrorMessage = 16,
  /** Fresh public nonce used with the authenticated session key to derive unique per-connection encryption keys. */
  CipherNonce = 17,
  /** Maximum declared TDU payload accepted by this peer. */
  MaximumPacketSize = 18,
  /** Maximum allocation produced by one decoded value at this peer. */
  MaximumAllocationSize = 19,
  /** Maximum number of decoded values in one collection at this peer. */
  MaximumCollectionItems = 20,
  /** Maximum recursive TRU metadata depth accepted by this peer. */
  MaximumTypeMetadataDepth = 21,
  /** Maximum protected encryption-record size accepted by this peer. */
  MaximumEncryptedRecordSize = 22,
}
