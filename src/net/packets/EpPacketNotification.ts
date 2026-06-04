/** Notification actions, in the low 5 bits of the header (port of C# `EpPacketNotification`). */
export enum EpPacketNotification {
  // Invoke
  PropertyModified = 0x0,
  EventOccurred = 0x1,
  // Manage
  ResourceDestroyed = 0x8,
  ResourceReassigned = 0x9,
  ResourceMoved = 0xa,
  SystemFailure = 0xb,
}
