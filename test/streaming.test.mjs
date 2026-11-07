import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, createHarness } from "./helpers.mjs";

// Exercise the extension callbacks and real components, not Pi's event dispatcher.
// Pi's message_end -> UI update -> boundary-event ordering was checked in its source.
for (const event of ["tool_execution_start", "turn_end"]) {
  test(`${event}: streaming is excluded; completion refreshes without disturbing selection`, async (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    h.ctx.isIdle = () => false;
    const status = () => h.widgets.render(140).map(stripTerminalSequences).join("\n");
    const refresh = () => h.events.get(event)();
    await h.commands.get("quote").handler("", h.ctx);
    await h.events.get("agent_start")?.(); // Agent activity must not close selection.
    h.input("h");
    const streaming = new AssistantMessageComponent(undefined, true);
    const originalRender = streaming.render;
    h.document.addChild(streaming);
    const top = h.tui.viewportTop;
    assert.equal(h.tui.isFollowingOutput, false);
    for (const count of [1, 20]) {
      streaming.updateContent(h.message("New output\n\n".repeat(count)), true);
      await refresh();
      h.tui.renderNow();
      assert.ok(status().includes("2/3"), "streaming message is not in the message count");
      assert.equal(h.tui.viewportTop, top);
      assert.equal(streaming.render, originalRender, "streaming component remains unwrapped");
    }
    h.input("\r");
    for (let i = 0; i < 10 && !status().includes("Word "); i++) h.input("\t");
    h.input("l");
    h.input("\x1b[108;1:3u");
    assert.ok(status().includes("Word 2/"));
    const selectedStatus = status();
    const selectedLines = h.old.render(71);
    const selectedTop = h.tui.viewportTop;
    const block = h.old.markdownSlots[0].markdown;
    const wrapper = block.render;
    streaming.updateContent(h.message("New completed response."), false);
    await refresh();
    await refresh(); // Multiple tools must not duplicate targets or reset selection.
    h.tui.renderNow();
    assert.equal(status(), selectedStatus);
    assert.equal(h.tui.viewportTop, selectedTop);
    assert.equal(block.render, wrapper);
    assert.deepEqual(h.old.render(71), selectedLines);
    h.input("\x1b");
    assert.ok(status().includes("2/4"));
    h.input("l");
    h.input("l");
    assert.ok(status().includes("4/4"));
    h.input("\r");
    h.input("\r");
    assert.equal(h.editor.getText(), "> New completed response.\n\n");
    await refresh(); // Safe after the quote session has closed.
    assert.equal(h.widgets.children.length, 0);
  });
}
