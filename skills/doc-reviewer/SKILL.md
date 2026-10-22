---
name: doc-reviewer
description:
  Use only when the user explicitly asks to review a document together, block by block, the way a human editor works
  through a draft.
argument-hint: [document path]
---

# Doc reviewer

Review a document with the user one block at a time. A pointer marks the block under review. Blocks the user approves
are fixed. Every other block, before or after the pointer, is a draft that you keep consistent with the approved ones.

## Terms

- **Block**: the unit of review. A paragraph together with the lists, tables and code blocks that follow it, up to the
  next paragraph or heading, or the frontmatter. Content with no paragraph before it, such as a list right under a
  heading, is a block of its own. A heading belongs to the block that follows it.
- **Pointer**: the block under review.
- **Approved**: a block the user accepted. Fixed until the user changes it.
- **Open**: any block not approved, wherever it is. Work in progress that you may edit.

## Start

1. If the user did not name a document, ask which one. Do not guess.
2. Read the whole document. You cannot judge a block without knowing what surrounds it.
3. Tell the user how the review works:

   ```markdown
   **How this review works**

   - I go through the document one block at a time and show where I am.
   - Say `approve`, or any clear yes, to approve a block. Approved blocks stay as they are unless you ask to change them.
   - Answer my questions by number: `1: <answer>`.
   - Ask for any change anywhere. I make it and keep the rest of the draft consistent with it.
   - Say `go to <section>` to jump. Asking for a change somewhere else moves me there too.
   - If a change contradicts an approved block, I stop and ask.
   - Say `done` whenever you want to finish.
   ```

4. Point to the first block.

## In the browser

Run the review in the browser unless the user asks for the terminal. The page shows the pointer, the approved blocks,
your questions and the user's comments, so it replaces the turn output under Each turn and the approved list under
Approved text. The rules are unchanged.

`node ${CLAUDE_SKILL_DIR}/scripts/review.mjs <command> <doc>` drives the page. Every command prints JSON.

- `open <doc>`: starts or resumes the review, opens the page, and prints the `loop` id of a new loop. It replaces Start
  steps 3 and 4: give the user the page's address in one line.
- `wait <doc> --loop <id>`: waits up to 280 seconds for the user's next action. Run it with a Bash timeout of 300000
  ms, and again after a `timeout`.
- `say <doc> --loop <id> '<json>'`: shows something on the page, about the action you are handling.
  `{"kind":"questions","items":["..."]}` for its block, `{"kind":"reply","text":"..."}` to report a change on its
  comment, `{"kind":"answer","text":"..."}` to answer a question its comment asks,
  `{"kind":"conflict","lines":[<start line of each approved block>],"message":"..."}`, `{"kind":"notice","text":"..."}`,
  and `{"kind":"finish","summary":"..."}`.
- `sync <doc> --loop <id>`: checks the document after an edit. `wait` and `say` check it first too. Exit code 2 means
  an approved block changed without the user's confirmation: restore the text the output names, then go on.

Each `open` starts a new loop and the older one ends: any command with an older loop id prints `{"type":"replaced"}`.
Stop the loop when you get it.

The loop: wait, handle the action, edit the document with your own tools, `say`, wait again. Edit only between
receiving an action and your next command, because the server treats a change made while you wait as the user's.

The server hands you the user's actions one at a time, in the order they happened, and the page shows the user what is
still waiting. Skip nothing: a pointer move whose block already has its questions never reaches you.

Run the loop in a background agent, so the session stays free while the user reviews. After `open`, start a
general-purpose agent with the document path, the loop id, and an instruction to read this skill and run the loop until
`exit`, `finish`, `complete` or `replaced`, then return where the review stands. The agent runs the loop itself and starts no other agent. When it returns, pass its result on to the user.

