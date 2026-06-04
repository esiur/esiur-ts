/** Top 2 bits of an Ep packet header — the packet method (port of C# `EpPacketMethod`). */
export enum EpPacketMethod {
  Notification = 0,
  Request = 1,
  Reply = 2,
  Extension = 3,
}
