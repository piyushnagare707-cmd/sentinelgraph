export interface DemoAddress {
  address: string;
  label: string;
  blurb: string;
}

/** Verified live on Base Sepolia — each has full transfer + tx activity. */
export const DEMO_ADDRESSES: DemoAddress[] = [
  {
    address: "0xFaEc9cDC3Ef75713b48f46057B98BA04885e3391",
    label: "Active wallet",
    blurb: "Busy EOA — 200+ transfers to graph",
  },
  {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    label: "USDC (token contract)",
    blurb: "FiatTokenProxy — deployer reuse check",
  },
  {
    address: "0x1c26B1021CaFC79055422aE3e7409F431F5224Ad",
    label: "Second wallet",
    blurb: "Another active EOA to compare verdicts",
  },
];
