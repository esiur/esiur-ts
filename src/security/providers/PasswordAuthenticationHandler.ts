import { merge, stringToBytes } from "../../data/DC.js";
import { AuthenticationDirection } from "../AuthenticationDirection.js";
import { AuthenticationResult } from "../AuthenticationResult.js";
import { AuthenticationRuling } from "../AuthenticationRuling.js";
import { AuthenticationMode } from "../AuthenticationMode.js";
import type { IAuthenticationHandler } from "../IAuthenticationHandler.js";
import { sha3 } from "../sha3.js";
import type { PasswordAuthenticationProvider } from "./PasswordAuthenticationProvider.js";

/** Implements Esiur's `"hash"` SHA3 nonce/challenge-response authentication. */
export class PasswordAuthenticationHandler implements IAuthenticationHandler {
  static readonly nonceLength = 20;

  readonly protocol = "hash";
  private readonly localNonce = randomBytes(PasswordAuthenticationHandler.nonceLength);
  private remoteNonce: Uint8Array | null = null;
  private localSalt: Uint8Array | null = null;
  private remoteSalt: Uint8Array | null = null;
  private initiatorPassword: Uint8Array | null = null;
  private responderPassword: Uint8Array | null = null;
  private step = 0;

  constructor(
    private readonly mode: AuthenticationMode,
    private readonly direction: AuthenticationDirection,
    private initiatorIdentity: string | null,
    private responderIdentity: string | null,
    private readonly hostName: string | null,
    private readonly domain: string | null,
    readonly provider: PasswordAuthenticationProvider,
  ) {}

  static computeSha3(data: Uint8Array, bitLength = 256): Uint8Array {
    return sha3(data, bitLength);
  }

  process(authData: unknown): AuthenticationResult {
    try {
      return this.processInternal(authData);
    } catch {
      this.step = -1;
      return failed();
    }
  }

  private processInternal(authData: unknown): AuthenticationResult {
    const remoteAuthData = asAuthArray(authData);
    const localAuthData: unknown[] = [];

    if (this.direction === AuthenticationDirection.Initiator) {
      if (this.mode === AuthenticationMode.InitializerIdentity)
        return this.processInitiatorInitializerIdentity(remoteAuthData, localAuthData);
      if (this.mode === AuthenticationMode.ResponderIdentity)
        return this.processInitiatorResponderIdentity(remoteAuthData, localAuthData);
      if (this.mode === AuthenticationMode.DualIdentity)
        return this.processInitiatorDualIdentity(remoteAuthData, localAuthData);
    } else {
      if (this.mode === AuthenticationMode.InitializerIdentity)
        return this.processResponderInitializerIdentity(remoteAuthData, localAuthData);
      if (this.mode === AuthenticationMode.ResponderIdentity)
        return this.processResponderResponderIdentity(remoteAuthData, localAuthData);
      if (this.mode === AuthenticationMode.DualIdentity)
        return this.processResponderDualIdentity(remoteAuthData, localAuthData);
    }

    this.step = -1;
    return failed();
  }

  private processInitiatorInitializerIdentity(
    remote: unknown[] | null,
    local: unknown[],
  ): AuthenticationResult {
    if (this.step === 0) {
      if (!this.loadInitiatorSelfPassword()) return failed();

      local.push(this.localNonce, this.initiatorIdentity);
      this.step = 1;
      return inProgress(local);
    }

    if (this.step !== 1 || !remote || remote.length < 3) return failed();

    this.remoteNonce = asBytes(remote[0]);
    this.remoteSalt = asBytes(remote[1]);
    const remoteChallenge = asBytes(remote[2]);
    if (!this.validRemoteNonce(this.remoteNonce) || !this.remoteSalt || !remoteChallenge)
      return this.failedAndStop();

    const hashedPassword = sha3(merge(this.initiatorPassword!, this.remoteSalt));
    const expectedRemoteChallenge = sha3(merge(this.remoteNonce, hashedPassword, this.localNonce));
    if (!fixedTimeEquals(remoteChallenge, expectedRemoteChallenge)) return this.failedAndStop();

    const localChallenge = sha3(merge(this.localNonce, hashedPassword, this.remoteNonce));
    local.push(localChallenge);
    const sessionKey = sha3(
      merge(stringToBytes(this.initiatorIdentity!), hashedPassword, this.localNonce, this.remoteNonce),
      512,
    );
    this.step = -1;
    return succeeded(local, this.initiatorIdentity, null, sessionKey);
  }

