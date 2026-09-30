"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortAddr } from "@/lib/format";
import { loadRecentAddresses } from "@/lib/client-storage";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function AddressBar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    // localStorage only exists in the browser; sync once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(loadRecentAddresses());
  }, []);

  const go = (raw: string) => {
    const addr = raw.trim();
    if (!ADDRESS_RE.test(addr)) {
      setError("Enter a valid 0x address (40 hex characters).");
      return;
    }
    setError(null);
    router.push(`/${addr}`);
  };

  return (
    <div className="w-full">
      <form
        className={`flex gap-2 ${compact ? "" : "sm:flex-row flex-col"}`}
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          go(value);
        }}
      >
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="0x… paste a Base Sepolia address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Address to analyze"
          aria-invalid={Boolean(error)}
          className={`h-11 font-mono text-sm ${compact ? "w-full" : "sm:flex-1"}`}
        />
        <Button type="submit" className="h-11 px-6 font-semibold">
          Analyze
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-risk-high">
          {error}
        </p>
      )}
      {!compact && recent.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Recent:</span>
          {recent.map((addr) => (
            <button
              key={addr}
              type="button"
              onClick={() => go(addr)}
              className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              title={addr}
            >
              {shortAddr(addr)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
