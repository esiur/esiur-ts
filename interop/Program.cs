using Esiur.Interop;
using Esiur.Protocol;
using Esiur.Resource;
using Esiur.Stores;
using Esiur.Data;
using Esiur.Data.Types;

var clientEndpoint = Environment.GetEnvironmentVariable("ESIUR_INTEROP_CLIENT_ENDPOINT");
if (!string.IsNullOrWhiteSpace(clientEndpoint))
{
    var uri = new Uri(clientEndpoint);
    var clientWarehouse = new Warehouse();
    var context = new EpConnectionContext
    {
        AutoReconnect = false,
        WebSocketUri = uri,
    };
    Console.WriteLine($"ESIUR-DOTNET-CLIENT-CONNECTING {uri}");
    var connection = await clientWarehouse.Get<EpConnection>($"ep://{uri.Authority}", context);
    if (connection is null)
        throw new InvalidOperationException("The dotnet client could not connect to esiur-ts.");

    Console.WriteLine("ESIUR-DOTNET-CLIENT-QUERYING sys/parent");
    var children = await connection.Query("sys/parent");
    if (children.Length != 1 || (children[0] as EpResource)?.ResourceLink != "sys/parent/kid")
        throw new InvalidOperationException("The dotnet client did not auto-attach the queried TS child.");

    Console.WriteLine($"ESIUR-DOTNET-CLIENT-OK {(children[0] as EpResource).ResourceLink}");

    var metadataResource = await connection.Get("sys/metadata") as EpResource
        ?? throw new InvalidOperationException("The TypeScript metadata resource was not attached.");
    var definition = metadataResource.ResourceDefinition;
    if (definition.Name != "Interop.TypeScript.MetadataResource"
        || definition.Version != 6
        || definition.Usage != "Validate TypeScript hosted metadata"
        || definition.Description != "TS TypeDef fixture"
        || definition.Example?.ToString() != "sys/metadata"
        || definition.Category != "Conformance"
        || definition.Since != "3.1")
        throw new InvalidOperationException("The TypeScript TypeDef metadata did not survive the wire.");

    var property = definition.Properties.Single(x => x.Name == "value");
    if (!property.ReadOnly || !property.Historical || !property.Deprecated
        || property.DeprecationMessage != "Use currentValue"
        || property.Description != "Current test value"
        || property.Usage != "Read this value"
        || property.Unit != "items"
        || Convert.ToInt32(property.Minimum) != 0
        || Convert.ToInt32(property.Maximum) != 10
        || property.Pattern != "^[0-9]+$"
        || property.Format != "N0"
        || property.OrderingControl != OrderingControl.LatestOnly
        || Convert.ToInt32(property.DefaultValue) != 7)
        throw new InvalidOperationException("The TypeScript property metadata did not survive the wire.");

    var function = definition.Functions.Single(x => x.Name == "echo");
    if (!function.ReadOnly || !function.Idempotent || !function.Cancellable
        || !function.Deprecated || function.DeprecationMessage != "Use echoV2"
        || function.Description != "Echo a message"
        || function.Effects != OperationEffects.External
        || function.Arguments.Length != 1
        || !function.Arguments[0].Optional
        || function.Arguments[0].DefaultValue?.ToString() != "hello")
        throw new InvalidOperationException("The TypeScript function metadata did not survive the wire.");

    var eventDefinition = definition.Events.Single(x => x.Name == "changed");
    if (!eventDefinition.AutoDelivered || !eventDefinition.Historical
        || !eventDefinition.Deprecated || eventDefinition.Description != "Value changed"
        || eventDefinition.OrderingControl != OrderingControl.Relaxed)
        throw new InvalidOperationException("The TypeScript event metadata did not survive the wire.");

    Console.WriteLine($"ESIUR-DOTNET-TYPEDEF-OK {definition.Name}");
    connection.Destroy();
    await clientWarehouse.Close();
    return;
}

// A standalone Esiur (C#) server for the TypeScript interop test. It uses the
// Esiur default port unless the caller supplies an isolated test port.
// AllowUnauthorizedAccess lets the TS client complete the anonymous handshake.
var configuredPort = Environment.GetEnvironmentVariable("ESIUR_INTEROP_PORT");
var server = new EpServer { AllowUnauthorizedAccess = true };
if (!string.IsNullOrWhiteSpace(configuredPort))
{
    if (!ushort.TryParse(configuredPort, out var port) || port == 0)
        throw new InvalidOperationException("ESIUR_INTEROP_PORT must be from 1 through 65535.");
    server.Port = port;
}

var wh = new Warehouse();
await wh.Put("sys", new MemoryStore());
await wh.Put("sys/server", server);
await wh.Put("sys/hello", new Hello());
await wh.Put("sys/hello/kid", new Hello());
var flowGraph = FlowGraphFixture.Create();
await wh.Put("sys/workspace", flowGraph.Workspace);
foreach (var block in flowGraph.Blocks)
    await wh.Put($"sys/workspace/flows/{block.FlowId}/blocks/{block.BlockId}", block);
await wh.Open();

Console.WriteLine($"ESIUR-INTEROP-READY {server.Port}");

await Task.Delay(-1);
