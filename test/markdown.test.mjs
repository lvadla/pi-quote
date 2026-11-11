import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { hyperlink, stripTerminalSequences } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";
import { checkMessage } from "./session.mjs";
const { markdownLayout } = await createJiti(import.meta.url).import("../markdown.ts");

function setup(t, source, width = 72) {
  const h = createHarness();
  t.after(() => h.stop());
  h.terminal.columns = width;
  h.latest.updateContent(h.message(source));
  const md = h.latest.markdownSlots.find(slot => slot.kind === "text").markdown;
  const layout = () => markdownLayout(md, source, h.terminal.columns - 1, () => md.render(h.terminal.columns - 1));
  return { h, md, layout };
}

test("Clickable path decorations preserve block and word selection and original quotes", async t => {
  const source = "Open `report.md`.\n\nOpen `report.md` again.";
  const { h, layout } = setup(t, source);
  const link = hyperlink("report.md", "file:///example/report.md");
  h.latest.markdownTransformers.push(text => text.split("\n").map(line =>
    line.includes("`report.md`") ? line.replace("`report.md`", "`" + link + "`") + "\u00a0" : line).join("\n"));
  h.latest.invalidate();
  const { lines, cells } = layout();
  assert.ok(lines.some(line => line.includes("file:///example/report.md")));
  for (const start of [source.indexOf("report.md"), source.lastIndexOf("report.md")])
    assert.ok(cells.some(cell => cell.start === start));
  assert.equal(await checkMessage(h, h.message(source)), 2);
});

test("Large tables have direct source ranges; surrounding paragraphs remain selectable", async t => {
  const table = ["| Item | Description | Value |", "|---|---|---|",
    ...Array.from({ length: 80 }, (_, i) => `| Item ${i} | A longer example description | ${i} |`)].join("\n");
  const source = `Opening words.\n\n${table}\n\nClosing words.`;
  const { h, layout } = setup(t, source, 165);
  const { lines, cells } = layout();
  const start = source.indexOf(table), end = start + table.length;
  const tableCells = cells.filter(cell => cell.start >= start && cell.start < end);
  assert.ok(tableCells.length);
  assert.ok(tableCells.every(cell => cell.start === start && cell.end === end));
  const closing = cells.find(cell => cell.start === source.indexOf("Closing"));
  assert.ok(stripTerminalSequences(lines[closing.row]).includes("Closing"));
  assert.equal(await checkMessage(h, h.message(source)), 3);
});

test("An exhausted diff preserves whole-block selection without swallowing other blocks", async t => {
  const middle = `[label](https://example.com/${"x".repeat(10000)})`;
  const source = `Opening.\n\n${middle}\n\nClosing.`;
  const { h, layout } = setup(t, source);
  const start = source.indexOf(middle), end = start + middle.length;
  const cells = layout().cells.filter(cell => cell.start >= start && cell.start < end);
  assert.ok(cells.length);
  assert.ok(cells.every(cell => cell.start === start && cell.end === end));
  assert.equal(await checkMessage(h, h.message(source)), 3);
});

test("Duplicate headings keep distinct positions through cache reuse, loss, and resize", t => {
  const source = "# Same\nFirst paragraph.\n\n# Same\n\nSecond paragraph.";
  const { h, md, layout } = setup(t, source);
  const first = layout();
  assert.deepEqual(layout(), first);
  md.cachedTokens = undefined;
  md.blocks = undefined;
  assert.deepEqual(layout(), first);
  h.terminal.columns = 40;
  const resized = layout();
  const rows = resized.lines.flatMap((line, row) => stripTerminalSequences(line).includes("Same") ? [row] : []);
  const starts = [source.indexOf("Same"), source.lastIndexOf("Same")];
  assert.deepEqual(starts.map(start => resized.cells.find(cell => cell.start === start).row), rows);
});

test("Omitted definitions and newline normalization preserve the visible sentence's original offsets", async t => {
  const prefix = '[docs]: /first\r\n[DOCS]: /second\r\n  "title"\r\n\r\n\tcode\r\n\r\n';
  const sentence = "Read the [documentation][docs].";
  const source = prefix + sentence;
  const { h, layout } = setup(t, source);
  const { cells, lines } = layout();
  const cell = cells.find(cell => cell.start === prefix.length);
  assert.ok(cell);
  assert.ok(stripTerminalSequences(lines[cell.row]).trimStart().startsWith("Read"));
  assert.ok(cells.some(cell => cell.start === source.indexOf("code")));
  assert.equal(await checkMessage(h, h.message(source)), 2);
});
