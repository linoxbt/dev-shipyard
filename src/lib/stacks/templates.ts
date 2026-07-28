// Clarity contract templates for Stacks. Each template ships with its
// contract source AND the matching post-conditions (the `Pc` builder snippet a
// frontend should attach when calling it) — so templates are worked examples of
// safe transfers, not just boilerplate. The Post-Condition Auditor
// (src/lib/stacks/audit.ts) is run against each at authoring time to verify zero
// `uncovered` transfer paths.

export type StacksTemplateKind = "token" | "nft" | "payment";

export interface StacksTemplate {
  id: string;
  name: string;
  kind: StacksTemplateKind;
  category: string;
  description: string;
  /** Default deployed contract name (address.name). */
  contractName: string;
  clarity: string;
  /** The matching post-condition builder snippet (illustrative, for the calling dApp). */
  postConditions: string;
}

const SIP010 = `;; SIP-010 fungible token
(define-fungible-token devtoken)
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) err-not-token-owner)
    (try! (ft-transfer? devtoken amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ft-mint? devtoken amount recipient)))

(define-read-only (get-balance (who principal)) (ok (ft-get-balance devtoken who)))
(define-read-only (get-total-supply) (ok (ft-get-supply devtoken)))
(define-read-only (get-name) (ok "DevStation Token"))
(define-read-only (get-symbol) (ok "DEV"))
(define-read-only (get-decimals) (ok u6))
(define-read-only (get-token-uri) (ok none))
`;

const SIP009 = `;; SIP-009 non-fungible token
(define-non-fungible-token devnft uint)
(define-data-var last-id uint u0)
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))

(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) err-not-token-owner)
    (nft-transfer? devnft id sender recipient)))

(define-public (mint (recipient principal))
  (let ((id (+ (var-get last-id) u1)))
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (try! (nft-mint? devnft id recipient))
    (var-set last-id id)
    (ok id)))

(define-read-only (get-last-token-id) (ok (var-get last-id)))
(define-read-only (get-owner (id uint)) (ok (nft-get-owner? devnft id)))
(define-read-only (get-token-uri (id uint)) (ok none))
`;

const SBTC = `;; sBTC payment forwarder — moves sBTC from the caller to a recipient.
;; Replace the sBTC principal with the testnet deployment when on testnet.
(define-constant sbtc 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-public (pay (amount uint) (recipient principal))
  (contract-call? sbtc transfer amount tx-sender recipient none))
`;

export const STACKS_CATEGORIES = ["Token", "NFT", "Payment"] as const;

export const STACKS_TEMPLATES: StacksTemplate[] = [
  {
    id: "sip-010-token",
    name: "SIP-010 Fungible Token",
    kind: "token",
    category: "Token",
    description:
      "A standard SIP-010 fungible token with mint + transfer. Ships with the exact transfer post-condition, pre-audited to zero uncovered transfer paths.",
    contractName: "dev-token",
    clarity: SIP010,
    postConditions: "Pc.principal(sender).willSendEq(amount).ft(`\${deployer}.dev-token`, 'devtoken')",
  },
  {
    id: "sip-009-nft",
    name: "SIP-009 NFT",
    kind: "nft",
    category: "NFT",
    description:
      "A standard SIP-009 non-fungible token with mint + transfer, paired with the matching NFT transfer post-condition.",
    contractName: "dev-nft",
    clarity: SIP009,
    postConditions: "Pc.principal(sender).willSendAsset().nft(`\${deployer}.dev-nft`, 'devnft', Cl.uint(id))",
  },
  {
    id: "sbtc-payment",
    name: "sBTC Payment",
    kind: "payment",
    category: "Payment",
    description:
      "Forwards sBTC from the caller to a recipient via a contract-call. Ships with the exact principal/asset post-condition that's easy to get wrong.",
    contractName: "sbtc-pay",
    clarity: SBTC,
    postConditions: "Pc.principal(tx-sender).willSendEq(amount).ft(`\${sbtc}`, 'sbtc')",
  },
];

export function stacksTemplate(id: string): StacksTemplate | undefined {
  return STACKS_TEMPLATES.find((t) => t.id === id);
}

export function stacksCategoryColor(category: string): string {
  switch (category) {
    case "Token":
      return "text-info border-info/40 bg-info/10";
    case "NFT":
      return "text-primary border-primary/40 bg-primary/10";
    case "Payment":
      return "text-warning border-warning/40 bg-warning/10";
    default:
      return "text-meta border-border bg-surface-2";
  }
}
