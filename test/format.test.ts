import { describe, expect, it } from "vitest";
import {
  formatMs,
  formatTokenAmount,
  NEXT_ACTION_LABEL,
  scoreTone,
  shortAddr,
  toneClasses,
  TONE_TEXT,
  VERDICT_LABEL,
  verdictTone,
} from "@/lib/format";
import { DEMO_ADDRESSES } from "@/lib/demo";

describe("shortAddr", () => {
  it("elides the middle of a long address", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("leaves short values untouched", () => {
    expect(shortAddr("0xabc", 6, 4)).toBe("0xabc");
  });
});

describe("formatMs", () => {
  it("renders sub-second values in ms", () => {
    expect(formatMs(24)).toBe("24 ms");
    expect(formatMs(999.6)).toBe("1000 ms");
  });

  it("renders seconds with two decimals", () => {
    expect(formatMs(1670)).toBe("1.67 s");
  });

  it("handles invalid numbers", () => {
    expect(formatMs(-1)).toBe("—");
    expect(formatMs(Number.NaN)).toBe("—");
  });
});

describe("tone mapping", () => {
  it("maps verdicts to tones", () => {
    expect(verdictTone("clear")).toBe("clear");
    expect(verdictTone("suspicious")).toBe("warn");
    expect(verdictTone("high-risk")).toBe("high");
    expect(verdictTone("insufficient-evidence")).toBe("muted");
    expect(verdictTone("wat")).toBe("info");
  });

  it("derives score tone from bands when no verdict is given", () => {
    expect(scoreTone(10)).toBe("clear");
    expect(scoreTone(45)).toBe("warn");
    expect(scoreTone(80)).toBe("high");
    expect(scoreTone(80, "clear")).toBe("clear");
  });

  it("provides classes and colors for every tone", () => {
    for (const tone of ["clear", "warn", "high", "info", "muted"] as const) {
      expect(toneClasses(tone)).toContain("text-");
      expect(TONE_TEXT[tone]).toBeTruthy();
    }
  });

  it("labels every verdict and next action", () => {
    expect(Object.keys(VERDICT_LABEL)).toHaveLength(4);
    expect(Object.keys(NEXT_ACTION_LABEL)).toHaveLength(3);
    expect(VERDICT_LABEL["high-risk"]).toBe("HIGH RISK");
  });
});

describe("formatTokenAmount", () => {
  it("scales raw units by decimals", () => {
    expect(formatTokenAmount("1500000", 6)).toBe("1.5");
    expect(formatTokenAmount("1000000000000000000", 18)).toBe("1");
    expect(formatTokenAmount("0", 18)).toBe("0");
  });

  it("truncates long fractions to 4 digits", () => {
    expect(formatTokenAmount("1234567", 6)).toBe("1.2345");
  });

  it("defaults missing decimals to 18", () => {
    expect(formatTokenAmount("1000000000000000000", null)).toBe("1");
  });

  it("returns raw input when unparsable", () => {
    expect(formatTokenAmount("not-a-number", 6)).toBe("not-a-number");
  });
});

describe("demo addresses", () => {
  it("ships at least three verified-live entries", () => {
    expect(DEMO_ADDRESSES.length).toBeGreaterThanOrEqual(3);
    for (const d of DEMO_ADDRESSES) {
      expect(d.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
});
