# pi-quote-reply

Quote whole or partial agent messages directly from [Pi](https://pi.dev/)'s fullscreen transcript into the editor. The quote is inserted into the editor draft so you can add your reply before sending.

## Install

```sh
pi install npm:pi-quote-reply
```

Run `/reload` in Pi after installing.

## Usage

> [!NOTE]
> Requires fullscreen mode.

Run `/quote`, choose a message with the arrow keys or `h/j/k/l`, and press Enter. Use Tab to shrink the selection, Shift+Tab to expand it, and Enter to insert the quote. Escape goes back or cancels.

Works while the agent is running. Newly completed messages become selectable without reopening `/quote`. Write your reply below the quote and use Pi's normal controls to send or queue it.

See [controls and selection behavior](docs/usage.md) and [compatibility and implementation](docs/implementation.md).

## Planned features

- **Multi-word selection (under consideration):** hold Shift with Left/Right or H/L to extend a word selection across a phrase.

## Development

With Node >=22.19.0:

```sh
git clone https://github.com/lvadla/pi-quote.git
cd pi-quote
npm install
pi install .
```

`npm run typecheck` checks types; `npm test` runs the tests.

## License

[MIT](LICENSE) - Copyright 2026 Lance Vadla.
