import { useEffect, useRef } from "react";
import Editor, { useMonaco, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface CompileDiagnostic {
  severity: "error" | "warning";
  message: string;
  sourceLocation?: { file: string; start: number; end: number };
}

interface Props {
  value: string;
  filename: string;
  onChange: (value: string) => void;
  diagnostics?: CompileDiagnostic[];
  /** Reveal + place the cursor on a line. Bump `nonce` to re-trigger the same line. */
  gotoLine?: { line: number; nonce: number };
}

export function SolidityEditor({ value, filename, onChange, diagnostics, gotoLine }: Props) {
  const monaco = useMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<editor.ITextModel | null>(null);

  // Register Solidity language
  useEffect(() => {
    if (!monaco) return;
    const langs = monaco.languages.getLanguages();
    if (langs.some((l) => l.id === "sol")) return;

    monaco.languages.register({ id: "sol", extensions: [".sol"] });
    monaco.languages.setMonarchTokensProvider("sol", {
      keywords: [
        "pragma",
        "solidity",
        "contract",
        "interface",
        "library",
        "function",
        "modifier",
        "event",
        "constructor",
        "fallback",
        "receive",
        "mapping",
        "struct",
        "enum",
        "storage",
        "memory",
        "calldata",
        "public",
        "private",
        "internal",
        "external",
        "pure",
        "view",
        "payable",
        "returns",
        "return",
        "if",
        "else",
        "for",
        "while",
        "do",
        "break",
        "continue",
        "new",
        "delete",
        "emit",
        "try",
        "catch",
        "revert",
        "require",
        "assert",
        "import",
        "from",
        "as",
        "is",
        "using",
        "override",
        "virtual",
        "abstract",
        "immutable",
        "constant",
        "unchecked",
        "assembly",
      ],
      typeKeywords: [
        "address",
        "bool",
        "string",
        "bytes",
        "int",
        "uint",
        "int8",
        "int16",
        "int32",
        "int64",
        "int128",
        "int256",
        "uint8",
        "uint16",
        "uint32",
        "uint64",
        "uint128",
        "uint256",
        "bytes1",
        "bytes2",
        "bytes4",
        "bytes8",
        "bytes16",
        "bytes32",
      ],
      operators: [
        "=",
        ">",
        "<",
        "!",
        "~",
        "?",
        ":",
        "==",
        "<=",
        ">=",
        "!=",
        "&&",
        "||",
        "++",
        "--",
        "+",
        "-",
        "*",
        "/",
        "&",
        "|",
        "^",
        "%",
        "<<",
        ">>",
        "+=",
        "-=",
        "*=",
        "/=",
      ],
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"/, "string", "@string"],
          [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
          [/0[xX][0-9a-fA-F]+/, "number.hex"],
          [/\d+/, "number"],
          [/[{}()[\]]/, "@brackets"],
          [
            /[a-zA-Z_]\w*/,
            {
              cases: { "@keywords": "keyword", "@typeKeywords": "type", "@default": "identifier" },
            },
          ],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, "string", "@pop"],
        ],
      },
    });

    // Lightweight autocomplete. The `as never` cast satisfies monaco-editor 0.55
    // which requires a `range` on each CompletionItem; range is optional at
    // runtime — Monaco computes it from the cursor position when absent.
    monaco.languages.registerCompletionItemProvider("sol", {
      provideCompletionItems: () => ({
        suggestions: [
          {
            label: "contract",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: "contract ${1:Name} {\n\t$0\n}",
          },
          {
            label: "function",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText:
              "function ${1:name}(${2}) ${3|public,private,internal,external|} ${4:returns} {\n\t$0\n}",
          },
          {
            label: "mapping",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: "mapping(${1:address} => ${2:uint256})",
          },
          {
            label: "event",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: "event ${1:Name}(${2});",
          },
          {
            label: "modifier",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: "modifier ${1:name} {\n\t$0\n\t_;\n}",
          },
          {
            label: "constructor",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: "constructor(${1}) {\n\t$0\n}",
          },
          {
            label: "require",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'require(${1:condition}, "${2:reason}");',
          },
          {
            label: "emit",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "emit ${1:event}(${2});",
          },
          {
            label: "import",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'import "${1:path}";',
          },
        ],
      }),
    } as never);
  }, [monaco]);

  // Apply diagnostics as markers
  useEffect(() => {
    if (!monaco || !editorRef.current || !diagnostics) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const markers = diagnostics
      .filter((d) => d.sourceLocation)
      .map((d) => {
        const text = model.getValue();
        const start = offsetToLineCol(text, d.sourceLocation!.start);
        const end = offsetToLineCol(text, d.sourceLocation!.end);
        return {
          severity:
            d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: start.line,
          startColumn: start.col,
          endLineNumber: end.line,
          endColumn: end.col + 1,
        };
      });
    monaco.editor.setModelMarkers(model, "solidity", markers);
  }, [monaco, diagnostics]);

  // Jump to a line when asked (Inspector / error card clicks).
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !gotoLine || gotoLine.line < 1) return;
    ed.revealLineInCenter(gotoLine.line);
    ed.setPosition({ lineNumber: gotoLine.line, column: 1 });
    ed.focus();
  }, [gotoLine]);

  return (
    <Editor
      height="100%"
      language="sol"
      value={value}
      theme="vs-dark"
      onChange={(v) => onChange(v ?? "")}
      onMount={(ed) => {
        editorRef.current = ed;
        modelRef.current = ed.getModel();
      }}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        lineNumbers: "on",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 4,
        automaticLayout: true,
        padding: { top: 12 },
        bracketPairColorization: { enabled: true },
        matchBrackets: "always",
        autoClosingBrackets: "always",
        autoClosingQuotes: "always",
        smoothScrolling: true,
      }}
    />
  );
}

function offsetToLineCol(text: string, offset: number) {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length, col: (lines[lines.length - 1]?.length ?? 0) + 1 };
}
