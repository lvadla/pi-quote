import { lexer, type Token } from "marked";
import { diffChars } from "diff";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

export type Range = { start: number; end: number; kind: string };
export type Cell = { start: number; end: number; row: number; column: number; width: number };
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });
const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const contains = (a: Range, b: Range) => a.start <= b.start && a.end >= b.end;
const size = (range: Range) => range.end - range.start;
const level = (range: Range) => ({
  word: 0, "inline code": 1, link: 1, "bold text": 1, "italic text": 1, "struck text": 1,
  sentence: 2, "code line": 2, paragraph: 3, heading: 3, "list item": 4,
  list: 5, "code block": 5, table: 5, blockquote: 6, block: 6, section: 7, "whole agent message": 8,
}[range.kind] ?? 0);


// Map characters that survive Markdown rendering. Whitespace is excluded so
// wrapping, margins and code indentation cannot displace the source offsets.
export function align(source: string, displayed: string): Map<number, number> {
  const compact = (text: string) => {
    let value = "";
    const offsets: number[] = [];
    for (const { segment, index } of segments.segment(text)) {
      if (/^\s+$/u.test(segment)) continue;
      value += segment;
      for (let i = 0; i < segment.length; i++) offsets.push(index + i);
    }
    return { value, offsets };
  };
  const a = compact(source), b = compact(displayed);
  const changes = diffChars(a.value, b.value, { timeout: 80, maxEditLength: 8000 });
  const result = new Map<number, number>();
  if (!changes) return result;
  let i = 0, j = 0;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      for (let k = 0; k < change.value.length; k++) result.set(b.offsets[j + k], a.offsets[i + k]);
    }
    if (!change.added) i += change.value.length;
    if (!change.removed) j += change.value.length;
  }
  return result;
}

export function renderedCells(source: string, lines: string[]): Cell[] {
  const plain = lines.map(stripTerminalSequences);
  const text = plain.join("\n");
  const mapping = align(source, text);
  const cells: Cell[] = [];
  let offset = 0;
  plain.forEach((line, row) => {
    let column = 0;
    for (const { segment, index } of segments.segment(line)) {
      const width = visibleWidth(segment);
      const start = mapping.get(offset + index);
      if (start !== undefined) cells.push({ start, end: start + segment.length, row, column, width });
      column += width;
    }
    offset += line.length + 1;
  });
  return cells;
}

