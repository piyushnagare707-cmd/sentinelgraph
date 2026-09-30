import { describe, expect, it } from "vitest";
import { runFanAsymmetry } from "@/lib/heur/fanout";
import { runAgeRisk } from "@/lib/heur/age";
import { runHoneypotTax } from "@/lib/heur/honeypot";
import { runDeployerReuse } from "@/lib/heur/deployer";
import { runApprovalRisk } from "@/lib/heur/approval";
import { extractApprovals } from "@/lib/fetch";
import { loadHeuristicsConfig } from "@/lib/config";
import { A, approveInput, makeGraph, makeInput, makeTransfer, TOKEN } from "./helpers";

const cfg = loadHeuristicsConfig();

describe("① fan-in/fan-out asymmetry", () => {
  it("scores 0 below the minimum degree", () => {
    const graph = makeGraph(
      [{ id: A(1), isTarget: true }, { id: A(2) }],
      [{ from: A(1), to: A(2), value: "1", token: null, txHash: "0x1", timestamp: "", blockNumber: 1, logIndex: 0 }],
    );
    const d = runFanAsymmetry(makeInput({ graph }));
    expect(d.value).toBe(0);
    expect(d.max).toBe(25);
  });

  it("scores high for a one-sided funnel", () => {
    const funnel = A(5);
    const edges = [];
    for (let i = 10; i < 19; i++) {
      edges.push({ from: A(i), to: funnel, value: "1", token: null, txHash: `0x${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
    }
    edges.push({ from: funnel, to: A(30), value: "1", token: null, txHash: "0x1e", timestamp: "", blockNumber: 1, logIndex: 0 });
    const graph = makeGraph([{ id: A(1), isTarget: true }, { id: funnel }], edges);
    const d = runFanAsymmetry(makeInput({ graph }));
    // 9 in / 1 out → asym = 8/10 = 0.8 → round(25 * 0.8) = 20
    expect(d.value).toBe(20);
    expect(d.evidence[0]).toBe(funnel);
    expect(d.summary).toContain("9 in / 1 out");
  });

  it("scores ~half for a moderately skewed node", () => {
    const n = A(6);
    const edges = [];
    for (let i = 0; i < 3; i++) {
      edges.push({ from: A(20 + i), to: n, value: "1", token: null, txHash: `0xa${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
      edges.push({ from: n, to: A(30 + i), value: "1", token: null, txHash: `0xb${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
    }
    edges.push({ from: A(40), to: n, value: "1", token: null, txHash: "0xc", timestamp: "", blockNumber: 1, logIndex: 0 });
    const graph = makeGraph([{ id: A(1), isTarget: true }, { id: n }], edges);
    const d = runFanAsymmetry(makeInput({ graph }));
    // 4 in / 3 out → asym = 1/7 → round(25 * 0.1429) = 4
    expect(d.value).toBe(4);
  });

  it("prefers the higher-degree node when asymmetry ties", () => {
    const small = A(1);
    const big = A(2);
    const edges = [];
    for (let i = 0; i < 4; i++) {
      edges.push({ from: A(10 + i), to: small, value: "1", token: null, txHash: `0x1${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
    }
    for (let i = 0; i < 8; i++) {
      edges.push({ from: A(30 + i), to: big, value: "1", token: null, txHash: `0x2${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
    }
    const graph = makeGraph([{ id: A(1), isTarget: true }, { id: big }], edges);
    const d = runFanAsymmetry(makeInput({ graph }));
    expect(d.value).toBe(25); // both asym=1 → tie broken by total degree (12 > 4)
    expect(d.evidence[0]).toBe(big);
  });

  it("breaks exact ties lexicographically by id", () => {
    const high = A(9);
    const low = A(8);
    const edges = [];
    for (let i = 0; i < 4; i++) {
      edges.push({ from: A(20 + i), to: high, value: "1", token: null, txHash: `0x3${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
      edges.push({ from: A(40 + i), to: low, value: "1", token: null, txHash: `0x4${i}`, timestamp: "", blockNumber: 1, logIndex: 0 });
    }
    const graph = makeGraph([{ id: high, isTarget: true }, { id: low }], edges);
    const d = runFanAsymmetry(makeInput({ graph }));
    expect(d.value).toBe(25);
    expect(d.evidence[0]).toBe(low); // 0x…08 < 0x…09
  });
});

describe("② address age", () => {
  it("returns 0 when the chain head is unknown", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true, firstSeenBlock: 100 }], []);
    expect(runAgeRisk(makeInput({ graph, headBlock: null })).value).toBe(0);
  });

  it("maxes out for a target first seen within the 1k-block tier", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true, firstSeenBlock: 999_500 }], []);
    const d = runAgeRisk(makeInput({ graph, headBlock: 1_000_000 }));
    expect(d.value).toBe(20);
    expect(d.evidence).toContain("blocksSince=500");
  });

  it("scores old addresses 0 with no recent counterparties", () => {
    const graph = makeGraph(
      [{ id: A(1), isTarget: true, firstSeenBlock: 0 }, { id: A(2), firstSeenBlock: 1 }],
      [],
    );
    expect(runAgeRisk(makeInput({ graph, headBlock: 5_000_000 })).value).toBe(0);
  });

  it("boosts when counterparties are fresh even if the target is old", () => {
    const graph = makeGraph(
      [
        { id: A(1), isTarget: true, firstSeenBlock: 0 },
        { id: A(2), firstSeenBlock: 4_950_000 }, // recent
        { id: A(3), firstSeenBlock: 4_960_000 }, // recent
        { id: A(4), firstSeenBlock: 10 }, // old
        { id: A(5), firstSeenBlock: 20 }, // old
      ],
      [],
    );
    const d = runAgeRisk(makeInput({ graph, headBlock: 5_000_000 }));
    // 2/4 recent × weight 20 × 0.5 = 5
    expect(d.value).toBe(5);
    expect(d.summary).toContain("2/4 counterparties are recent");
  });

  it("handles unknown first-seen", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true, firstSeenBlock: null }], []);
    const d = runAgeRisk(makeInput({ graph, headBlock: 1_000_000 }));
    expect(d.value).toBe(0);
    expect(d.summary).toContain("First-seen block unknown");
  });
});

