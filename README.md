# pi-quote

Quote agent messages or selected Markdown directly from Pi's existing fullscreen transcript.

**Development prototype:** the current transcript adapter uses private Pi metadata and temporarily wraps render methods. Publication is on hold pending a supported integration. The repository's `docs/transcript-api-review.md` records the API audit, runtime findings, and a draft upstream request.

## Install from a local checkout

```sh
cd /path/to/pi-quote
npm ci --ignore-scripts
pi install .
```

Run `/reload`, then `/quote` in fullscreen Pi while the agent is idle.
The regular transcript stays mounted: there is no replacement transcript or overlay.

## Agent message selection

The latest completed agent text message starts highlighted.

- `h`, `k`, Left, Up: previous agent message.
- `l`, `j`, Right, Down: next agent message.
- Enter: confirm the agent message and enter text selection, with the whole agent message selected.
- Escape or Ctrl+C: cancel.

## Text selection

- `h`, Left: previous unit at the current level.
- `l`, Right: next unit at the current level.
- `k`, Up: nearest unit above at the current level.
- `j`, Down: nearest unit below at the current level.

Up/down follow rendered lines, including soft wrapping, and remember the horizontal column across repeated moves. Short lines do not reset that column. Left/right or changing levels resets it. If no other unit exists in the requested vertical direction, selection stays put; up/down never fall back to previous/next on the same line.
- Shift+Tab: expand the level, such as word → sentence → block → whole agent message.
- Tab: shrink the level. Shrink reverses the most recent expansion.

Navigation never changes the level. At Block level, left/right select the previous/next top-level paragraph, heading, list, code block, blockquote, or table in source order. Shrinking a paragraph selects a sentence; shrinking a list selects a list item; shrinking a code block selects a code line. At Sentence level, movement selects another sentence. Left/right stop at the first/last unit; up/down stop when there is no other unit above/below. With the whole agent message selected, navigation stays on that single unit until you shrink the level. A one-sentence paragraph still has distinct Sentence and Block levels even though they highlight the same text.

Word level includes visible symbols and punctuation as separate units, including arrows, slashes, emoji, and code operators. Whitespace and Markdown formatting delimiters are excluded; literal punctuation inside code remains selectable.

Alt+i/o and w/b are not assigned. Only Tab and Shift+Tab change the level.

- Enter: insert only the selected source Markdown as `> ` quoted lines, with the cursor on a blank line below. Never sends automatically.
- Escape: return to agent message selection; Escape again cancels.
- Ctrl+C: cancel directly.

Scrolling is handled by Pi's native fullscreen TUI, including its configured keyboard bindings and mouse wheel. The quote extension does not implement or advertise separate scrolling controls. Hints above the input editor show the current mode, selection kind, and controls. The selected range uses reverse video. Inside the selection, an underline marks the anchor without interrupting the inverted highlight.

The shared heading is **Quote agent message in editor**. In agent message selection, only **40/44** follows the heading, without repeating “agent message”. In text selection, it shows the current unit and its position among units of that kind within the chosen agent message: **Word 8/120**, **Sentence 2/9**, **Block 3/7**, etc. Selecting the whole agent message shows **Whole agent message 1/1**. Counts follow source order and update on movement, expansion, and shrinking; overlapping units of different kinds are counted independently. Tables remain atomic, so their contents are not separate selectable words or sentences. On narrow terminals the unit and counter take priority over the heading.

Block is the shared top-level unit, so navigation does not skip lists between prose paragraphs. Finer selection units include words, sentences, inline formatting, list items, nested lists, paragraphs inside blockquotes, and code lines. Sections group blocks beneath headings. Code selection uses Markdown structure and words, not a language-specific code AST. Tables are atomic (whole-table selection only).

For example: `/quote`, Enter, Tab to choose a level, `h`/`l` to navigate units in source order or `j`/`k` to move vertically, Shift+Tab to expand, Enter to quote. To quote a whole agent message, press Enter twice after choosing it.

Existing editor text is preserved and the quote is appended after it. Thinking and tool results are not quoted. Original render methods are restored on exit, session changes, and shutdown.

## Compatibility and implementation

Tested against Pi 1.5.0's actual fullscreen renderer. No Pi installation files are changed. The extension uses public TUI scrolling and input APIs, but its guarded adapter reads internal `AssistantMessageComponent` metadata (`lastMessage`, `isStreaming`, `markdownSlots`) and assumes the mounted document is the first TUI child. Pi changes may require updating this adapter.

`marked` provides Markdown structure; `diff` maps surviving source characters onto Pi's existing rendered lines, ignoring whitespace so wrapping and padding do not shift source offsets. The mapping is cached by rendered output and width. Highlighting preserves the renderer's foreground colors and links. Source slices, not text reconstructed from the terminal, are quoted. Display-only transformations such as rendered math can make some subranges unavailable; invisible ranges are rejected rather than silently quoted. Partial source selections can include partial Markdown syntax.

Navigation updates selection state immediately and coalesces painting to the latest state once per frame. Key release flushes the final pending frame; confirmation and cancellation clear it. Unit lists, highlighted output, and vertical navigation geometry are cached, so repeated word navigation does not sort units or measure earlier transcript content for every key event. Vertical geometry is rebuilt when the selected level or rendered layout changes.

## Development

From a fresh checkout, with Node >=22.19.0:

```sh
npm ci --ignore-scripts
npm run check
```

`npm run typecheck` runs the repository's strict `tsconfig.json`. `npm test` runs the regression suite with Node's built-in test runner. Both use locked local development dependencies, including Pi 1.5.0; neither requires a global Pi installation or files outside this repository.

- `test/selection.test.mjs`: structural levels, counters, nested lists, code, atomic tables, and horizontal boundaries.
- `test/symbols.test.mjs`: symbol/Unicode reachability, formatting exclusions, and exact source quoting.
- `test/spatial.test.mjs`: actual Pi fullscreen rendering, vertical movement, column memory, wrapping, resize, and repeat/release coalescing.
- `test/lifecycle.test.mjs`: message filtering, hints, cancellation, quote insertion, cursor placement, and session cleanup.
- `test/identity.test.mjs`: duplicate messages and blocks in live-completed and restored messages.
- `test/helpers.mjs`: shared in-memory terminal and real Pi component setup. No live terminal or model calls.

Repeat tests assert that key bursts do not force per-key renders or scan earlier messages. Timing is diagnostic, not a machine-dependent pass/fail threshold. Test files and development configuration are kept out of the published package via the `files` allowlist.
