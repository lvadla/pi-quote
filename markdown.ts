import type { Component } from "@earendil-works/pi-tui";
import { Lexer, Tokenizer, type Token, type TokensList } from "marked";
import { renderedCells, type Cell } from "./selection.ts";

type CachedBlock = { width: number; nextTokenType?: string; lines: string[]; highlightedCode: Map<string, string[]> };
// Pi's private Markdown rendering contract. Occurrences come from token order,
// never from cache keys: identical raw blocks can share a cache entry.
type Markdown = Component & {
  paddingX: number; paddingY: number;
  cachedTokens?: WeakRef<{ source: string; tokens: TokensList }>;
  blocks?: WeakRef<Map<string, CachedBlock>>;
  blockHighlightedCode?: CachedBlock["highlightedCode"];
  renderBlock(block: CachedBlock, token: Token, next: string | undefined, width: number, contentWidth: number): void;
};
const definitions = new Tokenizer();
new Lexer({ tokenizer: definitions }); // Initialize Marked's definition grammar.

function sourceSpans(source: string, tokens: TokensList) {
  let text = "";
  const offsets: number[] = [];
  // Pi expands tabs; Marked normalizes newlines. Keep original UTF-16 offsets.
  for (let i = 0; i < source.length; i++) {
    const value = source[i] === "\t" ? "   " : source[i] === "\r" ? "\n" : source[i];
    text += value;
    for (let j = 0; j < value.length; j++) offsets.push(i);
    if (source[i] === "\r" && source[i + 1] === "\n") i++;
  }
  offsets.push(source.length);
  let cursor = 0;
  const definition = () => {
    if (cursor && text[cursor - 1] !== "\n") return;
    const token = definitions.def(text.slice(cursor));
    return token && Object.hasOwn(tokens.links, token.tag) ? token : undefined;
  };
  const skipDefinitions = () => {
    let token;
    while ((token = definition())) cursor += token.raw.length;
  };
  const whitespace = (raw: string) => {
    if (/\S/u.test(raw)) return false;
    for (const char of raw) {
      skipDefinitions();
      if (text[cursor++] !== char) return false;
    }
    return true;
  };
  const spans: { start: number; end: number }[] = [];
  for (const token of tokens) {
    let start = cursor;
    if (token.type === "space") {
      if (!whitespace(token.raw)) return;
    } else if (token.type === "def") {
      const expected = definitions.def(token.raw);
      if (!expected) return;
      let actual = definition();
      while (actual && actual.raw !== expected.raw) {
        cursor += actual.raw.length;
        actual = definition();
      }
      if (!actual) return;
      start = cursor;
      cursor += actual.raw.length;
      // The lexer drops repeated definitions, but can append their following
      // newlines to an earlier token. They still occupy original source space.
      if (!whitespace(token.raw.slice(actual.raw.length))) return;
    } else {
      skipDefinitions();
      start = cursor;
      if (!text.startsWith(token.raw, cursor)) return;
      cursor += token.raw.length;
    }
    spans.push({ start: offsets[start], end: offsets[cursor] });
  }
  skipDefinitions();
  return cursor === text.length ? spans : undefined;
}

export function markdownLayout(component: Component, source: string, width: number, render: () => string[]) {
  const md = component as Markdown;
  let lines = render();
  const unavailable = () => ({ lines, cells: [] as Cell[] });
  if (typeof md.renderBlock !== "function" || !Number.isInteger(md.paddingX) || !Number.isInteger(md.paddingY)) return unavailable();
  let parsed = md.cachedTokens?.deref();
  if (!parsed) {
    // The full-line cache can survive the weak token cache. Use Pi to reparse.
    md.invalidate();
    lines = render();
    parsed = md.cachedTokens?.deref();
  }
  if (!parsed || parsed.source !== source.replace(/\t/g, "   ")) return unavailable();
  const spans = sourceSpans(source, parsed.tokens);
  if (!spans) return unavailable();
  const cached = Object.keys(parsed.tokens.links).length ? undefined : md.blocks?.deref();
  const regions: { source: string; start: number; row: number; lines: string[]; table: boolean }[] = [];
  let row = md.paddingY;
  for (const [i, token] of parsed.tokens.entries()) {
    const next = parsed.tokens[i + 1]?.type;
    let block = cached?.get(token.raw);
    if (!block || block.width !== width || block.nextTokenType !== next) {
      // Reference links bypass the cache; duplicate raw blocks may need different
      // spacing. Ask Pi's renderer, rather than duplicating its layout rules.
      block = { width: -1, lines: [], highlightedCode: new Map() };
      const previous = md.blockHighlightedCode;
      try { md.renderBlock(block, token, next, width, Math.max(1, width - md.paddingX * 2)); }
      finally { md.blockHighlightedCode = previous; }
    }
    if (block.lines.some((line, j) => line !== lines[row + j])) return unavailable();
    if (!["space", "def"].includes(token.type)) regions.push({
      source: source.slice(spans[i].start, spans[i].end), start: spans[i].start,
      row, lines: block.lines, table: token.type === "table",
    });
    row += block.lines.length;
  }
  if (row + md.paddingY !== lines.length) return unavailable();
  const cells = regions.flatMap(region => renderedCells(region.source, region.lines, region.table)
    .map(cell => ({ ...cell, start: cell.start + region.start, end: cell.end + region.start, row: cell.row + region.row })));
  return { lines, cells };
}
