import { loadHeuristicsConfig, type HeuristicsConfig } from "./config";
import { runAllHeuristics, type HeuristicInput } from "./heur";
import type { ScoreBreakdown, ScoreResult } from "./types";

/**
 * score = Σ weight_i × value_i   (PRD §5)
 * Each heuristic returns its earned points in [0, weight]; the breakdown is
 * auditable against config/heuristics.json.
 */
export function computeScore(input: HeuristicInput, cfg?: HeuristicsConfig): ScoreResult {
  const config = cfg ?? loadHeuristicsConfig();
  const details = runAllHeuristics({ ...input, weights: config.weights, params: config.params });

  const breakdown = {} as ScoreBreakdown;
  let score = 0;
  for (const d of details) {
    const clamped = Math.max(0, Math.min(d.max, Math.round(d.value)));
    breakdown[d.key] = clamped;
    score += clamped;
  }

  return { score: Math.min(100, score), breakdown, details };
}
