using Esiur.Resource;

namespace Esiur.Interop;

// Minimal Esiur resource for the TS↔C# interop test. The source generator turns
// `[Export] int counts;` into a public `Counts` property.
[Resource]
public partial class Hello
{
    [Export] int counts;

    [Export] string label = "Hello from C#";

    [Export]
    public string SayHi(string msg)
    {
        Counts++;
        return "Welcome, " + msg;
    }
}
