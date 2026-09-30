import { describe, expect, it } from "vitest";
import { adjacency, buildGraph, pruneGraph, reverseAdjacency } from "@/lib/graph";
import { A, makeTransfer, makeTx, TOKEN } from "./helpers";
import type { AddressInfo } from "@/lib/types";

const T = A(1);
const X = A(2);
const Y = A(3);

describe("buildGraph", () => {
  it("creates nodes and token edges from transfers", () => {
    const g = buildGraph({
      target: T,
      transfers: [
        makeTransfer({ from: T, to: X, block: 100 }),
        makeTransfer({ from: X, to: Y, block: 90 }),
      ],
      txs: [],
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([T, X, Y].sort());
    expect(g.edges).toHaveLength(2);
    expect(g.nodes.find((n) => n.id === T)?.isTarget).toBe(true);
    expect(g.nodes.find((n) => n.id === T)?.firstSeenBlock).toBe(100);
    expect(g.nodes.find((n) => n.id === X)?.firstSeenBlock).toBe(90);
  });

  it("dedupes identical transfer legs and skips self-transfers", () => {
    const h = "0x" + "11".repeat(32);
    const dup = makeTransfer({ from: T, to: X, hash: h, logIndex: 3 });
    const g = buildGraph({
      target: T,
      transfers: [dup, { ...dup }, dup],
      txs: [],
    });
    expect(g.edges).toHaveLength(1);

    const self = buildGraph({
      target: T,
      transfers: [makeTransfer({ from: T, to: T })],
      txs: [],
    });
    expect(self.edges).toHaveLength(0);
    expect(self.nodes).toHaveLength(1);
  });

  it("adds native edges only for value > 0", () => {
    const g = buildGraph({
      target: T,
      transfers: [],
      txs: [
        makeTx({ from: T, to: X, value: "5000", block: 10 }),
        makeTx({ from: T, to: Y, value: "0", block: 11 }),
      ],
    });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].token).toBeNull();
    expect(g.edges[0].value).toBe("5000");
  });

  it("merges creator + kind from address infos", () => {
    const info: AddressInfo = {
      hash: X,
      isContract: true,
      isScam: false,
      isVerified: true,
      name: "TestToken",
      creator: A(9),
      creationTx: null,
      reputation: "ok",
      tags: [],
    };
    const g = buildGraph({ target: T, transfers: [makeTransfer({ from: T, to: X })], txs: [], infos: [info] });
    const node = g.nodes.find((n) => n.id === X)!;
    expect(node.kind).toBe("contract");
    expect(node.label).toBe("TestToken");
    expect(node.creator).toBe(A(9));
    expect(node.isVerified).toBe(true);
    expect(g.nodes.some((n) => n.id === A(9))).toBe(true); // creator materialized
  });

  it("counts distinct transactions per node", () => {
    const g = buildGraph({
      target: T,
      transfers: [
        makeTransfer({ from: T, to: X, hash: "0x" + "0a".repeat(32) }),
        makeTransfer({ from: T, to: X, hash: "0x" + "0a".repeat(32) }),
        makeTransfer({ from: T, to: X, hash: "0x" + "0b".repeat(32) }),
      ],
      txs: [],
    });
    expect(g.nodes.find((n) => n.id === T)?.txCount).toBe(2);
  });
});

describe("pruneGraph", () => {
  it("respects the node and edge caps and always keeps the target", () => {
    const transfers = [];
    const seen = new Set<string>();
    for (let i = 2; i < 40; i++) {
      const to = A(i);
      if (seen.has(to)) continue;
      seen.add(to);
      for (let k = 0; k < 3; k++) {
        transfers.push(makeTransfer({ from: T, to, logIndex: k }));
      }
    }
    const full = buildGraph({ target: T, transfers, txs: [] });
    const pruned = pruneGraph(full, T, 10, 20);

    expect(pruned.nodes.length).toBeLessThanOrEqual(10);
    expect(pruned.edges.length).toBeLessThanOrEqual(20);
    expect(pruned.nodes.some((n) => n.id === T)).toBe(true);
    // every edge endpoint must survive pruning
    const ids = new Set(pruned.nodes.map((n) => n.id));
    for (const e of pruned.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("ranks high-multiplicity corridors above one-offs", () => {
    const busy = A(7);
    const transfers = [
      ...Array.from({ length: 6 }, (_, i) => makeTransfer({ from: T, to: busy, logIndex: i })),
      makeTransfer({ from: T, to: A(8) }),
    ];
    const pruned = pruneGraph(buildGraph({ target: T, transfers, txs: [] }), T, 10, 3);
    const endpoints = pruned.edges.map((e) => e.to);
    expect(endpoints.filter((e) => e === busy)).toHaveLength(3);
  });
});

describe("adjacency", () => {
  it("builds forward and reverse maps", () => {
    const g = buildGraph({
      target: T,
      transfers: [makeTransfer({ from: T, to: X }), makeTransfer({ from: Y, to: T })],
      txs: [],
    });
    expect(adjacency(g).get(T)!.map((a) => a.to)).toEqual([X]);
    expect(reverseAdjacency(g).get(T)!.map((a) => a.to)).toEqual([Y]);
  });
});

describe("token identity", () => {
  it("keeps token metadata on edges", () => {
    const g = buildGraph({ target: T, transfers: [makeTransfer({ from: T, to: X, token: TOKEN })], txs: [] });
    expect(g.edges[0].token?.symbol).toBe("TKN");
    expect(g.edges[0].token?.address).toBe(TOKEN.address);
  });
});