| Action         | You do                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment`      | If the comment only asks something, `answer` it and change nothing: the pointer stays. Otherwise make the change, fix the open blocks, then `reply`, which moves the pointer to the block if it is open. If it touches an approved block, send a `conflict` and change nothing. |
| `answer`       | Treat the answer as a change to the block, then post its remaining questions, an empty list when none remain.                                                                                                                                                                   |
| `pointer`      | The user approved, skipped or moved. Post your `questions` for its block, an empty list when you have none.                                                                                                                                                                     |
| `update`       | The user chose Update. Make the whole held change, following `text` when the user added one, then `reply` to its comment.                                                                                                                                                       |
| `drop`         | The user chose Drop and said in `text` what to do instead. Do that without changing an approved block, then `reply`.                                                                                                                                                            |
| `outside-edit` | The user edited the blocks in `changed`. Fix the open blocks if the change affects them.                                                                                                                                                                                        |
| `complete`     | Every block is approved. Close with `finish`, its summary as under Finish.                                                                                                                                                                                                      |
| `finish`       | The user ended the review. Close with `finish`, its summary as under Finish.                                                                                                                                                                                                    |
| `exit`         | The user closed the page and the server stopped. Stop the loop and tell the user in one line where the review stands. `open` resumes it, with the requests still waiting, the one you were handling first.                                                                      |

## Each turn

Show where the pointer is and ask your questions about that block. Do not print the block. Its first 2-3 words tell
the user where to start, and the location opens the rest.

````markdown
---

### ▸ 7/31 · Event flow · docs/guide.md:42 – 48 · `The host sends…`

**Questions**

1. ...
2. ...

approved 5 · open 26
````

- The heading is the pointer: the block's index, its heading or a few-word summary when it has none, the path and
  line it starts on, so the user can open it, then ` – ` and the line it ends on, and the block's first 2-3 words in
  inline code. Edits move lines, so recompute both lines before every turn.
- Number the questions so the user can answer one by number. When there is nothing worth asking, write `No questions`
  in place of the section. Change the document only once the user answers.
- The counts close the turn.

Then act on the user's reply:

| User says                                                                                                            | You do                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approves ("approve", "ok", "next")                                                                                   | Mark the block approved and move the pointer to the next open block, or to the first open block from the top when none follow. Point to it.                                                    |
| Asks for a change to the pointer block                                                                               | Edit it, fix the open blocks, point to it again and list the other changes by location. The pointer stays until the user approves.                                                             |
| Answers a question                                                                                                   | Treat the answer as a change to the pointer block.                                                                                                                                             |
| Asks something about the document without asking for a change                                                        | Answer it. Change nothing, and the pointer stays.                                                                                                                                              |
| Asks to change an approved block, directly or through a change that contradicts it                                   | Stop. Point to the approved block, and to the other place if there is one, and ask the user to confirm. Once the user confirms, make the edit. The block stays approved and the pointer stays. |
| Moves the pointer, or asks for a change to another open block ("go to X", "let's move to X", "section X should ...") | Move the pointer to X, then handle the rest of the request.                                                                                                                                    |
| Says the review is done                                                                                              | Finish.                                                                                                                                                                                        |

Report what you did above the pointer view, one line per kind, or a bullet list under the kind when it has several
items:

```markdown
**Edited** docs/guide.md:42
**Affected** docs/guide.md:58 renamed "flag" to "signal" · docs/guide.md:71 dropped the repeated definition
⚠️ **Conflicts with approved** docs/guide.md:12: it says the core polls, the edit says the host pushes. Which holds?
```

Stop after a ⚠️ line, and hold back the whole request, including its parts that do not conflict: the answer may change
them. Show the pointer view again only once the user resolves it.

## Approved text

Never change an approved block without the user confirming it, even when the user asked for the change. A
contradiction you find in one is a question for the user, not a fix.

Keep the exact text of the approved blocks as a JSON list in the scratchpad: add a block when the user approves it, and
replace its entry when the user changes it. After every edit, check that each one is still in the document with the
command below. A failure you did not cause is the user's own edit: refresh its entry and report it under **Affected**.

```bash
node -e 'const fs = require("fs"); const [doc, approved] = process.argv.slice(1).map((path) => fs.readFileSync(path, "utf8")); const missing = JSON.parse(approved).filter((block) => !doc.includes(block)); if (missing.length) { console.log(missing.join("\n---\n")); process.exit(1); }' DOC APPROVED
```

## Fix the open blocks

After every edit, reread the open blocks and bring them in line with the approved blocks and the edit: facts, names,
terms, numbers, structure and tone. Approved text is the source of truth. Open blocks adapt to it, never the reverse.

Change only what the edit made wrong or inconsistent, not every sentence you would have written differently. The user
reads those blocks when the pointer reaches them.

## Review targets

Judge every block against three targets:

- **Logical consistency**: it agrees with the approved blocks and with itself, its claims follow, and its terms mean
  what they were defined to mean.
- **Tone and style**: it reads like the approved blocks in register, person, tense, terminology and formatting, and
  follows any style rules the project sets.
- **Blind spots**: what a reader will ask that the document does not answer: an undefined term, an unhandled case, a
  missing step, an unstated assumption. Raise it at the block where it first matters.

## Finish

The review is complete when every block is approved or the user says it is. Head the close with
`🏁 **Review complete** · approved 30/31`, then give a short summary of what changed and list any blocks left open by
location.

## Red flags

- Editing an approved block because a change elsewhere made it slightly wrong. That is a contradiction: ask.
- Marking a block approved without the user's approval.
- Acting on your own question before the user answers it.
- Editing an open block the user asked about while the pointer stays somewhere else.
- Saving an approved block from line numbers you did not just read.
