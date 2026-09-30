import { loadHeuristicsConfig } from "./config";
import { AppError } from "./errors";
import { extractApprovals, fetchAddressBundle, fetchAddressInfo, fetchHeadBlock } from "./fetch";
import { buildGraph, pruneGraph } from "./graph";
import { computeNodeRisks, findSuspiciousPaths } from "./path";
import { computeScore } from "./score";
import { isValidAddress, normalizeAddress } from "./schemas";
import type { AnalyzeResult, AddressInfo, RawTransfer, RawTx, StageName } from "./types";

export type { StageName } from "./types";

export interface AnalyzeHooks {
  onStage?: (stage: StageName) => void;
  onProgress?: (p: { transfers: number; transactions: number }) => void;
}

function now(): number {
  return performance.now();
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * PRD §9 pipeline: fetch → graph → heuristics → BFS paths.
 * Pure orchestration; every step below is independently unit-tested.
 */
export async function analyze(
  address: string,
  hops: 1 | 2,
  hooks: AnalyzeHooks = {},
): Promise<AnalyzeResult> {
  const trimmed = address.trim();
  const candidate = /^[0-9a-fA-F]{40}$/.test(trimmed) ? `0x${trimmed}` : trimmed;
  if (!isValidAddress(candidate)) {
    throw new AppError("invalid-address", "Expected a 0x-prefixed 40 hex-character EVM address");
  }
  const target = normalizeAddress(candidate);
  const cfg = loadHeuristicsConfig();
  const t0 = now();

  // ---- 1. fetch ----------------------------------------------------------
  hooks.onStage?.("fetching");

  const [bundle, headBlock] = await Promise.all([
    fetchAddressBundle(target, {
      maxTransfers: cfg.params.maxTransfers,
      maxTx: cfg.params.maxNativeTx,
      onProgress: hooks.onProgress,
    }),
    fetchHeadBlock().catch(() => null),
  ]);

  let transfers: RawTransfer[] = [...bundle.transfers];
  const txs: RawTx[] = [...bundle.txs];

  if (!bundle.info && transfers.length === 0 && txs.length === 0) {
    throw new AppError("not-found", "No activity found for this address on Base Sepolia");
  }

  // 2-hop: pull transfers for the busiest counterparties (bounded seeds)
  if (hops === 2) {
    const counter = new Map<string, number>();
    for (const t of transfers) {
      counter.set(t.from, (counter.get(t.from) ?? 0) + 1);
      counter.set(t.to, (counter.get(t.to) ?? 0) + 1);
    }
    for (const tx of txs) {
      counter.set(tx.from, (counter.get(tx.from) ?? 0) + 1);
      if (tx.to) counter.set(tx.to, (counter.get(tx.to) ?? 0) + 1);
    }
    counter.delete(target);

    const seeds = [...counter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, cfg.params.max2HopSeeds)
      .map(([id]) => id);

    const seedBundles = await Promise.all(
      seeds.map((seed) =>
        fetchAddressBundle(seed, {
          maxTransfers: 60,
          maxTx: 0,
          withInfo: false,
          onProgress: hooks.onProgress,
          progressOffset: transfers.length,
        }),
      ),
    );
    for (const b of seedBundles) transfers = transfers.concat(b.transfers);
  }

  // deployer info for prominent contract nodes (creator_address_hash)
  const preGraph = buildGraph({ target, transfers, txs, infos: [bundle.info] });
  const contractCandidates = preGraph.nodes
    .filter((n) => n.kind === "contract" && n.id !== target && !n.creator)
    .sort((a, b) => b.txCount - a.txCount || a.id.localeCompare(b.id))
    .slice(0, cfg.params.deployerInfoFetchLimit);

  const extraInfos = await Promise.all(
    contractCandidates.map((n) =>
      fetchAddressInfo(n.id).catch((e: unknown) => {
        if (e instanceof AppError && (e.code === "not-found" || e.code === "upstream-error")) return null;
        throw e;
      }),
    ),
  );

  const fetchMs = now() - t0;
  const infos: (AddressInfo | null)[] = [bundle.info, ...extraInfos];

  // ---- 2. graph ----------------------------------------------------------
  hooks.onStage?.("graph");
  const t1 = now();

  const fullGraph = buildGraph({ target, transfers, txs, infos });
  const graph = pruneGraph(fullGraph, target, cfg.params.maxNodes, cfg.params.maxEdges);

  // ---- 3. score + paths --------------------------------------------------
  hooks.onStage?.("scoring");
  const t2 = now();

  const approvals = extractApprovals(txs, cfg.params.unlimitedApprovalMinHex);
  const scoreResult = computeScore({
    graph,
    transfers,
    target,
    headBlock,
    approvals,
    weights: cfg.weights,
    params: cfg.params,
  });

  const riskResult = computeNodeRisks({ graph, target, headBlock, approvals, params: cfg.params });
  const { paths: pathMeta, nodeRisks } = findSuspiciousPaths(graph, target, riskResult);

  const scoreMs = now() - t2;
  const graphMs = t2 - t1;
  const totalMs = now() - t0;

  return {
    address: target,
    hops,
    graph,
    score: scoreResult.score,
    breakdown: scoreResult.breakdown,
    details: scoreResult.details,
    paths: pathMeta.map((p) => p.nodes),
    pathMeta,
    nodeRisks,
    latency: { fetch: round(fetchMs), score: round(graphMs + scoreMs), total: round(totalMs) },
    counts: { transfers: transfers.length, transactions: txs.length, approvals: approvals.length },
  };
}
