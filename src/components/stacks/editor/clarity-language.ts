// Registers a Clarity language mode with Monaco (Monarch tokenizer + a small
// completion set). Same conversion pattern DevStation uses for its other
// non-JS languages. Idempotent — safe to call on every editor mount.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function registerClarity(monaco: any) {
  if (!monaco) return;
  if (monaco.languages.getLanguages().some((l: any) => l.id === "clarity")) return;

  monaco.languages.register({ id: "clarity", extensions: [".clar"] });

  monaco.languages.setMonarchTokensProvider("clarity", {
    keywords: [
      "define-public",
      "define-private",
      "define-read-only",
      "define-data-var",
      "define-map",
      "define-constant",
      "define-fungible-token",
      "define-non-fungible-token",
      "define-trait",
      "impl-trait",
      "use-trait",
      "let",
      "begin",
      "if",
      "asserts!",
      "try!",
      "unwrap!",
      "unwrap-err!",
      "unwrap-panic",
      "match",
      "ok",
      "err",
      "some",
      "none",
      "print",
      "map-get?",
      "map-set",
      "map-insert",
      "map-delete",
      "var-get",
      "var-set",
      "ft-transfer?",
      "ft-mint?",
      "ft-burn?",
      "ft-get-balance",
      "ft-get-supply",
      "nft-transfer?",
      "nft-mint?",
      "nft-burn?",
      "nft-get-owner?",
      "stx-transfer?",
      "stx-burn?",
      "contract-call?",
      "as-contract",
      "is-eq",
      "is-some",
      "is-none",
      "is-ok",
      "is-err",
      "and",
      "or",
      "not",
      "fold",
      "map",
      "filter",
      "len",
      "concat",
      "append",
    ],
    typeKeywords: [
      "uint",
      "int",
      "bool",
      "principal",
      "buff",
      "string-ascii",
      "string-utf8",
      "optional",
      "response",
      "list",
      "tuple",
    ],
    builtins: ["tx-sender", "contract-caller", "block-height", "burn-block-height", "true", "false"],
    tokenizer: {
      root: [
        [/;;.*$/, "comment"],
        [/u\d+/, "number"],
        [/\b\d+\b/, "number"],
        [/0x[0-9a-fA-F]+/, "number.hex"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[A-Z0-9]+(\.[a-z0-9-]+)?/, "type.identifier"], // principals
        [
          /[a-zA-Z_][\w!?*+.<>=/-]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@builtins": "constant",
              "@default": "identifier",
            },
          },
        ],
        [/[()]/, "@brackets"],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider("clarity", {
    provideCompletionItems: () => ({
      suggestions: [
        { label: "define-public", kind: monaco.languages.CompletionItemKind.Keyword, insertText: "(define-public (${1:name} (${2:arg} ${3:type}))\n  ${0}\n)" },
        { label: "define-read-only", kind: monaco.languages.CompletionItemKind.Keyword, insertText: "(define-read-only (${1:name})\n  ${0}\n)" },
        { label: "ft-transfer?", kind: monaco.languages.CompletionItemKind.Function, insertText: "(ft-transfer? ${1:token} ${2:amount} ${3:sender} ${4:recipient})" },
        { label: "nft-transfer?", kind: monaco.languages.CompletionItemKind.Function, insertText: "(nft-transfer? ${1:asset} ${2:id} ${3:sender} ${4:recipient})" },
        { label: "stx-transfer?", kind: monaco.languages.CompletionItemKind.Function, insertText: "(stx-transfer? ${1:amount} ${2:sender} ${3:recipient})" },
        { label: "contract-call?", kind: monaco.languages.CompletionItemKind.Function, insertText: "(contract-call? ${1:'contract} ${2:fn} ${3:args})" },
        { label: "asserts!", kind: monaco.languages.CompletionItemKind.Snippet, insertText: "(asserts! ${1:condition} ${2:err})" },
      ],
    }),
  } as any);
}
