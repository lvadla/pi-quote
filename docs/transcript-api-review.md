# Transcript integration API review

## Result

The current adapter is a prototype, not a supported transcript integration. Do not publish it as a stable integration or try to make it supported by restricting peer versions.

Checked Pi 1.5.0 (the latest GitHub release at review time) and upstream `main` at [`085c84e98e7f4c950f2be606466fff4f75d8fe7c`](https://github.com/earendil-works/pi/tree/085c84e98e7f4c950f2be606466fff4f75d8fe7c), dated 2026-11-07. Runtime probes below ran against the repository's pinned 1.5.0 dependencies; upstream behavior was inspected in source, not runtime-tested.

No complete public path was found for structural selection in the *existing* transcript. The missing capabilities are stable message/block identity at the rendering boundary, post-render decoration, and message-relative layout/reveal access. Reading original messages, receiving keys, displaying controls, and inserting a quote already have public APIs.

**Correction to the initial review:** Pi explicitly instructs packages to declare host-provided peers with `"*"`. Our peer ranges follow that guidance. They are not themselves a release defect. Pinned development dependencies establish the test baseline; they do not restrict the host. See [Declare dependencies](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/coding-agent/docs/packages.md#declare-dependencies).

The package gallery's documented discovery mechanism is the `pi-package` keyword. This review makes no claim that the gallery bans internal access. The concern is maintainability and meeting this project's supported-API requirement, not an invented gallery admission rule.

## Public API inventory

| Requirement | Public API | Finding |
| --- | --- | --- |
| Read original messages | `ctx.sessionManager.getBranch()`, `buildContextEntries()`, `buildSessionProjection()` | Available. A future adapter should obtain source and session identity here, not from private component fields. Compaction-aware session projection matters; all session entries are not equivalent to the displayed transcript. |
| Commands, keyboard, help, editor insertion | `registerCommand`, `onTerminalInput`, `setWidget`, `setEditorText` | Available; already used. |
| Focused selection controls without replacing transcript | Non-overlay `ctx.ui.custom()` | Public and worth using for input ownership; replaces the editor temporarily, not the transcript. It does not grant transcript decoration/layout access. |
| Modify built-in assistant Markdown | `registerMarkdownTransformer` | Available, but a pre-parse string transform, not a post-render decoration hook. |
| Replace a built-in assistant renderer | `registerMessageRenderer` | Not supported by this API: registration is for `CustomMessageEntry.customType`. `registerEntryRenderer` is for custom entries; tool renderer hooks are for tool rows. |
| Request redraw/invalidate | Injected `TUI.requestRender()` and `Component.invalidate()` | Public. Broad TUI invalidation can refresh transformers; lack of any invalidation mechanism is **not** a blocker. No public handle is supplied for invalidating just the selected existing Markdown block. |
| Scroll and inspect final screen | Exported concrete `TuiAltScreen.scrollBy`, `scrollToTop`, `scrollToBottom`, `getScreenLines` | Public concrete-class methods, though not all exposed on the injected generic `TUI` interface. Screen lines have no message/source identities and cover the screen, not a source-indexed transcript. |
| Read/set native selection endpoints | `hasActiveSelection`, `copyActiveSelectionToClipboard`, `resetTextSelection` | Only existence, copy, and reset are exposed. Endpoints, selected text retrieval, and setting selection remain private. Clipboard copying would also return rendered text rather than original Markdown. |
| Obtain mounted transcript block geometry | No matching extension API found | The fullscreen layout and selection fields are private. Exported layout building blocks help build a layout an extension owns, not obtain stable identities and coordinates from Pi's existing one. |

Source references:

- [Extension UI and renderer contracts](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/coding-agent/src/core/extensions/types.ts)
- [Read-only session manager](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/coding-agent/src/core/session-manager.ts)
- [TUI component, input, and viewport interfaces](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/tui/src/tui.ts)
- [Fullscreen renderer methods and private selection/layout state](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/tui/src/tui-alt-screen.ts)

## Markdown-transformer investigation

### Dynamic state is possible, but cached

A transform that highlights `beta` in `alpha beta` with reverse-video ANSI works without changing the visible plain text. Merely changing the transform's captured selection state and rerendering at the same width does not invoke it again. Calling public `invalidate()` does.

Measured probe: first render called the transform once; a second render after changing selection returned the same cached lines with no highlight; invalidation followed by rendering called it a second time and produced the highlight.

This is a refresh/performance constraint, not proof that dynamic transformers are impossible. [The cache check precedes transformation](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/tui/src/components/markdown.ts#L368-L376).

### Pre-parse ANSI is not a general decoration layer

Using `ESC[7m + markdown + ESC[27m` through the transform produced:

| Input | Observed result |
| --- | --- |
| Plain text | Reverse video, same visible text |
| `# Heading` | Literal `#` became visible: heading parsing changed |
| Fenced JavaScript | Indentation, blank lines, and fence output changed |
| Markdown table | Table borders disappeared; raw pipe syntax appeared |
| Bold text and inline code | Visible text stayed the same in this particular probe |

These tests rule out simple source wrapping as a general replacement for post-render highlighting. They do **not** prove that every syntax-aware transformer is impossible. Such a transformer would still need to solve live identity, code highlighting/style resets, geometry, and targeted redraw. Reimplementing those through source markers would replace one workaround with another.

### Message identity remains incomplete

`MarkdownTransformContext` contains `messageType`, `isStreaming`, `availableWidth`, optional `messageId`, and optional `timestamp`. Upstream additionally accepts transformer surface options, but does not add block identity or rendered geometry.

A probe rendered a message with two identical text blocks:

- After a live component transitioned from streaming to completed, both callbacks had `isStreaming: false` and **neither had a message ID**.
- Constructing a restored component with a persisted ID supplied that ID to both callbacks, but there was **no content-block index** to distinguish them.

The source confirms why: the live `message_start` path constructs `AssistantMessageComponent` without identity, and `message_end` calls `updateContent` without attaching persisted metadata. Restored rendering supplies identity in the constructor. The transform context receives no original content index. Matching text or counting callback order is not a reliable substitute for identity, especially with repeated text, render caching, resize, and multiple blocks.

References: [interactive message lifecycle](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/coding-agent/src/modes/interactive/interactive-mode.ts), [assistant component](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/coding-agent/src/modes/interactive/components/assistant-message.ts), [transform context construction](https://github.com/earendil-works/pi/blob/085c84e98e7f4c950f2be606466fff4f75d8fe7c/packages/coding-agent/src/modes/interactive/components/markdown-transform.ts).

## Reproduce the renderer probes

Run from this repository after `npm ci --ignore-scripts`. Internal imports here are test instrumentation to reproduce the host lifecycle, not a proposed extension implementation.

```sh
node --input-type=module <<'JS'
import { Markdown, stripTerminalSequences } from '@earendil-works/pi-tui';
const entry = import.meta.resolve('@earendil-works/pi-coding-agent');
const internal = path => import(new URL(path, entry).href);
const { initTheme, getMarkdownTheme } = await internal('modes/interactive/theme/theme.js');
const { AssistantMessageComponent } = await internal('modes/interactive/components/assistant-message.js');
initTheme('dark');
const theme = getMarkdownTheme();
const plain = lines => lines.map(stripTerminalSequences);
let selected = false, calls = 0;
const md = new Markdown('alpha beta', 0, 0, theme, undefined, {
  transform: source => {
    calls++;
    return selected ? source.replace('beta', '\x1b[7mbeta\x1b[27m') : source;
  },
});
md.render(40);
selected = true;
md.render(40);
console.log('calls without invalidation:', calls);
md.invalidate(); md.render(40);
console.log('calls after invalidation:', calls);
for (const source of ['# Heading', '```js\nconst x = 1;\n```', '| A | B |\n|---|---|\n| 1 | 2 |']) {
  const before = new Markdown(source, 0, 0, theme).render(40);
  const after = new Markdown(source, 0, 0, theme, undefined, {
    transform: text => '\x1b[7m' + text + '\x1b[27m',
  }).render(40);
  console.log(JSON.stringify({ source, before: plain(before), after: plain(after) }));
}
const observe = (text, context) => { console.log(JSON.stringify({ text, ...context })); return text; };
const message = { role: 'assistant', content: [
  { type: 'text', text: 'Identical' }, { type: 'text', text: 'Identical' },
], stopReason: 'stop', timestamp: 1 };
const live = new AssistantMessageComponent(undefined, true, theme, undefined, 1, [observe]);
live.updateContent(message, true); live.render(50);
console.log('Completed live:');
live.updateContent(message, false); live.render(50);
console.log('Restored:');
new AssistantMessageComponent(message, true, theme, undefined, 1, [observe],
  'entry-123', '2026-11-07T00:00:00Z').render(50);
JS
```

## Other routes considered

- **Custom message renderer:** supports messages the extension creates, not existing assistant messages. Adding duplicate custom messages changes the transcript and session rather than decorating the existing view.
- **Custom editor or controls widget:** solves key ownership and controls, not transcript rendering. Useful as part of a future supported implementation.
- **Custom overlay or replacement transcript:** can be built with public APIs, but violates the chosen interaction requirement.
- **Screen snapshot matching:** gives pixels/terminal cells, not source identity. Repeated messages, offscreen content, transformations, and tool output make text matching insufficient as the message binding contract.
- **Native selection:** already handles visual highlighting internally, but exposes no supported programmatic endpoint API and copies rendered text. Driving private selection fields or synthesizing mouse gestures is not a clean replacement.
- **Walking public `children` arrays:** those arrays exist, but neither their positions nor the private assistant metadata constitute a documented transcript adapter. Replacing `children[0]` with a more elaborate traversal does not solve that.

## Related upstream discussion

- [#6747: Markdown transformation](https://github.com/earendil-works/pi/issues/6747): discusses composable pre-render transforms versus replacement renderers. Relevant precedent for a separate, composable decoration hook.
- [#7828: Message identity in transforms](https://github.com/earendil-works/pi/issues/7828): maintainer invited a PR; identity is now present for persisted rendering, with the live limitation documented above.
- [#7037: Reusable transcript renderer](https://github.com/earendil-works/pi/issues/7037): about rendering another transcript, not decorating the mounted one. It was auto-closed by contributor gating; that is **not evidence of a maintainer rejecting this proposal**.
- [#4992: Selection-safe panels](https://github.com/earendil-works/pi/issues/4992): about layout for persistent panels, not source selection in existing messages. Also auto-closed by contributor gating.

## Proposed upstream request — draft, not submitted

**Title:** Public display-only decorations and layout access for existing transcript Markdown

**Use case:** An extension selects structural units from an existing assistant message with the keyboard, highlights those units in Pi's normal transcript, reveals the selection using native scrolling, and quotes original Markdown into the editor. No duplicate transcript, session mutation, clipboard round-trip, replacement renderer, or injected terminal input.

**Needed capabilities, not an invented claim about existing APIs:**

1. Stable handles identifying a rendered assistant text block by session entry and original content index. Completed live messages must bind to persisted identity without reloading the session.
2. Read-only rendered block snapshots: original source identity, rendered lines, actual width, and block position relative to its message. Changes need an explicit revision or invalidation notification. This lets the extension keep structural parsing and best-effort source alignment outside Pi.
3. Disposable, display-only cell decorations applied **after** Markdown layout, plus a way to reveal a block-relative row. Pi owns viewport coordinates, clipping, redraw scheduling, and cleanup. Changing a decoration should not reparse the whole transcript or mutate cached undecorated lines.

This does not require exporting `AssistantMessageComponent`, exposing private fields, allowing arbitrary layout replacement, or moving our selection algorithm into Pi. A source-to-cell map would be useful but is a separate, larger improvement; exact mapping through arbitrary third-party Markdown transforms is not solved merely by exposing decoration hooks.

**Acceptance checks for an upstream implementation:**

- Two identical messages and two identical blocks remain independently addressable.
- Completed live and restored messages use the same identity contract.
- Decorations preserve wrapping, Markdown syntax highlighting, links, tables, and code fences.
- Scrolling, resize, and expanded tool rows keep geometry and reveal correct.
- Selection updates repaint without rebuilding unchanged Markdown or scanning historical messages per key.
- Clearing, disposing, reloading extensions, and replacing sessions remove decorations.
- Session content and model context never change.

Until a supported path exists, retain the current adapter only as a local interaction prototype. Keep the selection model and tests; replace the adapter rather than conceal its private dependencies. No upstream issue or PR has been posted, and no Pi installation files have been modified.
