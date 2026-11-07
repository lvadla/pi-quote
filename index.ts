import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, TuiAltScreen, truncateToWidth, visibleWidth, wrapTextWithAnsi,
  type Component, type TUI } from "@earendil-works/pi-tui";
import { indexUnitRows, renderedCells, SmartSelection, verticalUnit, type Cell, type Range, type UnitRows } from "./selection.ts";

import { highlightLine, quoteText } from "./rendering.ts";
export { highlightLine, quoteText } from "./rendering.ts";

// Pi 1.5 adapter: these agent message metadata fields are internal. No session data,
// transcript nodes, or mouse-selection state are replaced or modified.
type Node = Component & { children?: Node[]; lastMessage?: any; isStreaming?: boolean;
  markdownSlots?: { kind: string; markdown: Node }[] };
type Block = { component: Node; source: string; start: number; end: number };
type Target = { component: Node; text: string; blocks: Block[] };
type Layout = { width: number; lines: string[]; cells: Cell[] };

export function agentMessageTargets(root: Node): Target[] {
  const result: Target[] = [];
  function visit(node: Node) {
    const message = node.lastMessage;
    if (message?.role === "assistant" && Array.isArray(node.markdownSlots)) {
      if (node.isStreaming || ["aborted", "error"].includes(message.stopReason)) return;
      const texts: string[] = message.content.filter((part: any) => part.type === "text" && part.text.trim())
        .map((part: any) => part.text);
      const slots = node.markdownSlots.filter(slot => slot.kind === "text");
      if (!texts.length || slots.length !== texts.length) return;
      let offset = 0;
      const blocks = texts.map((text, i) => {
        const start = offset + text.length - text.trimStart().length;
        offset += text.length + 2;
        return { component: slots[i].markdown, source: text.trim(), start, end: start + text.trim().length };
      });
      result.push({ component: node, text: texts.join("\n\n"), blocks });
      return;
    }
    node.children?.forEach(visit);
  }
  visit(root);
  return result;
}

export function rowOf(root: Node, target: Node, width: number): number | undefined {
  // Find the path before measuring. Rendering every unsuccessful subtree during
  // the search measures the same history repeatedly at each nesting depth.
  function preceding(node: Node): Node[] | undefined {
    if (node === target) return [];
    const siblings: Node[] = [];
    for (const child of node.children ?? []) {
      const nested = preceding(child);
      if (nested) return [...siblings, ...nested];
      siblings.push(child);
    }
    return undefined;
  }
  return preceding(root)?.reduce((row, node) => row + node.render(width).length, 0);
}