  private processResponderInitializerIdentity(
    remote: unknown[] | null,
    local: unknown[],
  ): AuthenticationResult {
    if (this.step === 0) {
      if (!remote || remote.length < 2) return failed();

      this.remoteNonce = asBytes(remote[0]);
      this.initiatorIdentity = asString(remote[1]);
      if (!this.validRemoteNonce(this.remoteNonce) || !this.initiatorIdentity)
        return this.failedAndStop();

      const credential = this.provider.getHostedAccountCredential(this.initiatorIdentity, this.domain);
      this.localSalt = credential.salt;
      this.initiatorPassword = credential.hash;
      if (!this.localSalt || !this.initiatorPassword) return failed();

      const localChallenge = sha3(merge(this.localNonce, this.initiatorPassword, this.remoteNonce));
      local.push(this.localNonce, this.localSalt, localChallenge);
      this.step = 1;
      return inProgress(local);
    }

    if (this.step !== 1 || !remote || remote.length < 1) return failed();

    const remoteChallenge = asBytes(remote[0]);
    if (!remoteChallenge || !this.remoteNonce || !this.initiatorPassword) return this.failedAndStop();

    const expectedRemoteChallenge = sha3(
      merge(this.remoteNonce, this.initiatorPassword, this.localNonce),
    );
    if (!fixedTimeEquals(expectedRemoteChallenge, remoteChallenge)) return this.failedAndStop();

    const sessionKey = sha3(
      merge(stringToBytes(this.initiatorIdentity!), this.initiatorPassword, this.remoteNonce, this.localNonce),
      512,
    );
    this.step = -1;
    return succeeded(null, this.initiatorIdentity, this.responderIdentity, sessionKey);
  }

  private processInitiatorResponderIdentity(
    remote: unknown[] | null,
    local: unknown[],
  ): AuthenticationResult {
    if (this.step === 0) {
      local.push(this.localNonce);
      this.step = 1;
      return inProgress(local);
    }

    if (this.step === 1) {
      if (!remote || remote.length < 2) return failed();

      this.remoteNonce = asBytes(remote[0]);
      this.responderIdentity = asString(remote[1]);
      if (!this.validRemoteNonce(this.remoteNonce) || !this.responderIdentity)
        return this.failedAndStop();

      const credential = this.provider.getHostedAccountCredential(this.responderIdentity, this.domain);
      this.localSalt = credential.salt;
      this.responderPassword = credential.hash;
      if (!this.localSalt || !this.responderPassword) return this.failedAndStop();

      const localChallenge = sha3(merge(this.localNonce, this.responderPassword, this.remoteNonce));
      local.push(this.localSalt, localChallenge);
      this.step = 2;
      return inProgress(local);
    }

    if (this.step !== 2 || !remote || remote.length < 1) return failed();

    const remoteChallenge = asBytes(remote[0]);
    if (!remoteChallenge || !this.remoteNonce || !this.responderPassword)
      return this.failedAndStop();

    const expectedRemoteChallenge = sha3(
      merge(this.remoteNonce, this.responderPassword, this.localNonce),
    );
    if (!fixedTimeEquals(remoteChallenge, expectedRemoteChallenge)) return this.failedAndStop();

    const sessionKey = sha3(
      merge(stringToBytes(this.responderIdentity!), this.responderPassword, this.localNonce, this.remoteNonce),
      512,
    );
    this.step = -1;
    return succeeded(null, this.initiatorIdentity, this.responderIdentity, sessionKey);
  }

