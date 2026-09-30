import { describe, expect, it } from "vitest";
import { computeNodeRisks, findSuspiciousPaths } from "@/lib/path";
import { buildGraph } from "@/lib/graph";
import { loadHeuristicsConfig } from "@/lib/config";
import { A, makeGraph, makeTransfer, makeTx } from "./helpers";
import type { GraphEdge, GraphNode } from "@/lib/types";

const params = loadHeuristicsConfig().params;
const T = A(1);

function edge(from: string, to: string, n: number): GraphEdge {
  return { from, to, value: "1", token: null, txHash: `0x${n}`, timestamp: "", blockNumber: 1, logIndex: 0 };
}

describe("computeNodeRisks", () => {
  const base = { target: T, headBlock: 2_000_000, approvals: [], params };

  it("excludes the target and scores scam nodes at 1", () => {
    const graph = makeGraph(
      [{ id: T, isTarget: true }, { id: A(2), isScam: true }, { id: A(3) }],
      [edge(T, A(2), 1), edge(T, A(3), 2)],
    );
    const risks = computeNodeRisks({ ...base, graph });
    expect(risks.find((r) => r.id === T)).toBeUndefined();
    const scam = risks.find((r) => r.id === A(2))!;
    expect(scam.risk).toBe(1);
    expect(scam.signals.join(" ")).toContain("scam");
  });

  it("flags fresh counterparties", () => {
    const graph = makeGraph(
      [
        { id: T, isTarget: true, firstSeenBlock: 1_000_000 },
        { id: A(2), firstSeenBlock: 1_999_000 }, // 1000 blocks ago
      ],
      [edge(T, A(2), 1)],
    );
    const risks = computeNodeRisks({ ...base, graph });
    const r = risks.find((x) => x.id === A(2))!;
    expect(r.risk).toBeGreaterThan(0.9);
    expect(r.signals.some((s) => s.includes("blocks ago"))).toBe(true);
  });

  it("flags one-sided flows and shared deployers and unlimited approvals", () => {
    const funnel = A(5);
    const edges: GraphEdge[] = [];
    let n = 10;
    for (let i = 0; i < 7; i++) edges.push(edge(A(20 + i), funnel, n++));
    edges.push(edge(funnel, A(30), n++));
    const graph = makeGraph(
      [
        { id: T, isTarget: true, firstSeenBlock: 1 },
        { id: funnel, firstSeenBlock: 1 },
        { id: A(6), firstSeenBlock: 1, creator: A(77) },
        { id: A(7), firstSeenBlock: 1, creator: A(77) },
        { id: A(8), firstSeenBlock: 1 },
      ],
      edges,
    );
    const approvals = [
      { owner: A(8), spender: A(9), amountHex: "0x" + "f".repeat(64), unlimited: true, txHash: "0x1" },
    ];
    const risks = computeNodeRisks({ ...base, graph, approvals });
    expect(risks.find((r) => r.id === funnel)!.signals.some((s) => s.includes("asymmetry"))).toBe(true);
    expect(risks.find((r) => r.id === A(6))!.signals.some((s) => s.includes("deployer"))).toBe(true);
    expect(risks.find((r) => r.id === A(8))!.signals.some((s) => s.includes("unlimited"))).toBe(true);
  });

  it("keeps calm nodes below the seed threshold", () => {
    const graph = makeGraph(
      [
        { id: T, isTarget: true, firstSeenBlock: 1 },
        { id: A(2), firstSeenBlock: 1 }, // very old
      ],
      [edge(T, A(2), 1)],
    );
    const risks = computeNodeRisks({ ...base, graph });
    expect(risks.find((r) => r.id === A(2))!.risk).toBeLessThan(0.5);
  });
});

