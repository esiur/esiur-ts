using Esiur.Interop;
using Esiur.Protocol;
using Esiur.Resource;
using Esiur.Stores;

// A standalone Esiur (C#) server for the TypeScript interop test. The EpServer
// listens on TCP 10518 and also accepts WebSocket clients via HTTP upgrade.
// AllowUnauthorizedAccess lets the TS client complete the anonymous handshake.
var wh = new Warehouse();
await wh.Put("sys", new MemoryStore());
await wh.Put("sys/server", new EpServer() { AllowUnauthorizedAccess = true, Port = 10518 });
await wh.Put("sys/hello", new Hello());
await wh.Open();

Console.WriteLine("ESIUR-INTEROP-READY 10518");

await Task.Delay(-1);
