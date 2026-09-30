import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localVerdict } from "@/lib/ai/local";
import { resolveEngine } from "@/lib/ai/verdict";
import { validateVerdict, type VerdictRequest } from "@/lib/schemas";
import { A } from "./helpers";

function makeReq(overrides: Partial<VerdictRequest> = {}): VerdictRequest {
  return {
    address: A(1),
    score: 62,
    breakdown: { fanAsymmetry: 20, ageRisk: 14, honeypotTax: 0, deployerReuse: 4, approvalRisk: 5 },
    details: [
      { key: "fanAsymmetry", value: 20, max: 25, summary: "0x000…0005 is strongly one-sided: 9 in / 1 out", evidence: [] },
      { key: "ageRisk", value: 14, max: 20, summary: "First seen 4,000 blocks ago", evidence: [] },
    ],
    paths: [[A(1), A(5)]],
    pathMeta: [{ nodes: [A(1), A(5)], reason: "Flow reaches 0x000…0005 which shows one-sided flow", risk: 0.8 }],
    nodes: [{ id: A(1), label: null }, { id: A(5), label: null }],
    ...overrides,
  };
}

describe("localVerdict", () => {
  it("cites the top path when accusing", () => {
    const v = localVerdict(makeReq({ score: 70 }));
    expect(v.verdict).toBe("high-risk");
    expect(v.evidencePath).toEqual([A(1), A(5)]);
    expect(v.nextBestAction).toBe("block");
    expect(v.reasons.length).toBeGreaterThanOrEqual(1);
    expect(v.reasons.join(" ")).toContain("Evidence path");
    expect(v.score).toBe(70);
  });

  it("escalates to high-risk on a strong honeypot signal even at mid scores", () => {
    const v = localVerdict(
      makeReq({
        score: 55,
        breakdown: { fanAsymmetry: 10, ageRisk: 4, honeypotTax: 20, deployerReuse: 0, approvalRisk: 0 },
        details: [{ key: "honeypotTax", value: 20, max: 25, summary: "Fee-on-transfer detected: 40% TKN", evidence: [] }],
      }),
    );
    expect(v.verdict).toBe("high-risk");
  });

  it("returns clear for low scores with no paths", () => {
    const v = localVerdict(makeReq({ score: 8, paths: [], pathMeta: [], details: [] }));
    expect(v.verdict).toBe("clear");
    expect(v.evidencePath).toEqual([]);
    expect(v.nextBestAction).toBe("monitor");
    expect(v.confidence).toBeGreaterThan(0.4);
  });

  it("returns insufficient-evidence when score is high but no path exists", () => {
    const v = localVerdict(makeReq({ score: 55, paths: [], pathMeta: [] }));
    expect(v.verdict).toBe("insufficient-evidence");
    expect(v.nextBestAction).toBe("request-evidence");
    expect(v.evidencePath).toEqual([]);
    expect(v.reasons.some((r) => r.includes("no suspicious flow path"))).toBe(true);
  });

  it("produces output that passes validateVerdict guardrails (self-consistency)", () => {
    for (const score of [5, 25, 45, 70, 95]) {
      const req = makeReq({ score, paths: score > 30 ? [[A(1), A(5)]] : [], pathMeta: score > 30 ? makeReq().pathMeta : [] });
      const v = localVerdict(req);
      const res = validateVerdict(JSON.stringify(v), {
        graphNodes: new Set([A(1), A(5)]),
        score,
        hasPaths: req.paths.length > 0,
      });
      expect(res.ok, `score=${score} → ${JSON.stringify(v)}`).toBe(true);
    }
  });
});

describe("resolveEngine", () => {
  const ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.VERDICT_MODE;
    delete process.env.VERDICT_MODEL;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...ENV };
  });

  it("disables the LLM with no key (zero-key mode)", () => {
    const e = resolveEngine();
    expect(e.enabled).toBe(false);
    expect(e.models[0]).toBe("openrouter/free");
  });

  it("enables when OPENROUTER_API_KEY is present and defaults to the free chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const e = resolveEngine();
    expect(e.enabled).toBe(true);
    expect(e.baseUrl).toContain("openrouter.ai");
    expect(e.models.length).toBeGreaterThanOrEqual(3);
  });

  it("honors VERDICT_MODE=local even with a key", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.VERDICT_MODE = "local";
    expect(resolveEngine().enabled).toBe(false);
  });

  it("honors VERDICT_MODE=llm without a key (will fall back at runtime)", () => {
    process.env.VERDICT_MODE = "llm";
    expect(resolveEngine().enabled).toBe(true);
  });

  it("puts VERDICT_MODEL first and keeps the chain as fallbacks", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.VERDICT_MODEL = "my/custom-model";
    const e = resolveEngine();
    expect(e.models[0]).toBe("my/custom-model");
    expect(e.models).toContain("openrouter/free");
  });

  it("uses OpenAI defaults when only OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-openai-test";
    const e = resolveEngine();
    expect(e.enabled).toBe(true);
    expect(e.baseUrl).toContain("api.openai.com");
    expect(e.models[0]).toBe("gpt-4o-mini");
  });
});
