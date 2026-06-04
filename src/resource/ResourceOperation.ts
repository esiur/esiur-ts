/** Lifecycle operations dispatched to a resource via `handle` (port of C# `ResourceOperation`). */
export enum ResourceOperation {
  Open = 0,
  Initialize = 1,
  Configure = 2,
  Close = 3,
  Terminate = 4,
  SystemReady = 5,
  SystemReloading = 6,
  SystemReloaded = 7,
  SystemTerminating = 8,
  Save = 9,
  Load = 10,
  Pause = 11,
  Resume = 12,
}
