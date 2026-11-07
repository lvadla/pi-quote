import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createHarness } from "./helpers.mjs";

for (const mode of ["message", "text"]) {
  test(`${mode} hints keep Enter and Esc together at the wrapping boundary`, async (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    await h.commands.get("quote").handler("", h.ctx);
    if (mode === "text") h.input("\r");
    const render = width => h.widgets.render(width).map(stripTerminalSequences);
    const actions = `Enter ${mode === "message" ? "Continue" : "Quote"} · Esc Cancel`;
    const wide = render(200);
    assert.equal(wide.length, 2);
    if (mode === "text") {
      assert.ok(wide[0].includes("Block 1/2 · Tab Shrink level · Shift+Tab Expand level"));
      assert.ok(!wide[1].includes("Tab"));
      const title = wide[0].split(" · Tab")[0];
      const levelHints = "Tab Shrink level · Shift+Tab Expand level";
      const narrow = render(visibleWidth(wide[0]) - 1);
      assert.equal(narrow[0], title, "title and unit stay on the first line");
      assert.equal(narrow[1], levelHints, "both level hints move to their own line");
    } else {
      assert.ok(wide.every(line => !line.includes("Tab")));
    }
    assert.ok(wide[1].endsWith(actions));
    const exactWidth = visibleWidth(wide[1]);
    assert.equal(render(exactWidth).at(-1), wide[1]);
    const wrapped = render(exactWidth - 1);
    assert.equal(wrapped.at(-1), actions);
    assert.ok(!wrapped.at(-2).includes("Enter"));
  });
}
