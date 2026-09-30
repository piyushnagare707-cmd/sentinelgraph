import type { HeuristicInput } from "./index";
import type { HeuristicDetail } from "../types";

/**
 * ④ Deployer reuse — 0..weight
 * Count contract nodes that share a deployer (creator_address_hash).
 * N >= 2 earns points; N >= deployerReuseFullAt saturates the weight.
 * Deployers are resolved for the target + top contract nodes (info fetch cap).
 */
export function runDeployerReuse(input: HeuristicInput): HeuristicDetail {
  const weight = input.weights.deployerReuse;
  const { params } = input;

  const byCreator = new Map<string, string[]>();
  for (const n of input.graph.nodes) {
    if (!n.creator) continue;
    const list = byCreator.get(n.creator) ?? [];
    list.push(n.id);
    byCreator.set(n.creator, list);
  }

  let bestCreator: string | null = null;
  let bestCount = 0;
  for (const [creator, list] of byCreator) {
    if (list.length > bestCount || (list.length === bestCount && creator < (bestCreator ?? ""))) {
      bestCreator = creator;
      bestCount = list.length;
    }
  }

  if (bestCreator === null || bestCount < 2) {
    return {
      key: "deployerReuse",
      value: 0,
      max: weight,
      summary: "No shared deployer observed among analyzed contracts",
      evidence: [],
    };
  }

  const fullAt = Math.max(2, params.deployerReuseFullAt);
  const intensity = Math.min((bestCount - 1) / (fullAt - 1), 1);
  const value = Math.round(weight * intensity);

  return {
    key: "deployerReuse",
    value,
    max: weight,
    summary: `Deployer ${bestCreator.slice(0, 8)}… deployed ${bestCount} contracts in this graph`,
    evidence: [bestCreator, `contracts=${bestCount}`, ...byCreator.get(bestCreator)!.slice(0, 3)],
  };
}
