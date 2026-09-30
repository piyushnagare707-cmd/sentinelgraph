import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { localVerdict } from "./local";
import { validateVerdict, type VerdictRequest } from "../schemas";
import type { VerdictSource } from "../types";
import type { Verdict } from "../types";

export interface VerdictHooks {
  /** Called for each streamed text delta (attempt 1 and any corrective retry). */
  onToken?: (chunk: string) => void;
  /** Called when a response was rejected by the guardrails and will be re-asked. */
  onRetry?: (reason: string) => void;
  /** Called when the active model changes (model hop / retry). */
  onModel?: (model: string) => void;
}

export interface VerdictOutcome {
  verdict: Verdict;
  source: VerdictSource;
  model: string | null;
  attempts: number;
  latencyMs: number;
}

interface EngineConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string | undefined;
  models: string[];
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL_CHAIN = [
  "openrouter/free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "inclusionai/ling-3.0-flash-sante:free",
];
const ATTEMPTS = 2;
const STREAM_TIMEOUT_MS = 30_000;
const OVERALL_BUDGET_MS = 45_000;

export function resolveEngine(): EngineConfig {
  const mode = (process.env.VERDICT_MODE ?? "auto").toLowerCase();
  const keyFromOpenRouter = process.env.OPENROUTER_API_KEY?.trim();
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  const apiKey = keyFromOpenRouter || openAiKey || undefined;
  const baseUrl =
    process.env.OPENAI_BASE_URL?.trim() ||
    (keyFromOpenRouter || !openAiKey ? OPENROUTER_URL : "https://api.openai.com/v1");
  const isOpenRouter = baseUrl.includes("openrouter");

  const defaults = isOpenRouter ? OPENROUTER_MODEL_CHAIN : ["gpt-4o-mini"];
  const primary = process.env.VERDICT_MODEL?.trim();
  const models = primary ? [primary, ...defaults.filter((m) => m !== primary)] : defaults;

  const enabled = mode === "llm" ? true : mode === "local" ? false : Boolean(apiKey);
  return { enabled, baseUrl, apiKey, models };
}

function buildSystem(): string {
  return [
    "You are SentinelGraph, a blockchain risk analyst. Respond with a SINGLE raw JSON object and nothing else — no markdown, no code fences, no commentary.",
    'JSON shape: {"verdict":"clear|suspicious|high-risk|insufficient-evidence","score":<int 0-100 matching the deterministic score>,"confidence":<float 0-1>,"reasons":<array of 1-5 short strings>,"evidencePath":<array of addresses>,"nextBestAction":"block|monitor|request-evidence"}',
    "Rules:",
    "- evidencePath may ONLY contain addresses from the allowed list. NEVER invent an address. Order the path along the observed flow.",
    "- A verdict of suspicious or high-risk REQUIRES a non-empty evidencePath and reasons must cite that path.",
    "- If no suspicious path is provided, verdict must be clear (when score < 30) or insufficient-evidence (when score >= 30), with nextBestAction request-evidence.",
    "- If score < 20 you must never use the word fraud.",
    "- nextBestAction: block for high-risk; monitor for clear or suspicious; request-evidence for insufficient-evidence.",
    "- Reasons must be concrete and cite numbers from the deterministic breakdown. Plain text only, no markdown.",
    "- This is evidence-based analysis, not speculation: never accuse without the path.",
  ].join("\n");
}

function buildUserPrompt(req: VerdictRequest, retryReason?: string): string {
  const labels = [...req.nodes]
    .sort((a, b) => {
      const onPathA = req.paths.some((p) => p.includes(a.id)) ? 1 : 0;
      const onPathB = req.paths.some((p) => p.includes(b.id)) ? 1 : 0;
      if (onPathA !== onPathB) return onPathB - onPathA;
      return (b.label ? 1 : 0) - (a.label ? 1 : 0);
    })
    .slice(0, 20)
    .map((n) => `${n.id}${n.label ? ` (${n.label})` : ""}`)
    .join("\n");

  const paths = req.pathMeta.length
    ? req.pathMeta.map((p, i) => `${i + 1}. ${p.nodes.join(" -> ")} — ${p.reason} (risk ${p.risk})`).join("\n")
    : "(none — BFS found no suspicious path)";

  const breakdown = req.details.length
    ? req.details.map((d) => `- ${d.key}: ${d.value}/${d.max} — ${d.summary}`).join("\n")
    : JSON.stringify(req.breakdown);

  const body = [
    `Analyzed address: ${req.address}`,
    `Deterministic score: ${req.score}/100`,
    `Heuristic breakdown:\n${breakdown}`,
    `Suspicious paths found by BFS:\n${paths}`,
    `Allowed evidencePath addresses (ONLY these may be cited):\n${req.nodes.map((n) => n.id).join("\n")}`,
    `Top node labels:\n${labels || "(none)"}`,
  ].join("\n\n");

  if (retryReason) {
    return `${body}\n\nYour previous response was rejected: ${retryReason}. Respond again with a corrected JSON object only.`;
  }
  return body;
}

