import { z } from "zod";
import type { Verdict } from "./types";

// ---------------------------------------------------------------------------
// Address helpers
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

/** Trim, prepend 0x when missing, lowercase. Throws on malformed input. */
export function normalizeAddress(value: string): string {
  let v = value.trim();
  if (/^[0-9a-fA-F]{40}$/.test(v)) v = `0x${v}`;
  if (!isValidAddress(v)) {
    throw new Error("invalid-address");
  }
  return v.toLowerCase();
}

export const AnalyzeBodySchema = z.object({
  address: z.string().min(2).max(66),
  hops: z.union([z.literal(1), z.literal(2)]).default(1),
});

// ---------------------------------------------------------------------------
// Blockscout response shapes — pinned so schema drift is caught in CI
// (recorded fixtures in test/fixtures are parsed with these in test/schema.test.ts)
// ---------------------------------------------------------------------------

const BsAddressRef = z.object({
  hash: z.string(),
  is_contract: z.boolean().nullish(),
  is_scam: z.boolean().nullish(),
  is_verified: z.boolean().nullish(),
  name: z.string().nullish(),
  reputation: z.string().nullish(),
  metadata: z
    .object({ tags: z.array(z.object({ name: z.string().optional() })).nullish() })
    .nullish(),
});

export const BsAddressInfoSchema = z.object({
  hash: z.string(),
  is_contract: z.boolean().nullish(),
  is_scam: z.boolean().nullish(),
  is_verified: z.boolean().nullish(),
  name: z.string().nullish(),
  creator_address_hash: z.string().nullish(),
  creation_transaction_hash: z.string().nullish(),
  reputation: z.string().nullish(),
  coin_balance: z.string().nullish(),
  metadata: z
    .object({ tags: z.array(z.object({ name: z.string().optional() })).nullish() })
    .nullish(),
});

export const BsTokenSchema = z.object({
  address_hash: z.string(),
  symbol: z.string().nullish(),
  name: z.string().nullish(),
  decimals: z.string().nullish(),
  type: z.string().nullish(),
});

export const BsTokenTransferItemSchema = z.object({
  transaction_hash: z.string(),
  block_number: z.number(),
  timestamp: z.string(),
  log_index: z.number().nullish(),
  from: BsAddressRef,
  to: BsAddressRef,
  token: BsTokenSchema.nullish(),
  total: z
    .object({
      value: z.string().nullish(),
      decimals: z.string().nullish(),
    })
    .nullish(),
  token_type: z.string().nullish(),
});

export const BsTransactionItemSchema = z.object({
  hash: z.string(),
  block_number: z.number(),
  timestamp: z.string(),
  value: z.string().nullish(),
  method: z.string().nullish(),
  raw_input: z.string().nullish(),
  from: BsAddressRef,
  to: BsAddressRef.nullish(),
  status: z.string().nullish(),
});

export function listSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_page_params: z.record(z.string(), z.unknown()).nullish(),
  });
}

// ---------------------------------------------------------------------------
// Verdict schema (PRD §5 AI LAYER SPEC) + guardrails
// ---------------------------------------------------------------------------

export const VerdictSchema = z.object({
  verdict: z.enum(["clear", "suspicious", "high-risk", "insufficient-evidence"]),
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).min(1).max(5),
  evidencePath: z.array(z.string()),
  nextBestAction: z.enum(["block", "monitor", "request-evidence"]),
});

export type VerdictInput = z.input<typeof VerdictSchema>;

export interface VerdictContext {
  /** Every node id present in the built graph (lowercase). */
  graphNodes: Set<string>;
  /** Deterministic score computed from heuristics. */
  score: number;
  /** Whether the pipeline found any suspicious path. */
  hasPaths: boolean;
}

export type VerdictValidation =
  | { ok: true; verdict: Verdict }
  | { ok: false; reason: string };

/** Pull the first JSON object out of a model response (tolerates ```json fences). */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}

/**
 * Guardrails (PRD §5):
 *  1. response parses and matches the Zod schema;
 *  2. every evidencePath node must exist in the built graph — no invented addresses;
 *  3. an accusation (suspicious/high-risk) requires at least one path;
 *  4. when no path exists the only allowed verdict is insufficient-evidence;
 *  5. when score < 20 the word "fraud" is forbidden anywhere in the response;
 *  6. insufficient-evidence must ship with nextBestAction = request-evidence and an empty path.
 */
export function validateVerdict(raw: string, ctx: VerdictContext): VerdictValidation {
  if (ctx.score < 20 && /\bfraud\b/i.test(raw)) {
    return { ok: false, reason: "guardrail: word 'fraud' used while score < 20" };
  }

  const json = extractJson(raw);
  if (!json) return { ok: false, reason: "no JSON object found in response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "response is not valid JSON" };
  }

  const res = VerdictSchema.safeParse(parsed);
  if (!res.success) {
    return { ok: false, reason: `schema: ${res.error.issues[0]?.message ?? "invalid"}` };
  }
  const v = res.data;

  const unknownNodes = v.evidencePath.filter((n) => !ctx.graphNodes.has(n.toLowerCase()));
  if (unknownNodes.length > 0) {
    return { ok: false, reason: `guardrail: evidencePath not in graph: ${unknownNodes.join(", ")}` };
  }

  if (!ctx.hasPaths && (v.verdict === "suspicious" || v.verdict === "high-risk")) {
    return {
      ok: false,
      reason: "guardrail: no suspicious path exists — accusation forbidden (use clear or insufficient-evidence)",
    };
  }

  if ((v.verdict === "suspicious" || v.verdict === "high-risk") && v.evidencePath.length === 0) {
    return { ok: false, reason: "guardrail: accusation requires a non-empty evidencePath" };
  }

  if (v.verdict === "insufficient-evidence") {
    if (v.evidencePath.length !== 0 || v.nextBestAction !== "request-evidence") {
      return {
        ok: false,
        reason: "guardrail: insufficient-evidence requires empty evidencePath and nextBestAction=request-evidence",
      };
    }
  }

  return { ok: true, verdict: { ...v, evidencePath: v.evidencePath.map((n) => n.toLowerCase()) } };
}

// ---------------------------------------------------------------------------
// Verdict request body (POST /api/verdict)
// ---------------------------------------------------------------------------

export const VerdictRequestSchema = z.object({
  address: z.string().min(2).max(66),
  score: z.number().int().min(0).max(100),
  breakdown: z.object({
    fanAsymmetry: z.number(),
    ageRisk: z.number(),
    honeypotTax: z.number(),
    deployerReuse: z.number(),
    approvalRisk: z.number(),
  }),
  details: z
    .array(
      z.object({
        key: z.string(),
        value: z.number(),
        max: z.number(),
        summary: z.string(),
        evidence: z.array(z.string()),
      }),
    )
    .default([]),
  paths: z.array(z.array(z.string())).default([]),
  pathMeta: z
    .array(z.object({ nodes: z.array(z.string()), reason: z.string(), risk: z.number() }))
    .default([]),
  nodes: z.array(z.object({ id: z.string(), label: z.string().nullish() })).default([]),
});

export type VerdictRequest = z.infer<typeof VerdictRequestSchema>;
