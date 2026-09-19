using System.Text.Json;
using Esiur.Data;
using Esiur.Data.Types;
using Esiur.Resource;

namespace Esiur.Interop;

/// <summary>
/// A deliberately dense resource graph shaped like a Delta Flow workspace.
/// Blocks have shared references, cycles, dynamic configuration/state values,
/// and live property changes while the control resource serves revisions.
/// </summary>
[Resource]
public partial class FlowGraphBlock
{
    [Export] public int BlockId { get; set; }
    [Export] public int FlowId { get; set; }
    [Export] public string Name { get; set; } = "";
    [Export] public string Kind { get; set; } = "node";
    [Export] public FlowGraphBlock? Parent { get; set; }
    [Export] public FlowGraphBlock[] Inputs { get; set; } = [];
    [Export] public FlowGraphBlock[] Outputs { get; set; } = [];
    [Export] public IResource[] Related { get; set; } = [];
    [Export] public Map<string, object> Configuration { get; set; } = new();
    [Export] public object[] LiveState { get; set; } = [];
    [Export] public int StateVersion { get; set; }
}

[Export]
public class FlowGraphSnapshot : IRecord
{
    public int FlowId { get; set; }
    public int Revision { get; set; }
    public string Name { get; set; } = "";
    public int[] BlockIds { get; set; } = [];
    public Map<string, object> Metadata { get; set; } = new();
}

/// <summary>
/// Control-plane fixture used by the TypeScript client regression test. The
/// string-returning method mirrors Delta Flow's GetFlowRevision contract while
/// GetFlowSnapshot exercises record/collection decoding over the same session.
/// </summary>
[Resource]
public partial class FlowGraphWorkspace
{
    private readonly Dictionary<int, FlowGraphBlock[]> flows;
    private int sequence;

    public FlowGraphWorkspace(Dictionary<int, FlowGraphBlock[]> flows)
    {
        this.flows = flows;
    }

    [Export] public FlowGraphBlock[] Roots { get; set; } = [];

    [Export, ReadOnly, Idempotent]
    public string GetFlowRevision(int flowId)
    {
        if (!flows.TryGetValue(flowId, out var blocks))
            throw new KeyNotFoundException($"Flow {flowId} was not found.");

        var revision = Interlocked.Increment(ref sequence);
        return JsonSerializer.Serialize(new
        {
            flowId,
            revision,
            name = $"Flow {flowId}",
            blocks = blocks.Select(block => new
            {
                id = block.BlockId,
                block.Name,
                block.Kind,
                inputIds = block.Inputs.Select(input => input.BlockId).ToArray(),
                outputIds = block.Outputs.Select(output => output.BlockId).ToArray(),
            }).ToArray(),
        });
    }

    [Export, ReadOnly, Idempotent]
    public FlowGraphSnapshot GetFlowSnapshot(int flowId)
    {
        if (!flows.TryGetValue(flowId, out var blocks))
            throw new KeyNotFoundException($"Flow {flowId} was not found.");

        return new FlowGraphSnapshot
        {
            FlowId = flowId,
            Revision = Interlocked.Increment(ref sequence),
            Name = $"Flow {flowId}",
            BlockIds = blocks.Select(block => block.BlockId).ToArray(),
            Metadata = new Map<string, object>
            {
                ["blockCount"] = blocks.Length,
                ["active"] = true,
                ["loadedAt"] = DateTime.UtcNow,
            },
        };
    }

    [Export]
    public void Pulse(int seed)
    {
        foreach (var block in flows.Values.SelectMany(blocks => blocks))
        {
            block.StateVersion++;
            block.LiveState =
            [
                seed,
                block.StateVersion,
                DateTime.UtcNow,
                new Map<string, object>
                {
                    ["online"] = true,
                    ["value"] = seed + block.BlockId / 10.0,
                },
            ];
        }
    }
}

public static class FlowGraphFixture
{
    public const int FlowCount = 3;
    public const int BlocksPerFlow = 24;

    public static (FlowGraphWorkspace Workspace, FlowGraphBlock[] Blocks) Create()
    {
        var all = new List<FlowGraphBlock>();
        var flows = new Dictionary<int, FlowGraphBlock[]>();

        for (var flowId = 1; flowId <= FlowCount; flowId++)
        {
            var blocks = Enumerable.Range(0, BlocksPerFlow)
                .Select(index => new FlowGraphBlock
                {
                    BlockId = flowId * 1000 + index,
                    FlowId = flowId,
                    Name = $"flow-{flowId}-block-{index}",
                    Kind = (index % 5) switch
                    {
                        0 => "trigger",
                        1 => "transport",
                        2 => "protocol",
                        3 => "transform",
                        _ => "output",
                    },
                    Configuration = new Map<string, object>
                    {
                        ["index"] = index,
                        ["enabled"] = true,
                        ["labels"] = new[] { $"flow-{flowId}", $"block-{index}" },
                        ["thresholds"] = new object[] { index / 10.0, null!, index * 100L },
                    },
                    LiveState = new object[] { "waiting", index, DateTime.UtcNow },
                })
                .ToArray();

            // A ring gives every flow a cycle. The extra two-step and shared
            // references make several attachment chains converge on the same
            // pending resources, matching a real workspace graph.
            for (var index = 0; index < blocks.Length; index++)
            {
                var previous = blocks[(index + blocks.Length - 1) % blocks.Length];
                var next = blocks[(index + 1) % blocks.Length];
                var nextNext = blocks[(index + 2) % blocks.Length];
                blocks[index].Parent = blocks[0];
                blocks[index].Inputs = [previous];
                blocks[index].Outputs = [next, nextNext];
                blocks[index].Related = [blocks[0], blocks[blocks.Length / 2], next];
            }

            flows[flowId] = blocks;
            all.AddRange(blocks);
        }

        // Cross-flow shared references exercise simultaneous attachment chains
        // created by rapid workspace switching.
        for (var flowId = 1; flowId <= FlowCount; flowId++)
        {
            var current = flows[flowId];
            var next = flows[flowId == FlowCount ? 1 : flowId + 1];
            current[0].Related = [.. current[0].Related, next[0], next[1]];
            current[1].Related = [.. current[1].Related, next[0]];
        }

        return (
            new FlowGraphWorkspace(flows)
            {
                Roots = flows.OrderBy(pair => pair.Key).Select(pair => pair.Value[0]).ToArray(),
            },
            all.ToArray()
        );
    }
}