async function streamOnce(
  apiKey: string,
  baseUrl: string,
  model: string,
  req: VerdictRequest,
  retryReason: string | undefined,
  onToken: ((chunk: string) => void) | undefined,
): Promise<string> {
  const provider = createOpenAI({
    baseURL: baseUrl,
    apiKey,
    name: "sentinelgraph",
    headers: {
      "HTTP-Referer": "https://github.com/sentinelgraph/sentinelgraph",
      "X-Title": "SentinelGraph",
    },
  });

  const result = streamText({
    model: provider.chat(model),
    temperature: 0,
    maxOutputTokens: 700,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    system: buildSystem(),
    messages: [{ role: "user", content: buildUserPrompt(req, retryReason) }],
  });

  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    onToken?.(delta);
  }
  return text;
}

/**
 * PRD §5 AI LAYER: streaming, temperature 0, schema-validated, path-cited.
 * Guardrails live in validateVerdict(); one corrective retry, then the
 * deterministic local engine takes over so the user always gets a verdict.
 * No addresses are logged anywhere in this path.
 */
export async function generateVerdict(
  req: VerdictRequest,
  hooks: VerdictHooks = {},
): Promise<VerdictOutcome> {
  const t0 = performance.now();
  const ctx = {
    graphNodes: new Set(req.nodes.map((n) => n.id.toLowerCase())),
    score: req.score,
    hasPaths: req.paths.length > 0,
  };
  const engine = resolveEngine();

  if (!engine.enabled || !engine.apiKey) {
    const verdict = localVerdict(req);
    hooks.onToken?.("[local engine — no LLM key configured]\n");
    hooks.onToken?.(JSON.stringify(verdict, null, 2));
    return { verdict, source: "local", model: null, attempts: 0, latencyMs: Math.round(performance.now() - t0) };
  }

  const apiKey = engine.apiKey;
  let attempts = 0;
  let lastReject = "";
  let activeModel: string | null = null;
  let transportFailedAll = false;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (performance.now() - t0 > OVERALL_BUDGET_MS) break;

    const retryReason = attempt > 1 && lastReject ? lastReject : undefined;
    if (retryReason) hooks.onRetry?.(lastReject);

    const chain: string[] = activeModel ? [activeModel] : engine.models;
    let validated = false;

    for (const model of chain) {
      if (performance.now() - t0 > OVERALL_BUDGET_MS) break;
      try {
        hooks.onModel?.(model);
        const text = await streamOnce(apiKey, engine.baseUrl, model, req, retryReason, hooks.onToken);
        attempts++;
        activeModel = model;
        transportFailedAll = false;

        const res = validateVerdict(text, ctx);
        if (res.ok) {
          return {
            verdict: res.verdict,
            source: "llm",
            model,
            attempts,
            latencyMs: Math.round(performance.now() - t0),
          };
        }
        lastReject = res.reason;
        validated = true;
        break; // transport OK, guardrail rejected → corrective retry with same model
      } catch {
        // transport error (429/5xx/timeout) → hop to the next free model
        transportFailedAll = true;
        continue;
      }
    }

    if (validated) continue;
    if (transportFailedAll && !activeModel && attempt === ATTEMPTS) break;
  }

  const verdict = localVerdict(req);
  // Keep the reasoning stream honest: say why it fell back, then emit the
  // deterministic verdict so the panel is never silently empty.
  hooks.onToken?.(`[deterministic fallback — model output unusable after ${attempts} attempt(s)]\n`);
  hooks.onToken?.(JSON.stringify(verdict, null, 2));
  return {
    verdict,
    source: "fallback",
    model: activeModel,
    attempts,
    latencyMs: Math.round(performance.now() - t0),
  };
}