export default function quoteExtension(pi: ExtensionAPI) {
  let close: (() => void) | undefined;
  pi.on("session_shutdown", () => close?.());
  pi.on("session_before_switch", () => close?.());
  pi.on("session_before_tree", () => close?.());
  pi.on("agent_start", () => close?.());

  pi.registerCommand("quote", {
    description: "Copy last agent message to editor for a quote reply",
    handler: async (args, ctx) => {
      if (args.trim()) { ctx.ui.notify("Use /quote, then h/j/k/l or arrows to choose an agent message.", "info"); return; }
      if (ctx.mode !== "tui") { ctx.ui.notify("/quote requires fullscreen interactive Pi.", "error"); return; }
      if (!ctx.isIdle()) { ctx.ui.notify("Wait for the current agent message to finish before using /quote.", "info"); return; }
      close?.();
      let host!: TUI;
      let targets: Target[] = [];
      let index = 0;
      let mode: "message" | "text" = "message";
      let selection: SmartSelection;
      let active = true;
      const restore: (() => void)[] = [];
      const layouts = new Map<Block, Layout>();
      let unsubscribe: (() => void) | undefined;
      let pendingReveal: ReturnType<typeof setTimeout> | undefined;
      let layoutColumns = 0;
      let goalColumn: number | undefined;
      let spatial: { kind: string; layouts: Layout[]; cells: Cell[]; rows: UnitRows } | undefined;
      const draft = ctx.ui.getEditorText();
      const hintKey = "quote:controls";
      ctx.ui.setWidget(hintKey, instance => {
        host = instance;
        return {
          render: width => {
            const position = mode === "message"
              ? { kind: "agent message", index: index + 1, total: targets.length }
              : selection.unitPosition;
            const unit = position.kind[0].toUpperCase() + position.kind.slice(1);
            const status = mode === "message"
              ? `${position.index}/${position.total}`
              : `${unit} ${position.index}/${position.total}`;
            const title = ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Quote agent message in editor"))
              + ctx.ui.theme.fg("muted", ` · ${status}`);
            const hint = (keys: string, action: string) =>
              `${ctx.ui.theme.fg("muted", keys)} ${ctx.ui.theme.fg("text", action)}`;
            const separator = ctx.ui.theme.fg("muted", " · ");
            const navigation = mode === "message"
              ? [hint("h←", "Previous"), hint("j↓", "Next"), hint("k↑", "Previous"), hint("l→", "Next")].join(separator)
              : [hint("h←", "Previous"), hint("j↓", "Down"), hint("k↑", "Up"), hint("l→", "Next")].join(separator);
            const hints = mode === "message"
              ? [navigation, [hint("Enter", "Continue"), hint("Esc", "Cancel")].join(separator)]
              : [[navigation, hint("Tab", "Shrink level"), hint("Shift+Tab", "Expand level")].join(separator),
                [hint("Enter", "Quote"), hint("Esc", "Cancel")].join(separator)];
            return [visibleWidth(title) <= width ? title : truncateToWidth(ctx.ui.theme.fg("muted", status), width),
              ...hints.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)))];
          },
          invalidate() {},
        };
      });
      if (!(host instanceof TuiAltScreen)) {
        ctx.ui.setWidget(hintKey, undefined);
        ctx.ui.notify("/quote requires Pi fullscreen mode. Change it in /settings.", "error");
        return;
      }
      const tui = host;
      const document = tui.children[0] as Node;
      targets = document ? agentMessageTargets(document) : [];
      if (!targets.length) {
        ctx.ui.setWidget(hintKey, undefined);
        ctx.ui.notify("No completed agent text messages found in this transcript.", "info");
        return;
      }
      index = targets.length - 1;
      const originalTop = tui.viewportTop;
      const wasFollowing = tui.isFollowingOutput;
      function cancelReveal() {
        if (pendingReveal !== undefined) clearTimeout(pendingReveal);
        pendingReveal = undefined;
      }
      function unpaint() {
        cancelReveal();
        for (const undo of restore.splice(0)) undo();
        layouts.clear();
        spatial = undefined;
        goalColumn = undefined;
      }
      function finish(confirmed = false) {
        if (!active) return;
        active = false;
        unsubscribe?.();
        unpaint();
        ctx.ui.setWidget(hintKey, undefined);
        if (confirmed) ctx.ui.setEditorText((draft ? draft.replace(/\s*$/, "") + "\n\n" : "") + quoteText(selection.text));
        if (confirmed || wasFollowing) tui.scrollToBottom();
        else tui.scrollBy(originalTop - tui.viewportTop);
        tui.requestRender();
        close = undefined;
      }
      close = () => finish();
      function ensureLayouts() {
        if (layoutColumns !== tui.terminal.columns || layouts.size !== targets[index].blocks.length) {
          tui.renderNow();
          layoutColumns = tui.terminal.columns;
        }
      }
      function reveal(force = false, immediate = false) {
        ensureLayouts();
        let located: { block: Block; layout: Layout; cell?: Cell } | undefined;
        if (mode === "text") for (const block of targets[index].blocks) {
          const layout = layouts.get(block)!;
          const cell = layout.cells.find(cell => cell.start + block.start <= selection.anchor && cell.end + block.start > selection.anchor)
            ?? layout.cells.find(cell => cell.start + block.start >= selection.current.start && cell.start + block.start < selection.current.end);
          if (cell) { located = { block, layout, cell }; break; }
        }
        const first = targets[index].blocks[0];
        located ??= { block: first, layout: layouts.get(first)! };
        const base = rowOf(document, located.block.component, located.layout.width);
        if (base === undefined) throw new Error("Selected agent message is no longer in the transcript.");
        const row = base + (located.cell?.row ?? 0);
        const height = Math.max(1, tui.terminal.rows - 9);
        if (force || row < tui.viewportTop || row >= tui.viewportTop + height)
          tui.scrollBy(Math.max(0, row - (force ? 1 : Math.floor(height / 2))) - tui.viewportTop);
        if (immediate) tui.renderNow();
        else tui.requestRender();
      }
      function flushReveal() {
        if (pendingReveal === undefined) return;
        cancelReveal();
        if (!active) return;
        try { reveal(false, true); } catch (error) { fail(error); }
      }
      function scheduleReveal() {
        // Apply every key to the model immediately, but paint only the latest
        // state once per frame. Never enqueue a chain of navigation animations.
        if (pendingReveal === undefined) pendingReveal = setTimeout(flushReveal, 16);
      }
      function choose() {
        unpaint();
        selection = new SmartSelection(targets[index].text);
        for (const block of targets[index].blocks) {
          const original = block.component.render;
          const owned = Object.getOwnPropertyDescriptor(block.component, "render");
          let painted: { layout: Layout; range: Range; anchor: number; mode: string; lines: string[] } | undefined;
          const wrapper = function(this: Node, width: number) {
            const lines = original.call(this, width);
            let layout = layouts.get(block);
            if (!layout || layout.width !== width || layout.lines !== lines) {
              layout = { width, lines, cells: renderedCells(block.source, lines) };
              layouts.set(block, layout);
            }
            const range = selection.current;
            if (painted?.layout === layout && painted.range === range && painted.anchor === selection.anchor && painted.mode === mode)
              return painted.lines;
            const whole = mode === "message" || range.start <= block.start && range.end >= block.end;
            const spans = new Map<number, [number, number]>();
            if (!whole) for (const cell of layout.cells) {
              if (cell.start + block.start < range.start || cell.end + block.start > range.end) continue;
              const span = spans.get(cell.row);
              if (span) span[1] = cell.column + cell.width;
              else spans.set(cell.row, [cell.column, cell.column + cell.width]);
            }
            const caret = mode === "text" ? layout.cells.find(cell => cell.start + block.start <= selection.anchor
              && cell.end + block.start > selection.anchor) : undefined;
            const highlighted = lines.map((line, row) => highlightLine(line, width, whole ? [0, width] : spans.get(row),
              caret?.row === row ? [caret.column, caret.column + caret.width] : undefined));
            painted = { layout, range, anchor: selection.anchor, mode, lines: highlighted };
            return highlighted;
          };
          block.component.render = wrapper;
          restore.push(() => {
            if (block.component.render !== wrapper) return;
            if (owned) Object.defineProperty(block.component, "render", owned);
            else delete (block.component as Partial<Node>).render;
          });
        }
        reveal(true);
      }
      function moveVertical(direction: -1 | 1) {
        ensureLayouts();
        const blocks = targets[index].blocks;
        const currentLayouts = blocks.map(block => layouts.get(block)!);
        if (!spatial || spatial.kind !== selection.current.kind
          || currentLayouts.some((layout, i) => layout !== spatial!.layouts[i])) {
          const cells: Cell[] = [];
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i], layout = currentLayouts[i];
            // Coordinates within this agent message, not the full transcript.
            // Measure once per layout/level, never on each repeated keypress.
            const base = rowOf(targets[index].component, block.component, layout.width);
            if (base === undefined) throw new Error("Selected text is no longer in the agent message.");
            for (const cell of layout.cells) cells.push({ ...cell, start: cell.start + block.start,
              end: cell.end + block.start, row: cell.row + base });
          }
          spatial = { kind: selection.current.kind, layouts: currentLayouts, cells,
            rows: indexUnitRows(selection.units, cells) };
          goalColumn = undefined;
        }
        const anchor = spatial.cells.find(cell => cell.start <= selection.anchor && cell.end > selection.anchor)
          ?? spatial.cells.find(cell => cell.start >= selection.current.start && cell.end <= selection.current.end);
        if (!anchor) return;
        goalColumn ??= anchor.column;
        const target = verticalUnit(spatial.rows, selection.current, anchor.row, goalColumn, direction);
        if (target) changeSelection(() => selection.selectUnit(target.unit, target.cell.start));
      }
      function changeSelection(change: () => void) {
        ensureLayouts();
        const before: Range = selection.current;
        const anchorBefore = selection.anchor;
        change();
        if (selection.current === before && selection.anchor === anchorBefore) return;
        // Do not silently select invisible markup (e.g. a hidden link URL).
        if (!targets[index].blocks.some(block => layouts.get(block)!.cells.some(cell =>
          cell.start + block.start >= selection.current.start && cell.end + block.start <= selection.current.end))) {
          selection.current = before;
          selection.anchor = anchorBefore;
          ctx.ui.notify("That range has no selectable rendered text.", "info");
          return;
        }
        scheduleReveal();
      }
      function fail(error: unknown) {
        finish();
        ctx.ui.notify(`Quote: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
      unsubscribe = ctx.ui.onTerminalInput(data => {
        if (isKeyRelease(data)) {
          flushReveal();
          return { consume: true };
        }
        try {
          const key = (name: Parameters<typeof matchesKey>[1]) => matchesKey(data, name);
          const left = key("h") || key("left"), right = key("l") || key("right");
          const up = key("k") || key("up"), down = key("j") || key("down");
          if (key("ctrl+c")) finish();
          else if (key("escape")) {
            if (mode === "message") finish();
            else { cancelReveal(); goalColumn = undefined; mode = "message"; selection.reset(); reveal(true); }
          } else if (key("enter")) {
            if (mode === "message") { mode = "text"; reveal(); }
            else finish(true);
          } else if (mode === "message" && (left || up || right || down)) {
            index = Math.max(0, Math.min(targets.length - 1, index + (left || up ? -1 : 1)));
            choose();
          } else if (mode === "text" && (left || right)) {
            goalColumn = undefined;
            changeSelection(() => selection.moveUnit(left ? -1 : 1));
          } else if (mode === "text" && (up || down)) moveVertical(up ? -1 : 1);
          else if (mode === "text" && (key("tab") || key("shift+tab"))) {
            goalColumn = undefined;
            changeSelection(() => key("tab") ? selection.shrink() : selection.expand());
          }
          else if (data.startsWith("\x1b[<") || data.startsWith("\x1b]")) return;
        } catch (error) { fail(error); }
        return { consume: true };
      });
      try { choose(); } catch (error) { fail(error); }
    },
  });
}
