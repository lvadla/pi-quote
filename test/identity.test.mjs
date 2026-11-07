import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, createHarness } from "./helpers.mjs";

for (const restored of [false, true]) {
  const mode = restored ? "restored" : "live-completed";
  function assistant(h, content, id) {
    const message = { ...h.message(""), content };
    if (restored) {
      return new AssistantMessageComponent(
        message, true, undefined, undefined, undefined, [], id, message.timestamp,
      );
    }
    const component = new AssistantMessageComponent(undefined, true);
    component.updateContent(message, true);
    component.render(71); // Populate the streaming render cache before completion.
    component.updateContent(message, false);
    return component;
  }
  const painted = (component) => component.render(71).some(line => line.includes("\x1b[7m"));
  const flush = (h) => h.input("\x1b[108;1:3u");

  test(`${mode}: identical messages select only the chosen component`, async (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const source = "Same **answer**.";
    const content = [{ type: "text", text: source }];
    const first = assistant(h, content, "first");
    const second = assistant(h, content, "second");
    h.document.clear();
    h.document.addChild(first);
    h.document.addChild(second);
    const before = h.document.render(71);
    await h.commands.get("quote").handler("", h.ctx);
    assert.equal(painted(first), false);
    assert.equal(painted(second), true);
    h.input("h");
    assert.equal(painted(first), true);
    assert.equal(painted(second), false);
    h.input("l");
    assert.equal(painted(first), false);
    assert.equal(painted(second), true);
    h.input("\r");
    h.input("\r");
    assert.equal(h.editor.getText(), "> Same **answer**.\n\n");
    assert.deepEqual(h.document.render(71), before);
    assert.equal(h.input, undefined);
    assert.deepEqual(h.notices, []);
  });

  test(`${mode}: identical blocks remain independently selectable`, async (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const component = assistant(h, [
      { type: "text", text: "Echo" },
      { type: "thinking", thinking: "Between repeated blocks" },
      { type: "text", text: "Echo" },
    ], "repeated");
    h.document.clear();
    h.document.addChild(component);
    const blocks = component.markdownSlots.filter(slot => slot.kind === "text").map(slot => slot.markdown);
    assert.equal(blocks.length, 2);
    const originals = blocks.map(block => block.render);
    const before = h.document.render(71);
    await h.commands.get("quote").handler("", h.ctx);
    assert.ok(blocks.every(painted), "whole-message selection includes both occurrences");
    h.input("\r");
    const status = () => h.widgets.render(140).map(stripTerminalSequences).join("\n");
    for (let i = 0; i < 10 && !status().includes("Word "); i++) h.input("\t");
    assert.ok(status().includes("Word 1/2"));
    flush(h);
    assert.equal(painted(blocks[0]), true);
    assert.equal(painted(blocks[1]), false);
    h.input("l");
    flush(h);
    assert.ok(status().includes("Word 2/2"));
    assert.equal(painted(blocks[0]), false);
    assert.equal(painted(blocks[1]), true);
    h.input("h");
    flush(h);
    assert.equal(painted(blocks[0]), true);
    assert.equal(painted(blocks[1]), false);
    h.input("l");
    flush(h);
    h.input("\r");
    assert.equal(h.editor.getText(), "> Echo\n\n");
    assert.deepEqual(h.document.render(71), before);
    blocks.forEach((block, i) => assert.equal(block.render, originals[i]));
    assert.deepEqual(h.notices, []);
  });
}
