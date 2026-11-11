import type { Component, TUI } from "@earendil-works/pi-tui";

// Pi 1.5 adapter: these agent message metadata fields are internal. No session data,
// transcript nodes, or mouse-selection state are replaced or modified.
type Node = Component & { children?: Node[]; lastMessage?: any; isStreaming?: boolean;
  markdownSlots?: { kind: string; markdown: Node }[] };
export type Block = { component: Component; source: string; start: number; end: number };
export type Target = { component: Component; text: string; blocks: Block[] };

// Pi mounts the transcript document as the first TUI child.
export function transcriptDocument(tui: TUI): Component | undefined {
  return tui.children[0];
}

export function agentMessageTargets(root: Component): Target[] {
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

export function rowOf(root: Component, target: Component, width: number): number | undefined {
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
