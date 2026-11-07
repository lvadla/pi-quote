# Using pi-quote

Run `/quote` in fullscreen Pi to select a completed agent message.

## Choose a message

| Key | Action |
| --- | --- |
| h, k, Left, Up | Previous message |
| l, j, Right, Down | Next message |
| Enter | Select text within the message |
| Escape or Ctrl+C | Cancel |

## Select text

| Key | Action |
| --- | --- |
| h, Left | Previous unit |
| l, Right | Next unit |
| k, Up | Unit above |
| j, Down | Unit below |
| Tab | Shrink selection |
| Shift+Tab | Expand selection |
| Enter | Insert the quote into the editor |
| Escape | Return to message selection |
| Ctrl+C | Cancel |

Text selection starts at the first block. Use Tab to select smaller passages, such as sentences or words. To quote the whole message, expand with Shift+Tab until it is selected.

Enter inserts the selected Markdown as a blockquote, with the cursor below it. Write your reply and use Pi's normal controls to send or queue it.

## Availability and limitations

- You can quote completed messages while the agent works. New messages become selectable automatically once completed.
- Thinking and tool results are not selectable. Tables can only be selected as whole blocks.
- Successful compaction closes selection when Pi rebuilds the transcript.
- Partial quotes can contain incomplete Markdown syntax. Matching rendered text to source is heuristic; transformed content such as rendered math may map incorrectly. Check the inserted quote before sending.