export class SmartSelection {
  readonly ranges: Range[] = [];
  current: Range;
  anchor = 0;
  private history: Range[] = [];
  private unitsByKind = new Map<string, Range[]>();
  private unitIndexes = new Map<Range, number>();
  constructor(readonly source: string) {
    this.current = { start: 0, end: source.length, kind: "whole agent message" };
    this.ranges.push(this.current);
    const seen = new Set([`whole agent message:0:${source.length}`]);
    const add = (start: number, end: number, kind: string) => {
      while (start < end && /\s/u.test(source[start])) start++;
      while (end > start && /\s/u.test(source[end - 1])) end--;
      const key = `${kind}:${start}:${end}`;
      if (start < end && !seen.has(key)) {
        seen.add(key);
        this.ranges.push({ start, end, kind });
      }
    };
    // Marked child tokens sometimes omit indentation or quote prefixes. Mapping
    // their raw text back into the parent preserves original Markdown offsets.
    const locate = (raw: string, parent: string, from: number) => {
      const exact = parent.indexOf(raw, from);
      if (exact >= 0) return Array.from({ length: raw.length }, (_, i) => exact + i);
      const mapping = align(parent.slice(from), raw);
      return Array.from({ length: raw.length }, (_, i) => {
        const at = mapping.get(i);
        return at === undefined ? undefined : from + at;
      });
    };
    const build = (tokens: Token[], parent: string, parentMap: (number | undefined)[], topLevel = false) => {
      let cursor = 0;
      for (const token of tokens) {
        if (!token.raw) continue;
        const localMap = locate(token.raw, parent, cursor);
        const map = localMap.map(i => i === undefined ? undefined : parentMap[i]);
        const valid = map.filter((i): i is number => i !== undefined);
        if (!valid.length) continue;
        const localEnd = localMap.filter((i): i is number => i !== undefined).at(-1)!;
        cursor = localEnd + 1;
        const start = valid[0], end = valid.at(-1)! + 1;
        const kind = ({ paragraph: "paragraph", heading: "heading", list: "list", list_item: "list item",
          blockquote: "blockquote", code: "code block", table: "table", codespan: "inline code",
          link: "link", strong: "bold text", em: "italic text", del: "struck text" } as Record<string, string>)[token.type];
        if (kind) add(start, end, topLevel ? "block" : kind);
        const any = token as any;
        if (token.type === "table") continue; // Table layout can reorder cells when wrapped: keep it atomic.
        if (token.type === "list") build(any.items, token.raw, map);
        else if (Array.isArray(any.tokens) && any.tokens.length) {
          if (["paragraph", "heading", "text"].includes(token.type)) {
            for (const sentence of sentences.segment(token.raw)) {
              const slice = map.slice(sentence.index, sentence.index + sentence.segment.length).filter((i): i is number => i !== undefined);
              if (slice.length) add(slice[0], slice.at(-1)! + 1, "sentence");
            }
          }
          build(any.tokens, token.raw, map);
        } else if (["text", "escape", "codespan", "code", "html"].includes(token.type)) {
          const text = typeof any.text === "string" ? any.text : token.raw;
          const textMap = locate(text, token.raw, 0).map(i => i === undefined ? undefined : map[i]);
          if (token.type === "code") {
            let at = 0;
            for (const line of text.split("\n")) {
              const indexes = textMap.slice(at, at + line.length).filter((i): i is number => i !== undefined);
              if (indexes.length) add(indexes[0], indexes.at(-1)! + 1, "code line");
              at += line.length + 1;
            }
          }
          for (const word of words.segment(text)) {
            // Symbols and punctuation are visible selection units too (arrows,
            // slash commands, emoji, code operators). Only skip whitespace;
            // Markdown delimiters are already excluded by walking leaf tokens.
            if (/^\s+$/u.test(word.segment)) continue;
            const indexes = textMap.slice(word.index, word.index + word.segment.length).filter((i): i is number => i !== undefined);
            if (indexes.length) add(indexes[0], indexes.at(-1)! + 1, "word");
          }
        }
      }
    };
    const tokens = lexer(source);
    build(tokens, source, Array.from({ length: source.length }, (_, i) => i), true);
    const headings: { start: number; depth: number }[] = [];
    let offset = 0;
    for (const token of tokens) {
      const start = source.indexOf(token.raw, offset);
      if (start < 0) continue;
      if (token.type === "heading") headings.push({ start, depth: token.depth });
      offset = start + token.raw.length;
    }
    headings.forEach((heading, i) => {
      const next = headings.slice(i + 1).find(h => h.depth <= heading.depth);
      add(heading.start, next?.start ?? source.length, "section");
    });
    for (const range of this.ranges) {
      const units = this.unitsByKind.get(range.kind) ?? [];
      units.push(range);
      this.unitsByKind.set(range.kind, units);
    }
    for (const units of this.unitsByKind.values()) {
      units.sort((a, b) => a.start - b.start || b.end - a.end);
      units.forEach((range, index) => this.unitIndexes.set(range, index));
    }
    this.anchor = this.unitsByKind.get("word")?.[0]?.start ?? 0;
  }
  get text() { return this.source.slice(this.current.start, this.current.end); }
  get units(): readonly Range[] {
    return this.unitsByKind.get(this.current.kind)!;
  }
  get unitPosition() {
    const units = this.units;
    const index = this.unitIndexes.get(this.current)!;
    return { kind: this.current.kind, index: index + 1, total: units.length };
  }
  reset() { this.current = this.ranges[0]; this.history = []; }
  expand() {
    const parent = this.ranges.filter(r => contains(r, this.current) && level(r) > level(this.current))
      .sort((a, b) => level(a) - level(b) || size(a) - size(b))[0];
    if (parent) { this.history.push(this.current); this.current = parent; }
  }
  shrink() {
    const previous = this.history.pop();
    if (previous) { this.current = previous; return; }
    const child = this.ranges.filter(r => contains(this.current, r) && level(r) < level(this.current)
      && r.start <= this.anchor && r.end > this.anchor)
      .sort((a, b) => level(b) - level(a) || size(a) - size(b))[0];
    if (child) this.current = child;
  }
  moveUnit(direction: number) {
    const units = this.units;
    const index = this.unitIndexes.get(this.current)!;
    const target = units[index + direction];
    if (target) this.selectUnit(target);
  }
  selectUnit(target: Range, anchor?: number) {
    if (target.kind !== this.current.kind || !this.unitIndexes.has(target)) return;
    this.current = target;
    this.anchor = anchor ?? (target.kind === "word" ? target.start
      : this.unitsByKind.get("word")?.find(r => contains(target, r))?.start ?? target.start);
    this.history = [];
  }
}

export type UnitPoint = { unit: Range; cell: Cell };
export type UnitRows = { rows: number[]; points: Map<number, UnitPoint[]> };

export function indexUnitRows(units: readonly Range[], cells: readonly Cell[]): UnitRows {
  const ordered = [...cells].sort((a, b) => a.start - b.start);
  const points = new Map<number, UnitPoint[]>();
  for (const unit of units) {
    let low = 0, high = ordered.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ordered[middle].start < unit.start) low = middle + 1;
      else high = middle;
    }
    for (let i = low; i < ordered.length && ordered[i].start < unit.end; i++) {
      const cell = ordered[i];
      if (cell.end > unit.end) continue;
      const row = points.get(cell.row) ?? [];
      row.push({ unit, cell });
      points.set(cell.row, row);
    }
  }
  return { rows: [...points.keys()].sort((a, b) => a - b), points };
}

export function verticalUnit(index: UnitRows, current: Range, row: number, column: number, direction: -1 | 1): UnitPoint | undefined {
  let low = 0, high = index.rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.rows[middle] < row) low = middle + 1;
    else high = middle;
  }
  let at = direction < 0 ? low - 1 : low + (index.rows[low] === row ? 1 : 0);
  for (; at >= 0 && at < index.rows.length; at += direction) {
    let best: UnitPoint | undefined;
    let distance = Infinity;
    for (const point of index.points.get(index.rows[at])!) {
      if (point.unit === current) continue;
      const delta = Math.max(point.cell.column - column, column - (point.cell.column + point.cell.width - 1), 0);
      if (delta < distance) { best = point; distance = delta; }
    }
    if (best) return best;
  }
}
