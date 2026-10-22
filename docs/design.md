# Doc reviewer web UI

## Intent

The `doc-reviewer` skill (`skills/doc-reviewer/SKILL.md`) runs a block-by-block review of a document in the
terminal. The user reads the document in their own editor, matches line numbers from the terminal, and types replies
back. Navigation is the weak point: the content and the controls live in different windows.

This design moves the review into a local browser page where the content and the controls sit together, in the spirit
of [Lavish](https://github.com/kunchenguid/lavish-axi): the user highlights text in the rendered document, comments on
it, sends, and sees the document update. The review rules stay exactly as the skill defines them. Only the surface
changes.

## Goals

- Every rule in the skill still holds: the pointer, approved blocks are fixed, open blocks may change anywhere,
  any change to an approved block needs the user's confirmation, and a conflict holds back the whole request.
- The user reads the rendered document and acts on it in place: select text, comment, send.
- Each sent comment reaches Claude as one prompt carrying its context: the quoted text, the block, and the block's line
  range.
- Claude's responses appear in the page where they apply: questions on the pointer block, a confirmation alert on an
  approved block, a flash on changed blocks, and a short notice of what changed.
- The page always shows the current file.

## Non-goals

- Editing the document by typing in the page. The user comments; Claude edits.
- Formats other than Markdown.
- Several people reviewing the same document at once.
- Publishing or sharing the review.

## Anti-goals

The first version fails, even if it works, when:

- the page is cluttered: boxes around every block, panels full of state, a busy chrome;
- it looks like Lavish's UI, which the user dislikes;
- the user has to approve or confirm more than the rules require. The loop is comment, send, updated. A confirm appears
  only when a change touches an approved block.

## Decided

### Shape

- A Claude Code plugin inside this repository, so it can be iterated on quickly. Its own repository is a later step.
- The plugin carries the skill and a small local server with a command-line interface, the way Lavish works. The
  browser is the review surface. Claude drives the server through the command line.
- While the review runs, the Claude session in the terminal waits on the server for the next user action. The user
  types in the terminal only to stop the review. The terminal turn output can shrink to a short status line.
- Node for the server and the command-line interface. The user preferred Node over Python for the earlier check script.

### Review state lives in the server

The server owns the review state: the document path, the block list with line ranges, the pointer, and the exact text
of each approved block. This replaces the scratchpad JSON list and the hand-tracked line numbers in the current skill,
both of which went wrong during the first review. After each edit Claude tells the server to resynchronise. The server
re-parses the file, recomputes line ranges, checks every approved block is still present, and pushes the result to the
page. A failed check comes back to Claude as an error naming the block.

The server also watches the file, so an edit made outside Claude shows up in the page. Per the skill, a change to an
approved block that Claude did not make is the user's own edit.

### Blocks

Blocks follow the skill's definition: a paragraph together with the lists, tables and code blocks that follow it, up to
the next paragraph or heading; content with no paragraph before it is a block of its own; a heading belongs to the
block that follows it; the frontmatter is a block.

### Loop

1. Claude starts or resumes the server for a document and opens the page. Sessions are keyed by file path. Each open
   starts a new loop with its own id, and calls from an older loop are answered `replaced`, so two Claude sessions never
   work on one review.
2. Claude waits for the next user action. The command returns one action as JSON.
3. Claude handles it under the skill's rules, edits the file, resynchronises, and posts its response.
4. The page shows the response and the updated document. Back to step 2.

User actions: a comment on a text selection, an answer to a numbered question, approve, next block, go to a block,
update or drop a pending change to an approved block, and finish. A comment on an open block other than the pointer block
moves the pointer there once Claude replies to it with a change, as the skill says. Actions name their target by its id: the block, the question or the held change the user saw. An action
the user started before an edit above the block still lands on the block they saw. One whose target is gone, or whose
block the pointer has left since, is refused rather than applied to something else. A question takes
one answer, and the page sends a comment or an answer once even when the user submits it twice. Approving an approved
block does nothing, and a finished review takes no more actions. The server enforces these rules, not only the page.
Dropping a held change without a resolution comment asks nothing of Claude, since there is nothing for Claude to do.

The server also says where the pointer block's request stands and how each answer is doing, so the page only draws it.
The pointer card is patched in place as that changes, so an answer being typed keeps its field, caret and undo history.
A draft answer belongs to its block and question, and survives the pointer moving away and back.

Claude's responses: the questions for the pointer block, a reply to a comment after a change, an answer to a comment
that only asks a question, a pending change to an approved block awaiting confirmation, the list of edited and affected
blocks, and the review summary on finish. Questions, a reply, an answer and a conflict are about the request Claude is
handling, so Claude names no block or comment. An answer changes nothing else: the pointer stays, every block keeps its
questions, and no request follows from it.

A review the server saved resumes on its next request after a restart, for Claude and for the page alike. It keeps its
saved text, so an edit made while the server was down is checked on Claude's next call like any edit of Claude's.

Comments the user sends while Claude is still working queue in the server and come out of the next wait in order.

### Look

The approved mockup is
[`mockup.html`](mockup.html). Open it in a browser.

- Dark by default, in GitHub's Primer design system. The design tokens are `@primer/primitives` (dark theme) and the
  icons are Octicons, both copied into the plugin. Each part of the page is the Primer component GitHub uses for it,
  with the declarations taken from `@primer/react`:
  - The top bar is an app header: a Label for each count, an invisible Button for Claude's status with a
    CounterLabel of waiting requests, and Buttons for Activity, Help, Finish review and Exit.
  - The pointer card and the comments are Boxes with a header, a body and a footer, as GitHub draws comments.
  - Answers and comments are TextInputs. The send button is a primary IconButton, and key hints are KeybindingHints.
  - A conflict is a warning Banner and the finished review a success Banner.
  - The request list is an ActionList in an Overlay, and the Activity log a Timeline in a side Dialog.
  - Work in progress shows Primer's Spinner, toasts are floating overlays, and the closed page is a Blankslate.
- A reading page in the manner of HackMD: one centred column of rendered Markdown, comments in a rail to its right.
  The document itself is styled with GitHub's Markdown styles (`github-markdown-css`, copied into the plugin), so it
  reads as it does on GitHub. They carry no colors of their own and take every color and size from the Primer tokens.
- Block state is only a thin bar in the left margin: green for approved, amber for the pointer, nothing for open. The
  pointer's bar is thicker, and stays green when the pointer is on an approved block. Approved text is slightly
  dimmed. No boxes around blocks.
- A slim top bar: the file path, approved and open counts as badges, a connection badge, an Activity button, a Help button, a
  Finish review button and an Exit button. Exit closes every open page of the review at once, stops the server and
  hands control back to Claude; the review stays saved.
- The pointer card sits in the rail beside the pointer block, below that block's comments: its index, title and
  lines, the numbered questions each with an answer field, and Approve and Skip buttons that show their keys, `A` and
  `J`. While a card taller than the window scrolls, its header stays under the top bar and its footer, which holds the
  buttons, stays at the bottom of the window. The card has no footer when the pointer is on an approved block. On a page too narrow for the rail, it and the comments sit under their blocks. The answer field starts at one line and grows with
  its text; Enter or the ↵ button sends it and Shift+Enter adds a line. A sent answer shows whether it is queued, being
  applied, or done. When an edit clears a block's questions, the server asks Claude for new ones, so the card never
  waits on nothing.
- Cards in the rail never overlap. Each sits beside its block or, when the card above reaches further down, right
  under that card. A card keeps its place on the page between updates, so when one above it grows, shrinks or
  appears, it slides to its new place.
- Every action is a request for Claude. Claude takes them one at a time, in order, so a new action never interrupts the
  one in progress. The Claude badge counts the waiting requests and opens their list, and the pointer card says whether
  its questions are being written or how many requests are ahead. Exit goes first; the rest stay saved for the next
  session.
- Questions stay with their block: they come back when the pointer returns to it, and any change to the block's text
  drops them.
- Clicking a block moves the pointer to it at once, without scrolling the page. Clicking a word also selects that
  word.
- Selecting text shows a small Comment button just above it. The comment form opens as a popover anchored to the
  selected text: below it, or above it when there is no room, and following it as the page scrolls. The quoted text
  stays highlighted while the form is open. The form has Comment (`⌘↵`) and Cancel (`Esc`). A sent comment moves to the
  rail beside its block and shows that it is queued, then that Claude is working on it.
  The page uses the platform for this: the Popover API for the form, CSS anchor positioning for where the button and
  the form sit, and the CSS Custom Highlight API for the quoted text.
- A change to an approved block shows as an amber alert under that block, with a field for how to resolve it and
  Update and Drop. The held comment's card in the rail points to it, and clicking the card scrolls to the alert. It is
  the only confirmation in the UI.
- After an edit, each changed block flashes briefly and one toast names the edited block and the affected ones.
- Activity opens the log of past comments, answers and edits.
- Help opens a modal Dialog with the review rules and how to use the page.

## Calls made without the user

The user asked for the design to be settled without another round of questions. These are the designer's calls, open
to change:

- **Approve and Skip.** The pointer card has Approve (`A`), which approves the block and moves the pointer as the skill
  says, and Skip (`J`), which moves the pointer to the next open block without approving. Skip is the skill's "moves
  the pointer" reply. Approval only ever comes from Approve, so the page never approves a block the user did not.
- **Drop ends the held request.** Update confirms it and Claude makes the whole edit, following the resolution comment
  when there is one. Drop with a resolution comment asks Claude to do what it says without changing an approved block.
  Drop without one drops the whole comment. Comments sent after a held one keep reaching Claude in order. Each is
  judged on its own under the rules.
- **The review state persists.** The server stores each review on disk in the user's cache directory, keyed by the
  document's absolute path: the approved blocks, the pointer, the questions, the comments, the requests for Claude
  and the activity log. Stopping the session in the terminal or the server shutting down when idle pauses the review.
  Starting it again on the same file resumes it, and the request Claude was handling when it paused comes first again,
  unless Claude had already responded to it. What the user typed and did not send, answers, resolution comments and an
  open comment form, stays in the browser's storage for that review and comes back with the page. Finish review ends it and Claude closes with the skill's summary. Starting again after Finish begins a new
  review.
- **One skill, two surfaces.** The plugin's skill is the existing `doc-reviewer` skill, moved into the plugin folder
  in place. Its rules stay. A new section says how to run the review in the browser, and that in the browser the server
  keeps the approved blocks and runs the check in place of the scratchpad list. The terminal review keeps working.
- **The server derives what changed.** After each edit the server compares the old and new block lists, so the flash
  and the toast need nothing from Claude beyond the reply to the comment.
- **The browser is the default surface.** The skill opens the browser review unless the user asks for the terminal.
- **Replies live on the comment card.** Claude answers every comment on its card in the rail, with a reply when it
  changed something and an answer when the comment only asked a question. A replied card collapses to one line that
  expands on click, and folds again on a click. An answered card starts open, so the answer can be read, and folds the
  same way.
- **Claude edits the file with its own tools.** The server tells Claude's edits from the user's by timing: changes
  that land between handing Claude an action and Claude's next call are Claude's, changes while Claude waits are the
  user's. Each loop step is a command run plus a file edit, so the review runs smoothly in a permission mode that
  allows both, such as auto mode. The plugin does not change permission settings.
- **Local for now.** The plugin stays in the working tree. Landing it on `main`, with its documentation and continuous
  integration, is a later step.

## Left to the builder

- Where the plugin sits in the repository and how a session loads it, within the repository's layout and documentation
  rules in `AGENTS.md`.
- Whether the skill moves into the plugin or stays in `.claude/skills/`, and how its turn-output sections change now that
  the page carries the review. The rules sections stay as they are.
- The command-line commands and their names, the action and response JSON shapes, the port, and the server's idle
  shutdown.
- The Markdown parser and renderer, and whether the page needs a build step. Prefer few dependencies.
- How a text selection maps back to a block and line range.
- What the Activity log shows and keeps.
