import type { EpAuthPacketHeader } from "../net/packets/EpAuthPacketHeader.js";
import type { AuthenticationMode } from "./AuthenticationMode.js";
import type { EncryptionMode } from "./EncryptionMode.js";
import type { IEncryptionProvider } from "./cryptography/IEncryptionProvider.js";
import type { ISymetricCipher } from "./cryptography/ISymetricCipher.js";

/** Authenticated session metadata exposed to provider login/logout hooks. */
export interface AuthenticationSession {
  authenticationMode: AuthenticationMode;
  localHeaders: Map<EpAuthPacketHeader, unknown>;
  remoteHeaders: Map<EpAuthPacketHeader, unknown>;
  localIdentity: string | null;
  remoteIdentity: string | null;
  key: Uint8Array | null;
  authenticated: boolean;
  variables: Map<string, unknown>;
  /** Negotiated transport encryption mode. */
  encryptionMode: EncryptionMode;
  /** The negotiated {@link IEncryptionProvider}, once selected during the handshake. */
  encryptionProvider: IEncryptionProvider | null;
  /** The session's record cipher, once {@link encryptionProvider} has derived it. */
  symetricCipher: ISymetricCipher | null;
  /** True once outbound/inbound records are actually being protected. */
  encryptionActive: boolean;
}