describe("findSuspiciousPaths", () => {
  it("finds the shortest forward path to a high-risk seed", () => {
    const graph = makeGraph(
      [
        { id: T, isTarget: true },
        { id: A(2) },
        { id: A(3) },
        { id: A(4) },
      ],
      [edge(T, A(2), 1), edge(A(2), A(4), 2), edge(T, A(3), 3)],
    );
    const risks = [
      { id: A(2), risk: 0.6, signals: ["first seen only 10 blocks ago"] },
      { id: A(3), risk: 0.1, signals: [] },
      { id: A(4), risk: 0.95, signals: ["flagged as scam by the explorer"] },
    ];
    const { paths, nodeRisks } = findSuspiciousPaths(graph, T, risks);
    expect(paths.length).toBe(2);
    expect(paths[0].nodes).toEqual([T, A(2), A(4)]);
    expect(paths[0].reason).toContain("scam");
    expect(paths[1].nodes).toEqual([T, A(2)]);
    expect(paths[1].risk).toBe(0.6);
    expect(nodeRisks[A(4)]).toBe(0.95);
    expect(nodeRisks[T]).toBeUndefined();
  });

  it("falls back to reverse flow when the seed only points at the target", () => {
    const graph = makeGraph([{ id: T, isTarget: true }, { id: A(2) }], [edge(A(2), T, 1)]);
    const risks = [{ id: A(2), risk: 0.8, signals: ["one-sided flow (in/out asymmetry 0.80)"] }];
    const { paths } = findSuspiciousPaths(graph, T, risks);
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual([A(2), T]);
    expect(paths[0].reason).toContain("toward the analyzed address");
  });

  it("returns no paths when nothing crosses the seed threshold", () => {
    const graph = makeGraph([{ id: T, isTarget: true }, { id: A(2) }], [edge(T, A(2), 1)]);
    const risks = [{ id: A(2), risk: 0.2, signals: [] }];
    expect(findSuspiciousPaths(graph, T, risks).paths).toHaveLength(0);
  });

  it("skips seeds that are unreachable", () => {
    const graph = makeGraph([{ id: T, isTarget: true }, { id: A(2) }, { id: A(9) }], [edge(T, A(2), 1)]);
    const risks = [
      { id: A(2), risk: 0.5, signals: ["s1"] },
      { id: A(9), risk: 1, signals: ["s2"] }, // isolated node
    ];
    const { paths } = findSuspiciousPaths(graph, T, risks);
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual([T, A(2)]);
  });

  it("caps path length at 4 nodes", () => {
    const chain = [T, A(2), A(3), A(4), A(5), A(6)];
    const edges = chain.slice(0, -1).map((from, i) => edge(from, chain[i + 1], i + 1));
    const graph = makeGraph(chain.map((id) => ({ id, isTarget: id === T })), edges);
    const risks = [{ id: A(6), risk: 1, signals: ["flagged as scam by the explorer"] }];
    expect(findSuspiciousPaths(graph, T, risks).paths).toHaveLength(0);
    // but a seed within the cap is found
    const risks2 = [{ id: A(4), risk: 1, signals: ["flagged as scam by the explorer"] }];
    expect(findSuspiciousPaths(graph, T, risks2).paths[0].nodes).toEqual([T, A(2), A(3), A(4)]);
  });

  it("orders paths by risk desc and limits to 5", () => {
    const nodes: (Partial<GraphNode> & { id: string })[] = [{ id: T, isTarget: true }];
    const edges: GraphEdge[] = [];
    const risks = [];
    for (let i = 0; i < 8; i++) {
      const id = A(10 + i);
      nodes.push({ id });
      edges.push(edge(T, id, i));
      risks.push({ id, risk: 0.5 + i * 0.05, signals: [`signal ${i}`] });
    }
    const graph = makeGraph(nodes, edges);
    const { paths } = findSuspiciousPaths(graph, T, risks);
    expect(paths).toHaveLength(5);
    expect(paths[0].risk).toBeGreaterThanOrEqual(paths[1].risk);
    expect(paths.map((p) => p.risk)).toEqual([...paths.map((p) => p.risk)].sort((a, b) => b - a));
  });
});

describe("end-to-end path from built graph", () => {
  it("produces a citation on a real-shaped funnel", () => {
    const graph = buildGraph({
      target: T,
      transfers: Array.from({ length: 8 }, (_, i) => makeTransfer({ from: A(20 + i), to: A(5), block: 1_999_900 }))
        .concat([makeTransfer({ from: A(5), to: A(6), block: 1_999_950 })]),
      txs: [makeTx({ from: T, to: A(5), value: "100", block: 1_999_999 })],
    });
    const risks = computeNodeRisks({
      graph,
      target: T,
      headBlock: 2_000_000,
      approvals: [],
      params,
    });
    const { paths } = findSuspiciousPaths(graph, T, risks);
    expect(paths.length).toBeGreaterThan(0);
    const cited = paths[0].nodes;
    expect(cited.includes(T)).toBe(true);
    expect(cited.every((c) => graph.nodes.some((n) => n.id === c))).toBe(true);
  });
});
