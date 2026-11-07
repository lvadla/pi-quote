import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { Container, Text, TuiAltScreen, Editor } from "@earendil-works/pi-tui";

const jiti = createJiti(import.meta.url);
const { default: extension } = await jiti.import("../index.ts");
const agentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
// Exercise the same Pi internals the adapter integrates with, from the pinned
// development dependency rather than a user's global Pi installation.
const internal = (path) => import(fileURLToPath(new URL(path, agentEntry)));
const { AssistantMessageComponent } = await internal(
  "modes/interactive/components/assistant-message.js",
);
const { createChatViewport } = await internal(
  "modes/interactive/chat-viewport.js",
);
const { theme, initTheme, getEditorTheme } = await internal(
  "modes/interactive/theme/theme.js",
);
initTheme("dark");

export function createHarness() {
  const terminal = {
    columns: 72,
    rows: 24,
    kittyProtocolActive: false,
    start(onInput) {
      this.input = onInput;
    },
    stop() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  };
  const tui = new TuiAltScreen(terminal);
  const document = new Container();
  document.addChild(new Text("Original transcript header"));
  const message = (text, stopReason = "stop") => ({
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    timestamp: 1,
  });
  document.addChild(
    new AssistantMessageComponent(message("Earliest response"), true),
  );
  const old = new AssistantMessageComponent(
    message("Older **response**\n\n```ts\nconst x = 1;\n```"),
    true,
  );
  document.addChild(old);
  document.addChild(
    new Text(
      Array.from({ length: 45 }, (_, i) => `Unchanged tool result ${i}`).join(
        "\n",
      ),
    ),
  );
  const latest = new AssistantMessageComponent(
    message("Latest response.\n\n- item one\n- item two"),
    true,
  );
  document.addChild(latest);
  const failed = new AssistantMessageComponent(
    message("Failed partial", "error"),
    true,
  );
  document.addChild(failed);
  const streaming = new AssistantMessageComponent(
    message("Streaming partial"),
    true,
  );
  streaming.updateContent(message("Streaming partial"), true);
  document.addChild(streaming);
  const widgets = new Container();
  const editor = new Editor(tui, getEditorTheme());
  const editorBox = new Container();
  editorBox.addChild(editor);
  const layout = createChatViewport({
    document,
    pendingMessages: new Container(),
    status: new Container(),
    widgetsAbove: widgets,
    editor: editorBox,
    footer: new Text("Original footer"),
    scrollbar: "always",
  });
  tui.addChild(document);
  tui.addChild(widgets);
  tui.addChild(editorBox);
  tui.setLayoutRoot(layout.root);
  tui.start();
  tui.renderNow();
  const commands = new Map(),
    events = new Map();
  extension({
    registerCommand: (name, command) => commands.set(name, command),
    on: (event, handler) => events.set(event, handler),
  });
  let input;
  const notices = [];
  const ctx = {
    mode: "tui",
    isIdle: () => true,
    ui: {
      theme,
      notify: (text) => notices.push(text),
      getEditorText: () => editor.getText(),
      setEditorText: (text) => editor.setText(text),
      setWidget: (_key, factory) => {
        widgets.clear();
        if (factory) widgets.addChild(factory(tui, theme));
        tui.requestRender();
      },
      onTerminalInput: (handler) => {
        input = handler;
        const unsubscribe = tui.addInputListener(handler);
        return () => {
          unsubscribe();
          input = undefined;
        };
      },
    },
  };

  return {
    terminal,
    tui,
    document,
    old,
    latest,
    widgets,
    editor,
    commands,
    events,
    notices,
    ctx,
    message,
    get input() {
      return input;
    },
    stop() {
      events.get("session_shutdown")();
      tui.stop();
    },
  };
}