describe("③ honeypot / fee-on-transfer tax", () => {
  const thr = cfg.params.honeypotTaxThresholdPct;

  it(`fires when a sender-split fee exceeds ${thr}%`, () => {
    const Aa = A(1);
    const B = A(2);
    const C = A(3);
    const hash = "0x" + "ee".repeat(32);
    const transfers = [
      makeTransfer({ from: Aa, to: B, value: "900", hash, token: TOKEN }),
      makeTransfer({ from: Aa, to: C, value: "110", hash, logIndex: 1, token: TOKEN }),
    ];
    const d = runHoneypotTax(makeInput({ transfers }));
    expect(d.value).toBeGreaterThan(0);
    expect(d.evidence[0]).toBe(hash);
    expect(d.summary).toContain("Fee-on-transfer detected");
    // 110/900 = 12.2% → round(25 * 12.2/50) = 6
    expect(d.value).toBe(6);
  });

  it("stays 0 for a batch send (side leg too large)", () => {
    const hash = "0x" + "dd".repeat(32);
    const transfers = [
      makeTransfer({ from: A(1), to: A(2), value: "100", hash, token: TOKEN }),
      makeTransfer({ from: A(1), to: A(3), value: "100", hash, logIndex: 1, token: TOKEN }),
    ];
    expect(runHoneypotTax(makeInput({ transfers })).value).toBe(0);
  });

  it("stays 0 when the fee is below threshold", () => {
    const hash = "0x" + "cc".repeat(32);
    const transfers = [
      makeTransfer({ from: A(1), to: A(2), value: "950", hash, token: TOKEN }),
      makeTransfer({ from: A(1), to: A(3), value: "50", hash, logIndex: 1, token: TOKEN }), // 5%
    ];
    const d = runHoneypotTax(makeInput({ transfers }));
    expect(d.value).toBe(0);
    expect(d.summary).toContain("≤");
  });

  it("detects a collector-backed fee leg (two+ senders pay it)", () => {
    const collector = A(9);
    const mainTx = "0x" + "ab".repeat(32);
    const otherTx = "0x" + "cd".repeat(32);
    const transfers = [
      makeTransfer({ from: A(1), to: A(2), value: "900", hash: mainTx, token: TOKEN }),
      makeTransfer({ from: A(2), to: collector, value: "120", hash: mainTx, logIndex: 1, token: TOKEN }),
      makeTransfer({ from: A(7), to: collector, value: "30", hash: otherTx, token: TOKEN }), // second sender
    ];
    const d = runHoneypotTax(makeInput({ transfers }));
    expect(d.value).toBeGreaterThan(0); // 120/900 = 13.3%
  });

  it("ignores single-leg groups", () => {
    const transfers = [makeTransfer({ from: A(1), to: A(2), value: "1000", token: TOKEN })];
    const d = runHoneypotTax(makeInput({ transfers }));
    expect(d.value).toBe(0);
    expect(d.evidence).toHaveLength(0);
  });
});

