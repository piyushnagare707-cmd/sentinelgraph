import type { VerdictRequest } from "../schemas";
import type { HeuristicKey, Verdict } from "../types";

const KEY_ORDER: HeuristicKey[] = [
  "honeypotTax",
  "fanAsymmetry",
  "approvalRisk",
  "deployerReuse",
  "ageRisk",
];

/**
 * Deterministic, zero-key verdict engine.
 * Same schema as the LLM output so the app is fully usable from a fresh
 * clone without any API key (and serves as the guardrail fallback).
 */
export function localVerdict(req: VerdictRequest): Verdict {
  const hasPaths = req.paths.length > 0;
  const topPath: string[] = req.pathMeta.length
    ? [...req.pathMeta].sort((a, b) => b.risk - a.risk)[0].nodes
    : (req.paths[0] ?? []);

  const positiveDetails = KEY_ORDER.map((k) => {
    const d = req.details.find((x) => x.key === k);
    return d && d.value > 0 ? d : null;
  }).filter((d): d is NonNullable<typeof d> => d !== null);

  const reasons: string[] = [];
  if (positiveDetails.length > 0) {
    for (const d of positiveDetails.slice(0, 3)) reasons.push(d.summary);
  } else {
    reasons.push(`All deterministic heuristics scored within normal ranges (score ${req.score}/100)`);
  }

  const confidence = Math.min(0.95, 0.45 + Math.abs(req.score - 50) / 100);
  const honeypotMax = req.breakdown.honeypotTax >= 18;

  if (!hasPaths) {
    if (req.score >= 30) {
      return {
        verdict: "insufficient-evidence",
        score: req.score,
        confidence: 0.6,
        reasons: [
          `Score is elevated (${req.score}/100) but no suspicious flow path could be grounded in the graph`,
          ...reasons.slice(0, 3),
        ].slice(0, 5),
        evidencePath: [],
        nextBestAction: "request-evidence",
      };
    }
    return {
      verdict: "clear",
      score: req.score,
      confidence,
      reasons: reasons.slice(0, 3),
      evidencePath: [],
      nextBestAction: "monitor",
    };
  }

  const verdict: Verdict["verdict"] =
    req.score >= 65 || honeypotMax ? "high-risk" : req.score >= 35 ? "suspicious" : "clear";

  return {
    verdict,
    score: req.score,
    confidence,
    reasons: [
      ...reasons.slice(0, 3),
      `Evidence path: ${topPath.join(" → ")} (deterministic BFS over the built graph)`,
    ].slice(0, 5),
    evidencePath: topPath.map((a) => a.toLowerCase()),
    nextBestAction: verdict === "high-risk" ? "block" : "monitor",
  };
}
