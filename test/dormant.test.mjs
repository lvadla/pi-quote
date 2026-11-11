import assert from "node:assert/strict";
import test from "node:test";
import inspector from "node:inspector";
import { promisify } from "node:util";

test("Inactive quote mode does no parsing or mapping before opening or after closing", async () => {
  const profiler = new inspector.Session();
  profiler.connect();
  const post = promisify(profiler.post.bind(profiler));
  const files = new Set(["index.ts", "transcript.ts", "selection.ts", "markdown.ts", "rendering.ts"]
    .map(file => new URL("../" + file, import.meta.url).href));
  const work = ["transcriptDocument", "agentMessageTargets", "rowOf", "SmartSelection", "align", "renderedCells",
    "markdownLayout", "originalOffsets", "sourceSpans", "highlightLine", "flushReveal"];
  const calls = async () => {
    const { result } = await post("Profiler.takePreciseCoverage");
    const counts = Object.fromEntries(work.map(name => [name, 0]));
    for (const script of result.filter(script => files.has(script.url)))
      for (const fn of script.functions)
        if (work.includes(fn.functionName)) counts[fn.functionName] += fn.ranges[0].count;
    return counts;
  };
  let h;
  try {
    await post("Profiler.enable");
    await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    const { createHarness } = await import("./helpers.mjs");
    const zero = Object.fromEntries(work.map(name => [name, 0]));
    assert.deepEqual(await calls(), zero, "module loading does no selection work");
    h = createHarness();
    for (let i = 0; i < 6; i++) {
      h.latest.updateContent(h.message(`Ordinary response ${i}.\n\n- Item one\n- Item two`), i < 5);
      h.terminal.columns = i % 2 ? 100 : 72;
      h.tui.renderNow();
      h.events.get("tool_execution_start")();
      h.events.get("turn_end")();
    }
    for (const event of ["session_compact", "session_before_switch", "session_before_tree"])
      h.events.get(event)();
    assert.deepEqual(await calls(), zero, "registration, normal rendering, and inactive callbacks do no selection work");
    await h.commands.get("quote").handler("", h.ctx);
    h.input("\r");
    h.input("\t");
    h.input("\x1b[108;1:3u");
    const active = await calls();
    // Positive control: prove the profiler observes the real production paths.
    for (const name of work) assert.ok(active[name] > 0, name);
    h.input("\x1b[Z"); // Queue a paint, then close before it runs.
    h.input("\x03");
    await calls(); // Exclude the closing operation itself.
    h.latest.updateContent(h.message("An ordinary message after quoting."));
    h.tui.renderNow();
    h.events.get("tool_execution_start")();
    h.events.get("turn_end")();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(await calls(), zero, "closed selection leaves no mapping, highlighting, refresh, or pending paint work");
  } finally {
    h?.stop();
    await post("Profiler.stopPreciseCoverage");
    profiler.disconnect();
  }
});
