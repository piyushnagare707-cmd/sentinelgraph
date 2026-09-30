import type { HeuristicInput } from "./index";
import type { HeuristicDetail } from "../types";

/**
 * ① Fan-in / fan-out asymmetry — 0..weight
 * For every node with degree >= minFanDegree compute |in - out| / (in + out).
 * The most asymmetric node drives the score: a sybil funnel receives from many
 * and sends to few (or launders out to many and receives from few).
 */
export function runFanAsymmetry(input: HeuristicInput): HeuristicDetail {
  const weight = input.weights.fanAsymmetry;
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();

  for (const e of input.graph.edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  let best: { id: string; asym: number; inn: number; out: number } | null = null;
  for (const node of input.graph.nodes) {
    const inn = inDeg.get(node.id) ?? 0;
    const out = outDeg.get(node.id) ?? 0;
    const total = inn + out;
    if (total < input.params.minFanDegree) continue;
    const asym = Math.abs(inn - out) / total;
    if (
      !best ||
      asym > best.asym ||
      (asym === best.asym && total > best.inn + best.out) ||
      (asym === best.asym && total === best.inn + best.out && node.id < best.id)
    ) {
      best = { id: node.id, asym, inn, out };
    }
  }

  if (!best) {
    return {
      key: "fanAsymmetry",
      value: 0,
      max: weight,
      summary: `No address reached degree ${input.params.minFanDegree} — asymmetry not measurable`,
      evidence: [],
    };
  }

  const value = Math.round(weight * best.asym);
  return {
    key: "fanAsymmetry",
    value,
    max: weight,
    summary: `${short(best.id)} is ${best.asym >= 0.5 ? "strongly" : "moderately"} one-sided: ${best.inn} in / ${best.out} out (asymmetry ${best.asym.toFixed(2)})`,
    evidence: [best.id, `in=${best.inn}`, `out=${best.out}`],
  };
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
