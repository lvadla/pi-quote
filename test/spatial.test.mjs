import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";

async function setup(t, source, width = 72) {
  const h = createHarness();
  t.after(() => h.stop());
  h.terminal.columns = width;
  h.latest.updateContent(h.message(source));
  h.tui.invalidate();
  h.tui.renderNow();
  const status = () => stripTerminalSequences(h.widgets.render(140)[0]);
  const send = key => { h.input(key); h.tui.renderNow(); };
  await h.commands.get("quote").handler("", h.ctx);
  send("\r");
  return { h, status, send };
}

test("Vertical words preserve goal column, stop at boundaries, and quote the selected word", async (t) => {
  const { h, status, send } = await setup(t,
    "```text\nalpha beta gamma\ndelta epsilon zeta\neta theta iota\n```");
  send("j");
  assert.ok(status().includes("Block 1/1"));
  for (let i = 0; i < 6 && !status().includes("Word "); i++) send("\t");
  assert.ok(status().includes("Word 1/9"));
  send("k");
  assert.ok(status().includes("Word 1/9"), "top edge stays put");
  send("l");
  assert.ok(status().includes("Word 2/9"));
  send("j");
  assert.ok(status().includes("Word 5/9"), "beta -> epsilon, not gamma");
  send("j");
  assert.ok(
    status().includes("Word 8/9"),
    "goal column retained on shorter row",
  );
  send("j");
  assert.ok(status().includes("Word 8/9"), "bottom edge stays put");
  send("k");
  assert.ok(status().includes("Word 5/9"));
  send("k");
  assert.ok(status().includes("Word 2/9"));
  send("h");
  assert.ok(status().includes("Word 1/9"));
  send("\x1b[B");
  assert.ok(status().includes("Word 4/9"), "left resets horizontal goal");
  send("\x1b[B");
  assert.ok(status().includes("Word 7/9"));
  send("\x1b[A");
  assert.ok(status().includes("Word 4/9"));
  send("\r");
  assert.equal(h.editor.getText(), "> delta\n\n");
});

test("Vertical sentence movement skips other sentences on the same row", async (t) => {
  const { status, send } = await setup(t,
    "First sentence. Second sentence.\n\nThird sentence.\n\nFourth sentence.");
  send("\t");
  assert.ok(status().includes("Sentence 1/4"));
  send("j");
  assert.ok(status().includes("Sentence 3/4"), "down skips same-row sentence");
  send("j");
  assert.ok(status().includes("Sentence 4/4"));
  send("j");
  assert.ok(status().includes("Sentence 4/4"));
  send("h");
  assert.ok(status().includes("Sentence 3/4"));
});

test("Vertical word movement follows soft-wrapped rows", async (t) => {
  const { status, send } = await setup(t,
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu", 22);
  for (let i = 0; i < 6 && !status().includes("Word "); i++) send("\t");
  send("l");
  assert.ok(status().includes("Word 2/12"));
  send("j");
  assert.ok(
    status().includes("Word 5/12"),
    "wrapped paragraph uses rendered lines",
  );
  send("k");
  assert.ok(status().includes("Word 2/12"));
});

test("Held-key movement coalesces renders and rebuilds geometry after resize", async (t) => {
  const { h, status, send } = await setup(t,
    "```text\n" + Array.from({ length: 100 }, (_, i) => `a${i} b${i} c${i}`).join("\n") + "\n```");
  const { tui, old, terminal } = h;
  for (let i = 0; i < 6 && !status().includes("Word "); i++) send("\t");
  h.input("j");
  h.input("\x1b[106;1:3u"); // warm geometry and flush
  let renders = 0,
    historyRenders = 0;
  const renderNow = tui.renderNow.bind(tui);
  tui.renderNow = (...args) => {
    renders++;
    return renderNow(...args);
  };
  const oldRender = old.render;
  old.render = function (width) {
    historyRenders++;
    return oldRender.call(this, width);
  };
  for (let i = 0; i < 60; i++) h.input("\x1b[106;1:2u");
  assert.equal(renders, 0);
  assert.equal(historyRenders, 0);
  assert.ok(status().includes("Word 184/300"));
  h.input("\x1b[106;1:3u");
  assert.equal(renders, 1);
  const released = status();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(status(), released);
  assert.equal(renders, 1);
  terminal.columns = 30;
  tui.invalidate();
  tui.renderNow();
  h.input("k");
  h.input("\x1b[107;1:3u");
  assert.ok(status().includes("Word 181/300"));
});