  private processResponderResponderIdentity(
    remote: unknown[] | null,
    local: unknown[],
  ): AuthenticationResult {
    if (this.step === 0) {
      if (!remote || remote.length < 1) return failed();

      this.remoteNonce = asBytes(remote[0]);
      if (!this.validRemoteNonce(this.remoteNonce)) return this.failedAndStop();
      if (!this.loadResponderSelfPassword()) return failed();

      local.push(this.localNonce, this.responderIdentity);
      this.step = 1;
      return inProgress(local);
    }

    if (this.step !== 1 || !remote || remote.length < 2) return failed();

    this.remoteSalt = asBytes(remote[0]);
    const remoteChallenge = asBytes(remote[1]);
    if (!this.remoteSalt || !remoteChallenge || !this.remoteNonce || !this.responderPassword)
      return this.failedAndStop();

    const hashedPassword = sha3(merge(this.responderPassword, this.remoteSalt));
    const expectedRemoteChallenge = sha3(merge(this.remoteNonce, hashedPassword, this.localNonce));
    if (!fixedTimeEquals(expectedRemoteChallenge, remoteChallenge)) return this.failedAndStop();

    const localChallenge = sha3(merge(this.localNonce, hashedPassword, this.remoteNonce));
    const sessionKey = sha3(
      merge(stringToBytes(this.responderIdentity!), hashedPassword, this.remoteNonce, this.localNonce),
      512,
    );
    local.push(localChallenge);
    this.step = -1;
    return succeeded(local, this.responderIdentity, null, sessionKey);
  }

  private processInitiatorDualIdentity(
    remote: unknown[] | null,
    local: unknown[],
  ): AuthenticationResult {
    if (this.step === 0) {
      if (!this.loadInitiatorSelfPassword()) return failed();
      local.push(this.localNonce, this.initiatorIdentity);
      this.step = 1;
      return inProgress(local);
    }

    if (this.step === 1) {
      if (!remote || remote.length < 3) return failed();

      this.remoteNonce = asBytes(remote[0]);
      const parsed = parseDualResponderStep(remote);
      this.responderIdentity = parsed.responderIdentity;
      this.remoteSalt = parsed.salt;
      if (!this.validRemoteNonce(this.remoteNonce) || !this.responderIdentity || !this.remoteSalt)
        return this.failedAndStop();

      const responderCredential = this.provider.getHostedAccountCredential(
        this.responderIdentity,
        this.domain,
      );
      this.localSalt = responderCredential.salt;
      this.responderPassword = responderCredential.hash;
      if (!this.localSalt || !this.responderPassword) return this.failedAndStop();

      const hashedPassword = sha3(merge(this.initiatorPassword!, this.remoteSalt));
      const localChallenge = sha3(
        merge(this.localNonce, hashedPassword, this.responderPassword, this.remoteNonce),
      );
      local.push(this.localSalt, localChallenge);
      this.step = 2;
      return inProgress(local);
    }

    if (this.step !== 2 || !remote || remote.length < 1) return failed();

    const remoteChallenge = asBytes(remote[0]);
    if (!remoteChallenge || !this.remoteNonce || !this.remoteSalt || !this.responderPassword)
      return this.failedAndStop();

    const hashedPassword = sha3(merge(this.initiatorPassword!, this.remoteSalt));
    const expectedRemoteChallenge = sha3(
      merge(this.remoteNonce, this.responderPassword, hashedPassword, this.localNonce),
    );
    if (!fixedTimeEquals(remoteChallenge, expectedRemoteChallenge)) return this.failedAndStop();

    const sessionKey = sha3(
      merge(
        stringToBytes(this.initiatorIdentity!),
        stringToBytes(this.responderIdentity!),
        hashedPassword,
        this.responderPassword,
        this.localNonce,
        this.remoteNonce,
      ),
      512,
    );
    this.step = -1;
    return succeeded(null, this.initiatorIdentity, this.responderIdentity, sessionKey);
  }

