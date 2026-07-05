import { PlainTdu } from "../../data/PlainTdu.js";
import { TduClass } from "../../data/TduClass.js";
import { merge } from "../../data/DC.js";
import { EpAuthPacketCommand } from "./EpAuthPacketCommand.js";
import { EpAuthPacketMethod } from "./EpAuthPacketMethod.js";
import { AuthenticationMode } from "../../security/AuthenticationMode.js";
import { EncryptionMode } from "../../security/EncryptionMode.js";

/**
 * Authentication-phase packet (port of C# `EpAuthPacket`).
 *
 * Header byte: `[command:2][hasTDU:1][…]`. For Initialize the low bits carry
 * `authMode<<2 | encryptionMode`; for the other commands they carry the
 * {@link EpAuthPacketMethod} (whose own top bits repeat the command). An
 * optional TDU follows — typically a `TypedMap<u8, dynamic>` of headers.
 */
export class EpAuthPacket {
  command: EpAuthPacketCommand = EpAuthPacketCommand.Initialize;
  method: EpAuthPacketMethod = EpAuthPacketMethod.Initialize;
  authMode: AuthenticationMode = AuthenticationMode.None;
  encryptionMode: EncryptionMode = EncryptionMode.None;
  hasTdu = false;
  tdu: PlainTdu | null = null;

  private dataLengthNeeded = 0;

  private notEnough(offset: number, ends: number, needed: number): boolean {
    if (offset + needed > ends) {
      this.dataLengthNeeded = needed - (ends - offset);
      return true;
    }
    return false;
  }

  /** Parse an auth packet; returns bytes consumed or `-bytesNeeded`. */
  parse(data: Uint8Array, offset: number, ends: number): number {
    this.tdu = null;
    const start = offset;

    if (this.notEnough(offset, ends, 1)) return -this.dataLengthNeeded;

    const b = data[offset];
    this.command = (b >> 6) as EpAuthPacketCommand;
    this.hasTdu = (b & 0x20) !== 0;

    if (this.command === EpAuthPacketCommand.Initialize) {
      this.authMode = ((b >> 2) & 0x3) as AuthenticationMode;
      this.encryptionMode = (b & 0x3) as EncryptionMode;
    } else {
      this.method = (b & 0xdf) as EpAuthPacketMethod;
    }
    offset++;

    if (this.hasTdu) {
      if (this.notEnough(offset, ends, 1)) return -this.dataLengthNeeded;
      this.tdu = PlainTdu.parse(data, offset, ends);
      if (this.tdu.tduClass === TduClass.Invalid) return -this.tdu.totalLength;
      offset += this.tdu.totalLength;
    }

    return offset - start;
  }

  // ---- compose helpers --------------------------------------------------------

  /** Build an Initialize packet (`authMode`/`encryptionMode` in the low bits). */
  static composeInitialize(
    authMode: AuthenticationMode,
    encryptionMode: EncryptionMode,
    headersTdu?: Uint8Array,
  ): Uint8Array {
    const header =
      ((EpAuthPacketCommand.Initialize << 6) |
        (headersTdu ? 0x20 : 0) |
        ((authMode & 0x3) << 2) |
        (encryptionMode & 0x3)) &
      0xff;
    return headersTdu ? merge(Uint8Array.of(header), headersTdu) : Uint8Array.of(header);
  }

  /** Build a non-Initialize packet from a method (whose top bits carry the command). */
  static composeMethod(method: EpAuthPacketMethod, headersTdu?: Uint8Array): Uint8Array {
    const header = (method | (headersTdu ? 0x20 : 0)) & 0xff;
    return headersTdu ? merge(Uint8Array.of(header), headersTdu) : Uint8Array.of(header);
  }
}
