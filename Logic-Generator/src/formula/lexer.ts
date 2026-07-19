import { FormulaError, type Token } from "./tokens";

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c);

/**
 * Tokenize a formula source string.
 * - `//` starts a line comment.
 * - Newlines and `;` become `newline` separators (collapsed).
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const pushNewline = (pos: number) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === "newline") return; // collapse
    if (tokens.length === 0) return; // ignore leading blank lines
    tokens.push({ type: "newline", value: "\\n", pos });
  };

  while (i < n) {
    const c = src[i];

    if (c === "\n") {
      pushNewline(i);
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === ";") {
      pushNewline(i);
      i++;
      continue;
    }
    // line comment
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      const start = i;
      while (i < n && isDigit(src[i])) i++;
      if (src[i] === ".") {
        i++;
        while (i < n && isDigit(src[i])) i++;
      }
      // exponent
      if (src[i] === "e" || src[i] === "E") {
        let j = i + 1;
        if (src[j] === "+" || src[j] === "-") j++;
        if (isDigit(src[j] ?? "")) {
          i = j;
          while (i < n && isDigit(src[i])) i++;
        }
      }
      tokens.push({ type: "number", value: src.slice(start, i), pos: start });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i])) i++;
      tokens.push({ type: "ident", value: src.slice(start, i), pos: start });
      continue;
    }

    switch (c) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "^":
        tokens.push({ type: "op", value: c, pos: i });
        i++;
        continue;
      case "(":
        tokens.push({ type: "lparen", value: c, pos: i });
        i++;
        continue;
      case ")":
        tokens.push({ type: "rparen", value: c, pos: i });
        i++;
        continue;
      case ",":
        tokens.push({ type: "comma", value: c, pos: i });
        i++;
        continue;
      case "=":
        tokens.push({ type: "assign", value: c, pos: i });
        i++;
        continue;
      default:
        throw new FormulaError(`Unexpected character '${c}'`, i);
    }
  }

  // drop trailing newline
  while (tokens.length && tokens[tokens.length - 1].type === "newline") {
    tokens.pop();
  }
  tokens.push({ type: "eof", value: "", pos: n });
  return tokens;
}
