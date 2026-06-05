// Pre-decoded demo transactions for Routebook.
export type CallType = "user" | "internal" | "view" | "failed";

export interface DecodedArg {
  name: string;
  type: string;
  value: string;
  display?: string;
}
export interface DecodedEvent {
  name: string;
  args: DecodedArg[];
  isApproval?: boolean;
}
export interface RouteCall {
  id: string;
  type: CallType;
  contractAddress: string;
  contractName?: string; // resolved label, optional
  fn: string; // e.g. swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
  args: DecodedArg[];
  returns?: DecodedArg[];
  events: DecodedEvent[];
  gasUsed: number;
  children: RouteCall[];
}

export interface TokenTransfer {
  token: string; // address
  tokenSymbol: string;
  from: string;
  to: string;
  amount: string; // human readable
  raw: string; // wei
}

export interface ApprovalRecord {
  token: string;
  tokenSymbol: string;
  owner: string;
  spender: string;
  spenderLabel?: string;
  amount: string;
  unlimited: boolean;
  risk: "Low" | "Medium" | "High";
}

export interface DecodedTx {
  hash: string;
  status: "SUCCESS" | "REVERTED";
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  toName?: string;
  value: string; // QIE
  gasUsed: number;
  gasPriceGwei: number;
  gasCostQIE: number;
  revertReason?: string;
  revertExplain?: string;
  revertFix?: string;
  route: RouteCall;
  tokenTransfers: TokenTransfer[];
  approvals: ApprovalRecord[];
}

const TX1_HASH = "0x9f2a4e8b1c7d3a5e6f4b8c2d1e9a3f7b5c6d8e2a1f4b7c9d3e5a8b2c4d6e7f9a";
const TX2_HASH = "0x3e7c9b2d4a8f1e6c5b3d9a7f2e4c8b1d6a3f5e9c2b7d4a8e1f3c6b9d5e2a4f7c";

