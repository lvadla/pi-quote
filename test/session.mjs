import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";
const { SmartSelection } = await createJiti(import.meta.url).import("../selection.ts");
const categories = ["navigation", "highlight", "display", "quote", "cleanup", "notice"];

// Shared by synthetic regressions and the opt-in local session check.
export async function checkMessage(h, message) {
  h.latest.updateContent(message);
  h.tui.renderNow();
  const source = message.content.filter(p => p.type === "text" && p.text.trim()).map(p => p.text).join("\n\n");
  const model = new SmartSelection(source);
  const blocks = model.ranges.filter(r => r.kind === "block");
  const render = () => h.latest.render(h.terminal.columns - 1);
  const before = render();
  const status = () => h.widgets.render(200).map(stripTerminalSequences).join("\n");
  const open = async () => {
    await h.commands.get("quote").handler("", h.ctx);
    h.input("\r");
  };
  const confirm = range => {
    h.input("\x1b[108;1:3u");
    assert.ok(render().some(line => line.includes("\x1b[7m")), "highlight");
    assert.deepEqual(render().map(stripTerminalSequences), before.map(stripTerminalSequences), "display");
    h.input("\r");
    const expected = source.slice(range.start, range.end).replace(/\r\n/g, "\n")
      .split("\n").map(line => "> " + line).join("\n") + "\n\n";
    assert.equal(h.editor.getText(), expected, "quote");
    assert.ok(!h.input, "cleanup");
    assert.deepEqual(render(), before, "cleanup");
    h.editor.setText("");
  };
  try {
    for (const [index, block] of blocks.entries()) {
      await open();
      for (let i = 0; i < index; i++) h.input("l");
      assert.ok(status().includes(`Block ${index + 1}/${blocks.length}`), "navigation");
      confirm(block);
    }
    if (!blocks.length) { await open(); confirm(model.current); }
    const firstWord = model.ranges.find(r => r.kind === "word");
    if (firstWord && blocks[0]?.end >= firstWord.end) {
      await open();
      for (let i = 0; i < 8 && !status().includes("Word "); i++) h.input("\t");
      assert.ok(status().includes("Word 1/"), "navigation");
      confirm(firstWord);
    }
    assert.equal(h.notices.length, 0, "notice");
    return blocks.length;
  } finally {
    h.events.get("session_compact")();
    h.editor.setText("");
    h.notices.length = 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const entries = (await readFile(process.argv[2], "utf8")).split("\n").filter(line => line.trim()).map(JSON.parse);
    const messages = entries.filter(e => e.type === "message").map(e => e.message).filter(m =>
      m?.role === "assistant" && !["error", "aborted"].includes(m.stopReason)
      && m.content.some(p => p.type === "text" && p.text.trim()));
    if (!messages.length) throw new Error();
    const failures = [];
    let blocks = 0;
    for (const width of [72, 100, 165]) {
      const h = createHarness();
      h.terminal.columns = width;
      try {
        for (const [i, message] of messages.entries()) {
          try { blocks += await checkMessage(h, message); }
          catch (error) {
            // Assertions may contain private values. Only emit known categories.
            const category = categories.find(c => error?.message === c || error?.message?.startsWith(c + "\n")) ?? "unexpected";
            failures.push({ message: i + 1, width, category });
          }
        }
      } finally { h.stop(); }
    }
    console.log(JSON.stringify({ messages: messages.length, blocks, failures }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  } catch {
    console.error("Could not test session. Usage: npm run test:session -- /path/to/session.jsonl");
    process.exitCode = 2;
  }
}