describe("④ deployer reuse", () => {
  const mk = (creators: Record<string, string>) =>
    makeGraph(
      Object.entries(creators).map(([id, creator]) => ({ id, creator, kind: "contract" as const })),
      [],
    );

  it("scores 0 without shared creators", () => {
    expect(runDeployerReuse(makeInput({ graph: mk({ [A(2)]: A(50) }) })).value).toBe(0);
    expect(runDeployerReuse(makeInput({ graph: mk({ [A(2)]: A(50), [A(3)]: A(51) }) })).value).toBe(0);
  });

  it("earns partial credit at 2 contracts sharing a deployer", () => {
    const graph = mk({ [A(2)]: A(50), [A(3)]: A(50), [A(4)]: A(51) });
    const d = runDeployerReuse(makeInput({ graph }));
    expect(d.value).toBe(4); // round(15 * 1/4)
    expect(d.evidence[0]).toBe(A(50));
  });

  it("saturates at deployerReuseFullAt contracts", () => {
    const graph = mk({
      [A(2)]: A(50),
      [A(3)]: A(50),
      [A(4)]: A(50),
      [A(5)]: A(50),
      [A(6)]: A(50),
    });
    expect(runDeployerReuse(makeInput({ graph })).value).toBe(15);
  });
});

describe("⑤ approval-to-unlimited", () => {
  const MAX = (1n << 256n) - 1n;

  function approvalsFor(items: { owner: string; spender: string; amount: bigint; method?: string }[]) {
    return items.map((i) => ({
      owner: i.owner,
      spender: i.spender,
      amountHex: `0x${i.amount.toString(16).padStart(64, "0")}`,
      unlimited: i.amount >= BigInt(cfg.params.unlimitedApprovalMinHex),
      txHash: "0x" + "12".repeat(32),
      ...(i.method ? {} : {}),
    }));
  }

  it("scores 0 with no approvals", () => {
    expect(runApprovalRisk(makeInput({ approvals: [] })).value).toBe(0);
  });

  it("scores 0 for limited approvals only", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true }], []);
    const approvals = approvalsFor([{ owner: A(1), spender: A(2), amount: 1000n }]);
    const d = runApprovalRisk(makeInput({ graph, approvals }));
    expect(d.value).toBe(0);
    expect(d.summary).toContain("none unlimited");
  });

  it("earns base credit for one unlimited approval to an unknown spender", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true }], []);
    const approvals = approvalsFor([{ owner: A(1), spender: A(42), amount: MAX }]);
    const d = runApprovalRisk(makeInput({ graph, approvals }));
    expect(d.value).toBe(5); // round(15 * 1/3)
    expect(d.summary).toContain("unlabeled");
  });

  it("saturates at 3+ unlimited approvals", () => {
    const graph = makeGraph([{ id: A(1), isTarget: true }], []);
    const approvals = approvalsFor([
      { owner: A(1), spender: A(42), amount: MAX },
      { owner: A(1), spender: A(43), amount: MAX },
      { owner: A(1), spender: A(44), amount: MAX },
      { owner: A(1), spender: A(45), amount: MAX },
    ]);
    expect(runApprovalRisk(makeInput({ graph, approvals })).value).toBe(15);
  });

  it("discounts when every unlimited spender is labeled/verified", () => {
    const graph = makeGraph(
      [
        { id: A(1), isTarget: true },
        { id: A(42), label: "Uniswap Router", isVerified: true },
      ],
      [],
    );
    const approvals = approvalsFor([{ owner: A(1), spender: A(42), amount: MAX }]);
    const d = runApprovalRisk(makeInput({ graph, approvals }));
    expect(d.value).toBe(3); // round(15 * 1/3 * 0.6)
    expect(d.summary).toContain("discounted");
  });
});

