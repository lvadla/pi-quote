import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";

test("Spatial navigation, wrapping, repeat coalescing, resize, and cleanup", async (t) => {
  const h = createHarness();
  t.after(() => h.stop());
  const {
    terminal,
    tui,
    document,
    old,
    latest,
    widgets,
    editor,
    commands,
    events,
    ctx,
    message,
  } = h;

  const status = () => stripTerminalSequences(widgets.render(100)[0]);
  const send = (key) => {
    assert.ok(h.input);
    h.input(key);
    tui.renderNow();
  };
  const source =
    "```text\nalpha beta gamma\ndelta epsilon zeta\neta theta iota\n```";
  latest.updateContent(message(source));
  const original = document.render(71);
  await commands.get("quote").handler("", ctx);
  send("\r");
  send("j");
  assert.ok(status().includes("Whole agent message 1/1"));
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
  assert.equal(editor.getText(), "> delta\n\n");
  assert.deepEqual(document.render(71), original);
  editor.setText("");
  latest.updateContent(
    message(
      "First sentence. Second sentence.\n\nThird sentence.\n\nFourth sentence.",
    ),
  );
  await commands.get("quote").handler("", ctx);
  send("\r");
  send("\t");
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
  send("\x1b");
  send("\x1b");
  terminal.columns = 22;
  latest.updateContent(
    message(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
    ),
  );
  tui.invalidate();
  tui.renderNow();
  await commands.get("quote").handler("", ctx);
  send("\r");
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
  send("\x1b");
  send("\x1b");
  terminal.columns = 72;
  tui.invalidate();
  tui.renderNow();
  // Vertical indexing must not scan historical components on repeat.
  latest.updateContent(
    message(
      "```text\n" +
        Array.from({ length: 100 }, (_, i) => `a${i} b${i} c${i}`).join("\n") +
        "\n```",
    ),
  );
  await commands.get("quote").handler("", ctx);
  send("\r");
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
  const began = performance.now();
  for (let i = 0; i < 60; i++) h.input("\x1b[106;1:2u");
  t.diagnostic(
    `60 vertical repeats: ${(performance.now() - began).toFixed(2)} ms`,
  );
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
  h.input("j");
  events.get("session_shutdown")();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.input, undefined);
  assert.equal(widgets.children.length, 0);
});
