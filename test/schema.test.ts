import { describe, expect, it } from "vitest";
import {
  BsAddressInfoSchema,
  BsTokenTransferItemSchema,
  BsTransactionItemSchema,
  extractJson,
  isValidAddress,
  listSchema,
  normalizeAddress,
  validateVerdict,
  VerdictSchema,
} from "@/lib/schemas";
import { A, readFixture } from "./helpers";

const nodes = new Set([A(1), A(2), A(3)]);

describe("address validation", () => {
  it("accepts 0x + 40 hex", () => {
    expect(isValidAddress(A(42))).toBe(true);
    expect(isValidAddress("0x" + "AbCd".repeat(10))).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("0x" + "g".repeat(40))).toBe(false);
    expect(isValidAddress("1234567890abcdef1234567890abcdef12345678")).toBe(false);
  });

  it("normalizes case and bare hex", () => {
    expect(normalizeAddress("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD")).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
    expect(normalizeAddress("  " + "AB".repeat(20) + " ")).toBe("0x" + "ab".repeat(20));
    expect(() => normalizeAddress("0xnope")).toThrow("invalid-address");
  });
});

describe("pinned Blockscout fixtures (schema drift guard)", () => {
  it("address info parses", () => {
    const parsed = BsAddressInfoSchema.safeParse(readFixture("address-info.json"));
    expect(parsed.success).toBe(true);
  });

  it("token transfers page parses", () => {
    const parsed = listSchema(BsTokenTransferItemSchema).safeParse(readFixture("token-transfers.json"));
    expect(parsed.success).toBe(true);
  });

  it("transactions page parses", () => {
    const parsed = listSchema(BsTransactionItemSchema).safeParse(readFixture("transactions.json"));
    expect(parsed.success).toBe(true);
  });

  it("rejects a drifted shape", () => {
    expect(BsTokenTransferItemSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("extractJson", () => {
  it("extracts from code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts from surrounding prose", () => {
    expect(extractJson('Here you go: {"a":1} done')).toBe('{"a":1}');
  });
  it("returns null when no object", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("VerdictSchema", () => {
  const valid = {
    verdict: "suspicious",
    score: 62,
    confidence: 0.7,
    reasons: ["High fan asymmetry 0.8"],
    evidencePath: [A(2)],
    nextBestAction: "monitor",
  };

  it("accepts a valid verdict", () => {
    expect(VerdictSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects bad enum values and out-of-range scores", () => {
    expect(VerdictSchema.safeParse({ ...valid, verdict: "guilty" }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, score: 101 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, confidence: 1.4 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, reasons: [] }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, reasons: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
  });
});

describe("validateVerdict guardrails (PRD §5)", () => {
  const ctx = { graphNodes: nodes, score: 62, hasPaths: true };
  const base = {
    verdict: "suspicious" as const,
    score: 62,
    confidence: 0.7,
    reasons: ["Path 0x…→0x… shows fan-in asymmetry"],
    evidencePath: [A(2)],
    nextBestAction: "monitor" as const,
  };

  it("accepts a grounded accusation", () => {
    const res = validateVerdict(JSON.stringify(base), ctx);
    expect(res.ok).toBe(true);
  });

  it("rejects an address that is not in the built graph", () => {
    const res = validateVerdict(JSON.stringify({ ...base, evidencePath: [A(2), A(99)] }), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("not in graph");
  });

  it("rejects an accusation with an empty evidencePath", () => {
    const res = validateVerdict(JSON.stringify({ ...base, evidencePath: [] }), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("non-empty evidencePath");
  });

  it("rejects an accusation when no path exists at all", () => {
    const res = validateVerdict(JSON.stringify(base), { ...ctx, hasPaths: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("no suspicious path");
  });

  it("allows clear without any path", () => {
    const res = validateVerdict(
      JSON.stringify({ ...base, verdict: "clear", evidencePath: [] }),
      { ...ctx, hasPaths: false, score: 12 },
    );
    expect(res.ok).toBe(true);
  });

  it("forbids the word fraud when score < 20", () => {
    const low = { ...ctx, score: 12 };
    const res = validateVerdict(
      JSON.stringify({ ...base, verdict: "clear", reasons: ["clear, no fraud signals"] }),
      low,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("fraud");
  });

  it("requires request-evidence + empty path for insufficient-evidence", () => {
    const bad = validateVerdict(
      JSON.stringify({ ...base, verdict: "insufficient-evidence", nextBestAction: "monitor" }),
      ctx,
    );
    expect(bad.ok).toBe(false);

    const good = validateVerdict(
      JSON.stringify({
        ...base,
        verdict: "insufficient-evidence",
        evidencePath: [],
        nextBestAction: "request-evidence",
      }),
      ctx,
    );
    expect(good.ok).toBe(true);
  });

  it("rejects non-JSON and schema-invalid output", () => {
    expect(validateVerdict("I think it is suspicious", ctx).ok).toBe(false);
    expect(validateVerdict("{broken", ctx).ok).toBe(false);
    expect(
      validateVerdict(JSON.stringify({ ...base, verdict: "guilty" }), ctx).ok,
    ).toBe(false);
  });

  it("lowercases cited addresses", () => {
    const mixed = "0x" + "AB".repeat(20);
    const res = validateVerdict(JSON.stringify({ ...base, evidencePath: [mixed] }), {
      ...ctx,
      graphNodes: new Set([A(1), A(2), "0x" + "ab".repeat(20)]),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.verdict.evidencePath[0]).toBe(mixed.toLowerCase());
  });
});
