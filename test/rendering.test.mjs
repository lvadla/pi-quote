import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { hyperlink, setCapabilityOverrides, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, createHarness } from "./helpers.mjs";
const { extractAnsiCode } = await import(new URL("utils.js", import.meta.resolve("@earendil-works/pi-tui")));
const { highlightLine } = await createJiti(import.meta.url).import("../rendering.ts");

// Compare terminal appearance, not escape-string equality: slicing may repeat
// existing style codes. Unknown SGR codes fail instead of being silently ignored.
function appearance(lines, ignoreSelection = true) {
  return lines.map(line => {
    let style = { reverse: false, underline: false }, link = "";
    const cells = [];
    for (let i = 0; i < line.length;) {
      const ansi = extractAnsiCode(line, i);
      if (!ansi) {
        const char = String.fromCodePoint(line.codePointAt(i));
        const attributes = { ...style };
        if (ignoreSelection) { delete attributes.reverse; delete attributes.underline; }
        cells.push({ char, link, style: attributes });
        i += char.length;
        continue;
      }
      const code = ansi.code;
      i += ansi.length;
      if (code.startsWith("\x1b]8;")) link = code.replace(/^\x1b\]8;[^;]*;/, "").replace(/\x07$|\x1b\\$/, "");
      if (!/^\x1b\[[0-9;:]*m$/.test(code)) continue;
      assert.ok(!code.includes(":"), "Unhandled colon-form style code");
      const values = code.slice(2, -1).split(";").map(Number);
      for (let j = 0; j < values.length; j++) {
        const value = values[j];
        if (value === 0) style = { reverse: false, underline: false };
        else if ([38, 48, 58].includes(value)) {
          const key = { 38: "fg", 48: "bg", 58: "underlineColor" }[value];
          const count = values[j + 1] === 2 ? 4 : 2;
          style[key] = values.slice(j + 1, j + count + 1).join(";");
          j += count;
        } else if (value >= 30 && value <= 37 || value >= 90 && value <= 97) style.fg = value;
        else if (value >= 40 && value <= 47 || value >= 100 && value <= 107) style.bg = value;
        else if ([39, 49, 59].includes(value)) delete style[{ 39: "fg", 49: "bg", 59: "underlineColor" }[value]];
        else if (value === 7 || value === 27) style.reverse = value === 7;
        else if (value === 4 || value === 24) style.underline = value === 4;
        else if ([1, 2, 3, 5, 6, 8, 9].includes(value)) style[{ 1: "bold", 2: "faint", 3: "italic", 5: "blink", 6: "blink", 8: "hidden", 9: "strike" }[value]] = value;
        else if (value === 22) { delete style.bold; delete style.faint; }
        else if ([23, 25, 28, 29].includes(value)) delete style[{ 23: "italic", 25: "blink", 28: "hidden", 29: "strike" }[value]];
        else assert.fail(`Unhandled style code ${value}`);
      }
    }
    return cells;
  });
}

test("Quote decoration preserves Pi's text, wrapping, styles, and link targets", async t => {
  setCapabilityOverrides({ hyperlinks: true });
  t.after(() => setCapabilityOverrides({}));
  const h = createHarness();
  t.after(() => h.stop());
  const source = "Plain **bold words**, *italic words*, ~~struck words~~, 日本語 👩‍💻 é, and [a link](https://example.com).\n\n```js\nconst value = 1;\nconsole.log(value);\n```\n\n| Item | Description |\n|---|---|\n| One | A longer description that wraps |\n\n> Quoted text.";
  h.latest.updateContent(h.message(source));
  const original = new AssistantMessageComponent(h.message(source), true);
  assert.ok(appearance(original.render(42)).flat().some(cell => cell.link === "https://example.com"));
  h.terminal.columns = 43;
  const oldRender = h.old.render;
  const compare = () => {
    h.input("\x1b[108;1:3u");
    h.tui.renderNow();
    const width = h.terminal.columns - 1;
    const before = original.render(width), after = h.latest.render(width);
    assert.deepEqual(after.map(stripTerminalSequences), before.map(stripTerminalSequences));
    assert.deepEqual(after.map(visibleWidth), before.map(visibleWidth));
    assert.deepEqual(appearance(after), appearance(before));
    assert.equal(h.old.render, oldRender, "unselected message renderer stays untouched");
  };
  await h.commands.get("quote").handler("", h.ctx);
  compare();
  for (const key of ["\r", "\t", "\t", "l", "\x1b", "\r", "l", "\t", "j", "\x1b", "\r", "l", "l"]) {
    h.input(key);
    compare();
  }
  h.terminal.columns = 80;
  h.tui.invalidate();
  compare();
});

test("Highlight and anchor affect only their requested characters, preserving existing underline", () => {
  const line = "\x1b[4;31mred words\x1b[24;39m plain " + hyperlink("path", "file:///example/path");
  for (const [span, cursor] of [[[1, 7], [2, 3]], [[10, 15], [11, 12]]]) {
    const expected = appearance([line], false);
    expected[0].forEach((cell, column) => {
      if (column >= span[0] && column < span[1]) cell.style.reverse = true;
      if (column >= cursor[0] && column < cursor[1]) cell.style.underline = true;
    });
    assert.deepEqual(appearance([highlightLine(line, visibleWidth(line), span, cursor)], false), expected);
  }
});
