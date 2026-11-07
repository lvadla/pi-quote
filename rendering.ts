import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

export function quoteText(text: string): string {
  return text.replace(/\r\n/g, "\n").split("\n").map(line => `> ${line}`).join("\n") + "\n\n";
}

function invert(text: string) {
  return "\x1b[7m" + text.replace(/\x1b\[[0-9;:]*m/g, sequence => sequence + "\x1b[7m") + "\x1b[27m";
}

// Slice existing ANSI-rendered lines; keep foreground colors, links and wrapping.
export function highlightLine(line: string, width: number, span: [number, number] | undefined,
  cursor: [number, number] | undefined): string {
  if (!span && !cursor) return line;
  line += " ".repeat(Math.max(0, width - visibleWidth(line)));
  const boundaries = [...new Set([0, width, ...(span ?? []), ...(cursor ?? [])])].sort((a, b) => a - b);
  let output = "";
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i], end = boundaries[i + 1];
    if (end <= start) continue;
    let part = sliceByColumn(line, start, end - start);
    const selected = span && start >= span[0] && end <= span[1];
    const atCursor = cursor && start >= cursor[0] && end <= cursor[1];
    if (selected && atCursor) {
      part = invert("\x1b[4m" + part.replace(/\x1b\[[0-9;:]*m/g, sequence => sequence + "\x1b[4m") + "\x1b[24m");
    } else if (selected || atCursor) part = invert(part);
    output += part;
  }
  return output;
}
