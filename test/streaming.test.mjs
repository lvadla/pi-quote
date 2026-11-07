import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, createHarness } from "./helpers.mjs";

test("Streaming updates respect quote scrolling and leave completed components intact", async (t) => {
  const h = createHarness();
  t.after(() => h.stop());
  h.ctx.isIdle = () => false;
  await h.commands.get("quote").handler("", h.ctx);
  h.input("h"); // Reveal an older completed message through Pi's scrollBy().
  h.tui.renderNow();
  assert.equal(h.tui.isFollowingOutput, false);
  const top = h.tui.viewportTop;
  const blocks = h.old.markdownSlots.map(slot => slot.markdown);
  const renders = blocks.map(block => block.render);
  const selectedLines = h.old.render(71);
  const streaming = new AssistantMessageComponent(undefined, true);
  const streamingRender = streaming.render;
  h.document.addChild(streaming);
  for (let n = 1; n <= 20; n++) {
    streaming.updateContent(h.message("New output\n\n".repeat(n)), true);
    h.tui.renderNow();
    assert.equal(h.tui.viewportTop, top);
    assert.equal(h.tui.isFollowingOutput, false);
    assert.deepEqual(h.old.markdownSlots.map(slot => slot.markdown), blocks);
    blocks.forEach((block, i) => assert.equal(block.render, renders[i]));
    assert.deepEqual(h.old.render(71), selectedLines);
    assert.equal(streaming.render, streamingRender);
  }
  streaming.updateContent(h.message("Completed output"), false);
  h.tui.renderNow();
  assert.equal(h.tui.viewportTop, top);
  const status = () => h.widgets.render(140).map(stripTerminalSequences).join("\n");
  await h.events.get("tool_execution_start")();
  h.tui.renderNow();
  assert.ok(status().includes("2/4"));
  assert.equal(h.tui.viewportTop, top);
  assert.deepEqual(h.old.render(71), selectedLines);
  // Selection keys still work after streaming updates, then release input on exit.
  h.input("\r");
  h.input("\r");
  assert.equal(h.editor.getText(), "> Older **response**\n\n");
  assert.equal(h.input, undefined);
  assert.deepEqual(h.notices, []);
  h.editor.setText("");
  await h.commands.get("quote").handler("", h.ctx);
  assert.ok(status().includes("4/4"), "reopening selects the latest completed message");
});

test("Agent start and in-progress or failed compaction leave selection active; successful compaction cleans up", async (t) => {
  const h = createHarness();
  t.after(() => h.stop());
  const originalRender = h.latest.markdownSlots[0].markdown.render;
  const before = h.document.render(71);
  const emit = (event) => h.events.get(event)?.({ type: event }, h.ctx);
  await h.commands.get("quote").handler("", h.ctx);
  const input = h.input;
  h.ctx.isIdle = () => false;
  await emit("agent_start");
  await emit("session_before_compact");
  assert.equal(h.input, input);
  h.input("\r");
  h.input("\t");
  await emit("session_compact_failed");
  assert.equal(h.input, input);
  await emit("session_compact");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.input, undefined);
  assert.equal(h.widgets.children.length, 0);
  assert.equal(h.latest.markdownSlots[0].markdown.render, originalRender);
  assert.deepEqual(h.document.render(71), before);
  assert.equal(h.editor.getText(), "");

  // The same busy context can open quote while compaction is already running.
  await h.commands.get("quote").handler("", h.ctx);
  assert.ok(h.input);
  h.input("\r");
  h.input("\r");
  assert.equal(h.editor.getText(), "> Latest response.\n\n");
  await emit("session_compact"); // Already finished: cleanup is a no-op.
  assert.equal(h.editor.getText(), "> Latest response.\n\n");
  assert.deepEqual(h.notices, []);
});

for (const event of ["tool_execution_start", "turn_end"]) {
  test(`${event} refresh preserves word selection and exposes completed messages without reopening`, async (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const status = () => h.widgets.render(140).map(stripTerminalSequences).join("\n");
    const emit = () => h.events.get(event)();
    await h.commands.get("quote").handler("", h.ctx);
    h.input("h");
    h.input("\r");
    for (let i = 0; i < 10 && !status().includes("Word "); i++) h.input("\t");
    h.input("l"); // Select "response", not the first word.
    h.input("\x1b[108;1:3u");
    assert.ok(status().includes("Word 2/"));
    const selectedStatus = status();
    const selectedLines = h.old.render(71);
    const block = h.old.markdownSlots[0].markdown;
    const wrapper = block.render;
    const top = h.tui.viewportTop;
    const streaming = new AssistantMessageComponent(undefined, true);
    const message = h.message("New completed response.");
    streaming.updateContent(message, true);
    h.document.addChild(streaming);
    await emit(); // An event while this component is streaming must not include it.
    h.tui.renderNow();
    assert.equal(status(), selectedStatus);
    streaming.updateContent(message, false); // Pi does this before either boundary event.
    await emit();
    await emit(); // Repeated tool starts must not duplicate targets or reset selection.
    h.tui.renderNow();
    assert.equal(status(), selectedStatus);
    assert.equal(h.tui.viewportTop, top);
    assert.equal(block.render, wrapper);
    assert.deepEqual(h.old.render(71), selectedLines);

    // Return to message mode and navigate to the newly completed message.
    h.input("\x1b");
    assert.ok(status().includes("2/4"));
    h.input("l");
    h.input("l");
    assert.ok(status().includes("4/4"));
    h.input("\r");
    h.input("\r");
    assert.equal(h.editor.getText(), "> New completed response.\n\n");
    assert.equal(h.input, undefined);
    await emit(); // No active quote session: no stale refresh callback.
    assert.equal(h.widgets.children.length, 0);
    assert.deepEqual(h.notices, []);
  });
}
