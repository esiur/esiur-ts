using Esiur.Resource;
using Esiur.Data.Types;

namespace Esiur.Interop;

// Minimal Esiur resource for the TS↔C# interop test. The source generator turns
// `[Export] int counts;` into a public `Counts` property.
[Resource]
[Usage("Exercises the complete cross-runtime TypeDef contract.")]
[Description("Interop resource metadata fixture")]
[Example("sys/hello")]
[Category("Conformance")]
[Since("3.1")]
public partial class Hello
{
    [Export, Historical, ReadOnly]
    [Description("Number of calls handled")]
    [Usage("Display the interop activity count")]
    [Example(7)]
    [Tags("interop", "counter")]
    [Unit("calls")]
    [Minimum(0)]
    [Maximum(1000000)]
    [AllowedValue(0)]
    [AllowedValue(1)]
    [Pattern("^[0-9]+$")]
    [Format("N0")]
    [Warning("Resets when the test process exits")]
    [RelatedMembers(0)]
    [Obsolete("Use the audit journal for durable totals")]
    [System.ComponentModel.DefaultValue(0)]
    int counts;

    [Export] string label = "Hello from C#";

    [Export]
    public IResource EchoResource(IResource resource)
    {
        return resource;
    }

    [Export]
    [ReadOnly]
    [Idempotent]
    [Cancellable]
    [Description("Returns a greeting")]
    [Usage("Validate a request/reply invocation")]
    [Example("Ahmed")]
    [Tags("interop", "function")]
    [Format("text")]
    [Precondition("The connection is authenticated")]
    [Postcondition("A greeting is returned")]
    [Effects(OperationEffects.External)]
    [Warning("Only intended for protocol conformance")]
    [RelatedMembers(0)]
    [Obsolete("Use a production greeting service")]
    public string SayHi(string msg)
    {
        Counts++;
        return "Welcome, " + msg;
    }

    [Export, Historical]
    [Description("Raised after an interop ping")]
    [Usage("Replay and subscribe to ping events")]
    [Example("online")]
    [Tags("interop", "event")]
    [Unit("message")]
    [Format("text")]
    [Warning("Test event")]
    [RelatedMembers(0)]
    [Ordering(Esiur.Data.OrderingControl.LatestOnly)]
    [Obsolete("Use a production event channel")]
    public event ResourceEventHandler<string>? Ping;

    [Export]
    public void FirePing(string message)
    {
        Counts++;
        Ping?.Invoke(message);
    }
}