describe("extractApprovals (calldata decode)", () => {
  it("decodes unlimited approve() and skips others", () => {
    const spender = A(42);
    const txs = [
      {
        hash: "0x" + "01".repeat(32),
        blockNumber: 1,
        timestamp: "",
        from: A(1),
        to: spender,
        value: "0",
        method: "approve(address,uint256)",
        rawInput: approveInput(spender, (1n << 256n) - 1n),
        fromIsContract: false,
        toIsContract: true,
        fromName: null,
        toName: null,
      },
      {
        hash: "0x" + "02".repeat(32),
        blockNumber: 2,
        timestamp: "",
        from: A(1),
        to: spender,
        value: "0",
        method: "approve(address,uint256)",
        rawInput: approveInput(spender, 5000n),
        fromIsContract: false,
        toIsContract: true,
        fromName: null,
        toName: null,
      },
      {
        hash: "0x" + "03".repeat(32),
        blockNumber: 3,
        timestamp: "",
        from: A(1),
        to: A(2),
        value: "1",
        method: "transfer(address,uint256)",
        rawInput: "0x",
        fromIsContract: false,
        toIsContract: false,
        fromName: null,
        toName: null,
      },
    ];
    const out = extractApprovals(txs, cfg.params.unlimitedApprovalMinHex);
    expect(out).toHaveLength(2);
    expect(out[0].unlimited).toBe(true);
    expect(out[0].spender).toBe(spender);
    expect(out[0].owner).toBe(A(1));
    expect(out[1].unlimited).toBe(false);
  });

  it("detects approve by selector even when method label is missing", () => {
    const spender = A(7);
    const txs = [
      {
        hash: "0x" + "04".repeat(32),
        blockNumber: 1,
        timestamp: "",
        from: A(1),
        to: spender,
        value: "0",
        method: null,
        rawInput: approveInput(spender, (1n << 256n) - 1n),
        fromIsContract: false,
        toIsContract: false,
        fromName: null,
        toName: null,
      },
    ];
    expect(extractApprovals(txs, cfg.params.unlimitedApprovalMinHex)).toHaveLength(1);
  });

  it("ignores non-approve transactions", () => {
    const txs = [
      {
        hash: "0x" + "05".repeat(32),
        blockNumber: 1,
        timestamp: "",
        from: A(1),
        to: A(2),
        value: "0",
        method: "swap",
        rawInput: "0xdeadbeef",
        fromIsContract: false,
        toIsContract: false,
        fromName: null,
        toName: null,
      },
    ];
    expect(extractApprovals(txs, cfg.params.unlimitedApprovalMinHex)).toHaveLength(0);
  });
});
