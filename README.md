# Doc reviewer

A Claude Code plugin for reviewing a document with Claude block by block, the way a human editor works through a
draft. The rules live in [`SKILL.md`](skills/doc-reviewer/SKILL.md). The review runs in a local browser page: the user reads the rendered
document, comments on a selection, answers Claude's questions and approves blocks, while Claude edits the file and
keeps the open blocks consistent with the approved ones.

## Install

```
/plugin install doc-reviewer --marketplace johnthecat/claude-doc-reviewer
```

On Claude Code older than 2.1.275, add the marketplace first:

```
/plugin marketplace add johnthecat/claude-doc-reviewer
/plugin install doc-reviewer@doc-reviewer
```

Requirements:

- Node.js 22 or later.
- A recent Chrome for the browser page. The page uses the Popover API, CSS anchor positioning and the Custom Highlight
  API, and loads `marked` from jsdelivr, so it needs network access.

## Usage

```
/doc-reviewer path/to/doc.md
```

The full name is `/doc-reviewer:doc-reviewer`, for when another plugin also has a `doc-reviewer` skill. Asking Claude to review a document with you block by block works too. Claude starts a local server, gives you the
page's address and works through the document with you there. Ask for the terminal instead to review in the chat. A
review is saved under `~/.cache/doc-reviewer`, so opening the same document again resumes it.

| Variable                    | Default                 | Meaning                                                                   |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `DOC_REVIEWER_HOME`         | `~/.cache/doc-reviewer` | Where reviews and the running server's address are kept.                  |
| `DOC_REVIEWER_PORT`         | `4388`                  | The server's port. A random free port is used when another app holds it.  |
| `DOC_REVIEWER_IDLE_MINUTES` | `120`                   | Minutes with no page open and no Claude waiting before the server stops. |

## Architecture

The server owns the review. The page and Claude only send it actions and read its views, so there is one copy of the
state and one order of changes.

```
Claude ── review.mjs (CLI) ──┐                       ┌── page: web/*.js
                              ├── server.mjs (HTTP) ──┤
file on disk ── watch ────────┘          │            └── stream of views
                                     Session
                                         │
                       Review ── Document, Requests
                                         │
                                       views
```

### Layers

| Layer       | Module                     | Responsibility                                                                            |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| Parsing     | `skills/doc-reviewer/scripts/lib/blocks.mjs`   | Splits Markdown into blocks.                                                              |
| Domain      | `skills/doc-reviewer/scripts/lib/document.mjs` | One version of the document; carries block ids across edits.                              |
|             | `skills/doc-reviewer/scripts/lib/requests.mjs` | Claude's requests: the waiting ones and the one in progress.                              |
|             | `skills/doc-reviewer/scripts/lib/review.mjs`   | The review's entities and rules: user actions, Claude's responses, new document versions. |
| Views       | `skills/doc-reviewer/scripts/lib/views.mjs`    | What the page draws and what Claude receives.                                             |
| Application | `skills/doc-reviewer/scripts/lib/session.mjs`  | A live review: applies changes in order, saves, publishes, owns Claude's loop.            |
|             | `skills/doc-reviewer/scripts/lib/store.mjs`    | Saved reviews on disk.                                                                    |
| Transport   | `skills/doc-reviewer/scripts/server.mjs`       | HTTP routes, the page stream, one server at a time.                                       |
|             | `skills/doc-reviewer/scripts/review.mjs`       | The command line Claude runs.                                                             |
| Page        | `skills/doc-reviewer/scripts/web/`             | One module per part of the page, drawing from the latest view.                            |

The domain does no I/O and knows nothing of HTTP or the page. The views read the domain and change nothing. The
session is the only place that mutates a live review.

### Entities

- **Block**: a paragraph with the lists, tables and code that follow it. Its id survives edits.
- **Pointer**: the block under review.
- **Question**: Claude's question on a block, with the user's answer. Dropped when the block's text changes.
- **Comment**: the user's comment on a selection. Sent, held, done once Claude changed something, or answered when it
  only asked.
- **Conflict**: a change held back because it touches approved blocks, until the user updates or drops it.
- **Request**: something Claude must handle, in order: a comment, an answer, a pointer move, an update or drop, an
  edit made outside, or the end of the review.

The user's actions are `comment`, `answer`, `approve`, `skip`, `goto`, `update`, `drop`, `finish` and `exit`. Claude's
responses are `questions`, `reply`, `answer`, `conflict`, `notice` and `finish`.

### Concurrency

The user, Claude and the file all change the review, so each rule below decides who wins instead of timing:

- **Requests queue.** Claude takes one request at a time, in order, so a new action never interrupts the one in
  progress. A request Claude was handling when the review closed goes back to the front, unless Claude already
  responded to it.
- **Actions name their target by id.** Approve and skip name the block the user saw, an answer names its question, and
  update and drop name their conflict. When Claude moved the pointer, replaced the question or settled the conflict
  meanwhile, the action is refused rather than applied to something else.
- **One loop per review.** Each `open` starts a new loop with its own id. Calls from an older loop are answered
  `replaced`, so two Claude sessions never work on the same review.
- **One server.** A server started while another runs exits, so a review never lives in two processes.
- **Drafts belong to a review.** Unsent text is kept in the browser under the review's start time, so a review started
  over never picks up an older one's drafts.

One limit remains: the server tells Claude's edits from the user's by Claude's turn. A change to the file while Claude
holds a request counts as Claude's, so a user's edit to an approved block made at that moment is refused as Claude's.

## Development

```bash
node --test "skills/doc-reviewer/scripts/test/*.test.mjs"
```

CI runs the same command on Linux and macOS with Node 22, 24 and 26, and checks the plugin with
`claude plugin validate . --profile directory --strict`. The plugin icon, `.claude-plugin/icon.png`, is rendered from
`docs/icon.svg`.

## Releasing

The version lives only in `.claude-plugin/plugin.json`. Bump it with every release: `claude plugin update` compares
versions, so users keep the old copy until it changes.

## License

[MIT](LICENSE)
