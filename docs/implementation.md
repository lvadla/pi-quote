# Compatibility and implementation

Requires Pi's fullscreen interface. Tested with Pi 1.5.0, without requiring that exact version.

## Transcript integration

`index.ts` integrates with Pi's public scrolling and input APIs and its internal assistant components. It reads `lastMessage`, `isStreaming`, and `markdownSlots`, assumes the document is the first TUI child, and temporarily wraps selected Markdown components' render methods. Changes to Pi's internal structure may require adapter updates.

## Source mapping

`markdown.ts` uses Pi's internal tokens, block cache, and block renderer to associate top-level blocks with source ranges and screen rows. Source offsets account for whitespace changes, omitted link definitions, and terminal decorations such as clickable file links. All non-whitespace Markdown characters must still agree in order; transformers that rewrite them are not mapped. Reconstructed rows must match Pi's output exactly.

`selection.ts` uses `marked` to identify selection units and `diff` to map characters within each block. Top-level tables bypass matching. A block without a character mapping remains selectable as a whole. Character matching is still heuristic, especially for repeated text and display-only transformations.

`rendering.ts` applies highlighting to rendered lines and formats original source as a quote.

## Local session tests

Run `npm run test:session -- /path/to/session.jsonl` to check completed assistant messages at three widths using the same component harness as the synthetic tests. It checks navigation, highlighting, unchanged display text, quotes, and cleanup. It does not load other installed extensions, replay live events, or prove every word's highlight position; quote expectations use the selection model. Transformer interactions are tested explicitly in the regression suite.

Keep the log outside the repository. The runner reads it into memory and reports only counts and failure coordinates/categories, without writing fixtures or snapshots. Normal tests do not require a local log.
