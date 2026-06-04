/** Top 2 bits of an auth packet header — the command (port of C# `EpAuthPacketCommand`). */
export enum EpAuthPacketCommand {
  Initialize = 0x0,
  Acknowledge = 0x1,
  Action = 0x2,
  Event = 0x3,
}
