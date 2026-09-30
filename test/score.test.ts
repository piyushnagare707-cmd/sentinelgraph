import { describe, expect, it } from "vitest";
import { computeScore } from "@/lib/score";
import { loadHeuristicsConfig, HEURISTIC_KEYS } from "@/lib/config";
import { A, makeGraph, makeInput } from "./helpers";

const cfg = loadHeuristicsConfig();

describe("heuristics config", () => {
  it("weights sum to 100 (auditable, PRD §5)", () => {
    const total = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    expect(Object.keys(cfg.weights).sort()).toEqual([...HEURISTIC_KEYS].sort());
  });

  it("has sane params", () => {
    expect(cfg.params.maxNodes).toBe(60);
    expect(cfg.params.maxEdges).toBe(120);
    expect(cfg.params.honeypotTaxThresholdPct).toBe(10);
    expect(cfg.params.cacheTtlMs).toBeGreaterThan(0);
  });
});

describe("computeScore", () => {
  it("returns every heuristic key with values within [0, weight] and score = sum", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true }], []);
    const res = computeScore(makeInput({ graph }), cfg);

    for (const key of HEURISTIC_KEYS) {
      expect(res.breakdown).toHaveProperty(key);
      expect(res.breakdown[key]).toBeGreaterThanOrEqual(0);
      expect(res.breakdown[key]).toBeLessThanOrEqual(cfg.weights[key]);
    }
    const sum = HEURISTIC_KEYS.reduce((acc, k) => acc + res.breakdown[k], 0);
    expect(res.score).toBe(Math.min(100, sum));
    expect(res.details).toHaveLength(5);
    expect(res.details.map((d) => d.key).sort()).toEqual([...HEURISTIC_KEYS].sort());
  });

  it("scores a dormant address near 0", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true, firstSeenBlock: 1 }], []);
    const res = computeScore(makeInput({ graph, headBlock: 10_000_000 }), cfg);
    expect(res.score).toBe(0);
    expect(res.breakdown.ageRisk).toBe(0);
  });

  it("loads config/heuristics.json when called without an explicit config", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true }], []);
    const res = computeScore(makeInput({ graph }));
    expect(res.details).toHaveLength(5);
    expect(res.breakdown.fanAsymmetry).toBe(0);
    expect(res.score).toBeLessThanOrEqual(100);
  });

  it("accumulates multiple signals", () => {
    const target = A(1);
    const funnel = A(5);
    const edges = [];
    let n = 1;
    for (let i = 20; i < 28; i++) {
      edges.push({
        from: A(i),
        to: funnel,
        value: "100",
        token: null,
        txHash: `0x${(n++).toString(16).padStart(4, "0")}`,
        timestamp: "",
        blockNumber: 999_900,
        logIndex: 0,
      });
    }
    edges.push({
      from: funnel,
      to: A(30),
      value: "900",
      token: null,
      txHash: "0xbeef",
      timestamp: "",
      blockNumber: 999_901,
      logIndex: 0,
    });
    const graph = makeGraph(
      [
        { id: target, isTarget: true, firstSeenBlock: 999_990 },
        { id: funnel, firstSeenBlock: 999_900, creator: A(60) },
        { id: A(6), firstSeenBlock: 999_901, creator: A(60) },
      ],
      edges,
    );
    const res = computeScore(makeInput({ graph, target, headBlock: 1_000_000 }), cfg);

    expect(res.breakdown.fanAsymmetry).toBeGreaterThan(0); // 8-in/1-out funnel
    expect(res.breakdown.ageRisk).toBe(20); // first seen 10 blocks ago
    expect(res.breakdown.deployerReuse).toBeGreaterThan(0); // shared creator
    expect(res.score).toBeGreaterThan(30);
    expect(res.score).toBeLessThanOrEqual(100);
  });
});
