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

// No demo transactions. Routebook decodes only real on-chain transactions.
export const DEMO_TXS: DecodedTx[] = [];

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
