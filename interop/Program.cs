using Esiur.Interop;
using Esiur.Protocol;
using Esiur.Resource;
using Esiur.Stores;

// A standalone Esiur (C#) server for the TypeScript interop test. The caller
// supplies the port, and the server also accepts WebSocket clients via HTTP upgrade.
// AllowUnauthorizedAccess lets the TS client complete the anonymous handshake.
if (!ushort.TryParse(Environment.GetEnvironmentVariable("ESIUR_INTEROP_PORT"), out var port)
    || port == 0)
    throw new InvalidOperationException("Set ESIUR_INTEROP_PORT to an available port.");

var wh = new Warehouse();
await wh.Put("sys", new MemoryStore());
await wh.Put("sys/server", new EpServer() { AllowUnauthorizedAccess = true, Port = port });
await wh.Put("sys/hello", new Hello());
await wh.Open();

Console.WriteLine($"ESIUR-INTEROP-READY {port}");

await Task.Delay(-1);
