import type { Metadata } from "next";
import { AnalysisView } from "@/components/AnalysisView";
import { shortAddr } from "@/lib/format";

interface AddrPageProps {
  params: Promise<{ addr: string }>;
}

export async function generateMetadata({ params }: AddrPageProps): Promise<Metadata> {
  const { addr } = await params;
  return {
    title: `Risk graph for ${shortAddr(safeDecode(addr), 10, 8)}`,
    description:
      "Live transfer graph, deterministic 0–100 heuristic score, and a guarded LLM verdict that must cite an exact evidence path.",
  };
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function AddressPage({ params }: AddrPageProps) {
  const { addr } = await params;
  return <AnalysisView address={safeDecode(addr)} />;
}