  private processResponderDualIdentity(
    remote: unknown[] | null,
    local: unknown[],
  ): AuthenticationResult {
    if (this.step === 0) {
      if (!remote || remote.length < 2) return failed();

      this.remoteNonce = asBytes(remote[0]);
      this.initiatorIdentity = asString(remote[1]);
      if (!this.validRemoteNonce(this.remoteNonce) || !this.initiatorIdentity)
        return this.failedAndStop();
      if (!this.loadResponderSelfPassword()) return failed();

      const initiatorCredential = this.provider.getHostedAccountCredential(
        this.initiatorIdentity,
        this.domain,
      );
      this.localSalt = initiatorCredential.salt;
      this.initiatorPassword = initiatorCredential.hash;
      if (!this.localSalt || !this.initiatorPassword) return failed();

      local.push(this.localNonce, this.responderIdentity, this.localSalt);
      this.step = 1;
      return inProgress(local);
    }

    if (this.step !== 1 || !remote || remote.length < 2) return failed();

    const remoteSalt = asBytes(remote[0]);
    const remoteChallenge = asBytes(remote[1]);
    if (!remoteSalt || !remoteChallenge || !this.remoteNonce || !this.initiatorPassword)
      return this.failedAndStop();

    const hashedPassword = sha3(merge(this.responderPassword!, remoteSalt));
    const expectedRemoteChallenge = sha3(
      merge(this.remoteNonce, this.initiatorPassword, hashedPassword, this.localNonce),
    );
    if (!fixedTimeEquals(expectedRemoteChallenge, remoteChallenge)) return this.failedAndStop();

    const localChallenge = sha3(
      merge(this.localNonce, hashedPassword, this.initiatorPassword, this.remoteNonce),
    );
    const sessionKey = sha3(
      merge(
        stringToBytes(this.initiatorIdentity!),
        stringToBytes(this.responderIdentity!),
        this.initiatorPassword,
        hashedPassword,
        this.remoteNonce,
        this.localNonce,
      ),
      512,
    );
    local.push(localChallenge);
    this.step = -1;
    return succeeded(local, this.initiatorIdentity, this.responderIdentity, sessionKey);
  }

  private loadInitiatorSelfPassword(): boolean {
    if (this.initiatorIdentity == null) {
      const identityPassword = this.provider.getSelfIdentityAndCredential(this.domain, this.hostName);
      this.initiatorIdentity = identityPassword.identity;
      this.initiatorPassword = identityPassword.password;
    } else {
      this.initiatorPassword = this.provider.getSelfCredential(
        this.initiatorIdentity,
        this.domain,
        this.hostName,
      );
    }
    return this.initiatorIdentity != null && this.initiatorPassword != null;
  }

  private loadResponderSelfPassword(): boolean {
    if (this.responderIdentity == null) {
      const identityPassword = this.provider.getSelfIdentityAndCredential(this.domain, this.hostName);
      this.responderIdentity = identityPassword.identity;
      this.responderPassword = identityPassword.password;
    } else {
      this.responderPassword = this.provider.getSelfCredential(
        this.responderIdentity,
        this.domain,
        this.hostName,
      );
    }
    return this.responderIdentity != null && this.responderPassword != null;
  }

  private validRemoteNonce(remoteNonce: Uint8Array | null): remoteNonce is Uint8Array {
    return (
      remoteNonce != null &&
      remoteNonce.length === PasswordAuthenticationHandler.nonceLength &&
      !fixedTimeEquals(remoteNonce, this.localNonce)
    );
  }

  private failedAndStop(): AuthenticationResult {
    this.step = -1;
    return failed();
  }
}

function asAuthArray(value: unknown): unknown[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  throw new TypeError("Authentication data must be an array.");
}

function asBytes(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseDualResponderStep(remote: unknown[]): {
  responderIdentity: string | null;
  salt: Uint8Array | null;
} {
  if (typeof remote[1] === "string")
    return { responderIdentity: remote[1], salt: asBytes(remote[2]) };
  if (typeof remote[2] === "string")
    return { responderIdentity: remote[2], salt: asBytes(remote[1]) };
  return { responderIdentity: null, salt: null };
}

function fixedTimeEquals(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const crypto = globalThis.crypto as
    | { getRandomValues?: (target: Uint8Array) => Uint8Array }
    | undefined;
  if (!crypto?.getRandomValues)
    throw new Error("Secure random bytes are unavailable in this environment.");
  crypto.getRandomValues(out);
  return out;
}

function failed(): AuthenticationResult {
  return new AuthenticationResult(AuthenticationRuling.Failed, null);
}

function inProgress(data: unknown[]): AuthenticationResult {
  return new AuthenticationResult(AuthenticationRuling.InProgress, data);
}

function succeeded(
  data: unknown[] | null,
  localIdentity: string | null,
  remoteIdentity: string | null,
  sessionKey: Uint8Array,
): AuthenticationResult {
  return new AuthenticationResult(
    AuthenticationRuling.Succeeded,
    data,
    localIdentity,
    remoteIdentity,
    sessionKey,
  );
}
