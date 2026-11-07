import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";
const jiti = createJiti(import.meta.url);
const { SmartSelection, renderedCells } = await jiti.import("../selection.ts");

test("Symbols are reachable without selecting Markdown delimiters", async (t) => {
  const h = createHarness();
  t.after(() => h.stop());
  const { tui, latest, widgets, editor, commands, notices, ctx, message } = h;

  const source =
    "**↑/k and ↓/j:** move vertically. Try `/reload`, `x += 1;`, and 👩‍💻.";
  const model = new SmartSelection(source);
  const units = model.ranges
    .filter((r) => r.kind === "word")
    .sort((a, b) => a.start - b.start);
  const texts = units.map((r) => source.slice(r.start, r.end));
  for (const text of ["↑", "↓", "/", "k", "j", ":", ".", "+", "=", ";", "👩‍💻"])
    assert.ok(texts.includes(text), text);
  assert.ok(!texts.includes("*"));
  assert.ok(!texts.includes("`"));
  latest.updateContent(message(source));
  tui.renderNow();
  const block = latest.markdownSlots.find((s) => s.kind === "text").markdown;
  const cells = renderedCells(source, block.render(71));
  for (const cell of cells)
    assert.ok(
      units.some((r) => cell.start >= r.start && cell.end <= r.end),
      "unreachable source: " + source.slice(cell.start, cell.end),
    );
  const status = () => stripTerminalSequences(widgets.render(100)[0]);
  await commands.get("quote").handler("", ctx);
  h.input("\r");
  for (let i = 0; i < 10 && !status().includes("Word "); i++) h.input("\t");
  for (let i = 0; i < units.length; i++) {
    assert.ok(status().includes(`Word ${i + 1}/${units.length}`), status());
    if (i < units.length - 1) h.input("l");
  }
  for (let i = units.length - 1; i > texts.indexOf("↓"); i--) h.input("h");
  h.input("\r");
  assert.equal(editor.getText(), "> ↓\n\n");
  assert.equal(notices.length, 0);
});