export const DEMO_TXS: DecodedTx[] = [
  {
    hash: TX1_HASH,
    status: "SUCCESS",
    blockNumber: 4_318_287,
    timestamp: Date.now() - 1000 * 60 * 8,
    from: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
    to: "0xDEX0000000000000000000000000000000000001",
    toName: "QIE DEX Router",
    value: "0",
    gasUsed: 184_502,
    gasPriceGwei: 1.2,
    gasCostQIE: 0.000221,
    route: {
      id: "r",
      type: "user",
      contractAddress: "0xDEX0000000000000000000000000000000000001",
      contractName: "QIE DEX Router",
      fn: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
      args: [
        { name: "amountIn", type: "uint256", value: "5000000000000000000", display: "5.0 QIE" },
        { name: "amountOutMin", type: "uint256", value: "1850000000", display: "1.85 USDQ" },
        { name: "path", type: "address[]", value: "[QIE, USDQ]", display: "QIE → USDQ" },
        { name: "to", type: "address", value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB" },
        { name: "deadline", type: "uint256", value: "1717612800" },
      ],
      events: [],
      gasUsed: 184_502,
      children: [
        {
          id: "r.1",
          type: "internal",
          contractAddress: "0x5747AB1E0000000000000000000000000000ST1",
          contractName: "QIE Stable",
          fn: "transferFrom(address,address,uint256)",
          args: [
            { name: "from", type: "address", value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB" },
            { name: "to", type: "address", value: "0xBEEF0000000000000000000000000000000B0001" },
            { name: "amount", type: "uint256", value: "5000000000000000000", display: "5.0 QIE" },
          ],
          events: [
            {
              name: "Transfer",
              args: [
                {
                  name: "from",
                  type: "address",
                  value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
                },
                {
                  name: "to",
                  type: "address",
                  value: "0xBEEF0000000000000000000000000000000B0001",
                },
                { name: "amount", type: "uint256", value: "5.0 QIE" },
              ],
            },
          ],
          gasUsed: 42_318,
          children: [],
        },
        {
          id: "r.2",
          type: "internal",
          contractAddress: "0xBEEF0000000000000000000000000000000B0001",
          contractName: "BeefSwap Pair: QIE/USDQ",
          fn: "swap(uint256,uint256,address,bytes)",
          args: [
            { name: "amount0Out", type: "uint256", value: "0" },
            { name: "amount1Out", type: "uint256", value: "1882350000", display: "1.88 USDQ" },
            { name: "to", type: "address", value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB" },
            { name: "data", type: "bytes", value: "0x" },
          ],
          events: [
            {
              name: "Swap",
              args: [
                {
                  name: "sender",
                  type: "address",
                  value: "0xDEX0000000000000000000000000000000000001",
                },
                { name: "amountIn", type: "uint256", value: "5.0 QIE" },
                { name: "amountOut", type: "uint256", value: "1.88 USDQ" },
              ],
            },
          ],
          gasUsed: 121_402,
          children: [
            {
              id: "r.2.1",
              type: "internal",
              contractAddress: "0xUSDQ000000000000000000000000000000000001",
              contractName: "USDQ",
              fn: "transfer(address,uint256)",
              args: [
                {
                  name: "to",
                  type: "address",
                  value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
                },
                { name: "amount", type: "uint256", value: "1882350000", display: "1.88 USDQ" },
              ],
              events: [
                {
                  name: "Transfer",
                  args: [
                    {
                      name: "from",
                      type: "address",
                      value: "0xBEEF0000000000000000000000000000000B0001",
                    },
                    {
                      name: "to",
                      type: "address",
                      value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
                    },
                    { name: "amount", type: "uint256", value: "1.88 USDQ" },
                  ],
                },
              ],
              gasUsed: 31_205,
              children: [],
            },
          ],
        },
        {
          id: "r.3",
          type: "view",
          contractAddress: "0x04AC1E0000000000000000000000000000000001",
          contractName: "QIE Oracle",
          fn: "getRate()",
          args: [],
          returns: [{ name: "rate", type: "uint256", value: "380000000", display: "$0.38" }],
          events: [],
          gasUsed: 2_104,
          children: [],
        },
      ],
    },
    tokenTransfers: [
      {
        token: "0x5747AB1E0000000000000000000000000000ST1",
        tokenSymbol: "QIE",
        from: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
        to: "0xBEEF0000000000000000000000000000000B0001",
        amount: "5.0",
        raw: "5000000000000000000",
      },
      {
        token: "0xUSDQ000000000000000000000000000000000001",
        tokenSymbol: "USDQ",
        from: "0xBEEF0000000000000000000000000000000B0001",
        to: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
        amount: "1.88",
        raw: "1882350000",
      },
    ],
    approvals: [],
  },
  {
    hash: TX2_HASH,
    status: "REVERTED",
    blockNumber: 4_318_301,
    timestamp: Date.now() - 1000 * 60 * 3,
    from: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB",
    to: "0x9a3F1c2D4e5B6a7C8d9E0f1A2b3C4d5E6f7A8b9C",
    toName: "Genesis Pass",
    value: "0",
    gasUsed: 58_207,
    gasPriceGwei: 1.2,
    gasCostQIE: 0.0000698,
    revertReason: "ERC20: insufficient allowance",
    revertExplain:
      "The Genesis Pass contract attempted to call transferFrom on the QIE Stable token, but the allowance from your wallet to the contract was less than the requested amount (1.0 QIE Stable).",
    revertFix:
      "Call approve() on QIE Stable for the Genesis Pass contract with at least 1.0 QIE Stable, then retry mint().",
    route: {
      id: "r",
      type: "user",
      contractAddress: "0x9a3F1c2D4e5B6a7C8d9E0f1A2b3C4d5E6f7A8b9C",
      contractName: "Genesis Pass",
      fn: "mint(address)",
      args: [{ name: "to", type: "address", value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB" }],
      events: [],
      gasUsed: 58_207,
      children: [
        {
          id: "r.1",
          type: "failed",
          contractAddress: "0x5747AB1E0000000000000000000000000000ST1",
          contractName: "QIE Stable",
          fn: "transferFrom(address,address,uint256)",
          args: [
            { name: "from", type: "address", value: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB" },
            { name: "to", type: "address", value: "0x9a3F1c2D4e5B6a7C8d9E0f1A2b3C4d5E6f7A8b9C" },
            {
              name: "amount",
              type: "uint256",
              value: "1000000000000000000",
              display: "1.0 QIE Stable",
            },
          ],
          events: [],
          gasUsed: 12_104,
          children: [],
        },
      ],
    },
    tokenTransfers: [],
    approvals: [],
  },
];

export function findDemoTx(hash: string) {
  const h = hash.toLowerCase();
  return DEMO_TXS.find((t) => t.hash.toLowerCase() === h);
}

export const REVERT_PATTERNS: Record<string, { explain: string; fix: string }> = {
  "ERC20: insufficient allowance": {
    explain: "A contract tried to spend tokens on your behalf, but you haven't approved enough.",
    fix: "Call approve() on the token with a sufficient amount, then retry.",
  },
  "ERC20: transfer amount exceeds balance": {
    explain: "The sender doesn't have enough tokens.",
    fix: "Fund the sender or reduce the amount.",
  },
  "Ownable: caller is not the owner": {
    explain: "This function is restricted to the contract owner.",
    fix: "Call from the owner wallet, or transfer ownership first.",
  },
  "Pausable: paused": {
    explain: "The contract is paused and rejecting state-changing calls.",
    fix: "Wait for the owner to unpause, or contact the project.",
  },
  "Deadline expired": {
    explain: "The transaction deadline was reached before execution.",
    fix: "Retry with a later deadline parameter.",
  },
};
