import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";

test("Message navigation, release events, cancellation, and exact Markdown quoting", async (t) => {
  const h = createHarness();
  t.after(() => h.stop());
  const status = () =>
    h.widgets.render(140).map(stripTerminalSequences).join("\n");
  const open = () => h.commands.get("quote").handler("", h.ctx);
  const source =
    "> **Hello** [world](https://example.com)\n\n```js\nx += 1;\n```";
  h.latest.updateContent(h.message(source));
  const before = h.document.render(71);
  await open();
  assert.ok(status().includes("3/3"), "streaming and failed messages excluded");
  h.input("\x1b[107;1:1u");
  assert.ok(status().includes("2/3"));
  h.input("\x1b[107;1:3u");
  assert.ok(status().includes("2/3"), "release must not navigate again");
  h.input("j");
  h.input("\r");
  assert.ok(status().includes("Block 1/2"));
  h.input("\x1b");
  assert.ok(status().includes("3/3"));
  h.input("\x1b");
  assert.equal(h.input, undefined);
  assert.equal(h.editor.getText(), "");
  assert.deepEqual(h.document.render(71), before);
  await open();
  h.input("\r");
  h.input("\x1b[Z"); // expand to the whole message
  assert.ok(status().includes("Whole agent message 1/1"));
  h.input("\r");
  assert.equal(
    h.editor.getText(),
    source
      .split("\n")
      .map((line) => "> " + line)
      .join("\n") +
      "\n\n",
  );
  h.editor.handleInput("comment");
  assert.ok(
    h.editor.getText().endsWith("\n\ncomment"),
    "cursor below the quote",
  );
  assert.deepEqual(h.document.render(71), before);
  assert.equal(h.notices.length, 0);
});

for (const event of [
  "session_compact",
  "session_before_switch",
  "session_before_tree",
  "session_shutdown",
]) {
  test(`${event} restores rendering and removes input handlers`, async (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const before = h.document.render(71);
    await h.commands.get("quote").handler("", h.ctx);
    h.input("\r");
    h.input("\t"); // queue a selection frame
    h.events.get(event)();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(h.input, undefined);
    assert.equal(h.widgets.children.length, 0);
    assert.deepEqual(h.document.render(71), before);
  });
}

test("Entering text selection narrows to the first block, including after returning to message mode", async (t) => {
  const h = createHarness();
  t.after(() => h.stop());
  h.latest.updateContent(h.message("First paragraph.\n\nSecond paragraph."));
  const before = h.document.render(71);
  const lines = () => h.latest.render(71);
  const highlighted = (text) => lines().some(line =>
    stripTerminalSequences(line).includes(text) && line.includes("\x1b[7m"));
  const status = () => h.widgets.render(140).map(stripTerminalSequences).join("\n");
  await h.commands.get("quote").handler("", h.ctx);
  assert.ok(highlighted("First paragraph."));
  assert.ok(highlighted("Second paragraph."));
  h.input("\r");
  assert.ok(status().includes("Block 1/2"));
  assert.ok(highlighted("First paragraph."));
  assert.equal(highlighted("Second paragraph."), false);
  h.input("l");
  h.input("\x1b[108;1:3u");
  assert.ok(status().includes("Block 2/2"));
  h.input("\x1b");
  assert.ok(highlighted("First paragraph."));
  assert.ok(highlighted("Second paragraph."));
  h.input("\r");
  assert.ok(status().includes("Block 1/2"));
  assert.equal(highlighted("Second paragraph."), false);
  h.input("\r");
  assert.equal(h.editor.getText(), "> First paragraph.\n\n");
  assert.deepEqual(h.document.render(71), before);
  assert.deepEqual(h.notices, []);
});
