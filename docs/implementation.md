# Compatibility and implementation

Requires Pi's fullscreen interface. Tested with Pi 1.5.0, without requiring that exact version.

## Transcript integration

`index.ts` integrates with Pi's public scrolling and input APIs and its internal assistant components. It reads `lastMessage`, `isStreaming`, and `markdownSlots`, assumes the document is the first TUI child, and temporarily wraps selected Markdown components' render methods. Changes to Pi's internal structure may require adapter updates.

## Source mapping

`selection.ts` uses `marked` to identify Markdown units and `diff` to align rendered characters with source offsets. This is a heuristic, not a source map supplied by Pi. Repeated text, removed markup, and display-only transformations can produce incorrect mappings.

`rendering.ts` applies highlighting to rendered lines and formats original source as a quote.
