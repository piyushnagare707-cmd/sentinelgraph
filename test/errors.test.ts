import { describe, expect, it } from "vitest";
import { AppError, isAppError, statusFor, toAppError } from "@/lib/errors";

describe("AppError", () => {
  it("maps every code to its HTTP status", () => {
    expect(new AppError("invalid-address", "x").status).toBe(400);
    expect(new AppError("not-found", "x").status).toBe(404);
    expect(new AppError("rate-limited", "x").status).toBe(429);
    expect(new AppError("upstream-error", "x").status).toBe(502);
    expect(new AppError("timeout", "x").status).toBe(504);
    expect(new AppError("internal", "x").status).toBe(500);
  });
});

describe("isAppError", () => {
  it("recognises AppError instances only", () => {
    expect(isAppError(new AppError("internal", "x"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError("x")).toBe(false);
  });
});

describe("toAppError", () => {
  it("passes AppError through unchanged", () => {
    const original = new AppError("not-found", "gone");
    expect(toAppError(original)).toBe(original);
  });

  it("maps TimeoutError to a timeout code", () => {
    const e = new Error("slow");
    e.name = "TimeoutError";
    const app = toAppError(e);
    expect(app.code).toBe("timeout");
    expect(app.message).toBe("Upstream request timed out");
  });

  it("wraps plain errors as internal", () => {
    expect(toAppError(new Error("boom")).code).toBe("internal");
    expect(toAppError(new Error("boom")).message).toBe("boom");
  });

  it("wraps non-errors as internal", () => {
    const app = toAppError("string failure");
    expect(app.code).toBe("internal");
    expect(app.message).toBe("string failure");
  });
});

describe("statusFor", () => {
  it("returns 500 for anything that is not an AppError", () => {
    expect(statusFor(new Error("x"))).toBe(500);
    expect(statusFor(new AppError("rate-limited", "x"))).toBe(429);
  });
});
