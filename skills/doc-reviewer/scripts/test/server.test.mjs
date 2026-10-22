import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const CLI = join(import.meta.dirname, "..", "review.mjs");
const run = promisify(execFile);
const home = mkdtempSync(join(tmpdir(), "doc-reviewer-"));
const doc = join(home, "doc.md");
const env = { ...process.env, DOC_REVIEWER_HOME: home, DOC_REVIEWER_PORT: "0" };

async function cli(...args) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args], { env });
    return { code: 0, body: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.code, body: JSON.parse(error.stdout) };
  }
}

/** Writes the document with its second and last paragraphs. */
function writeDoc(second, last) {
  writeFileSync(doc, ["# Doc", "", second, "", last].join("\n"));
}

/** Stops the server; the next command starts it again. */
async function stopServer() {
  await cli("stop");
  await sleep(300);
}

function port() {
  return JSON.parse(readFileSync(join(home, "server.json"), "utf8")).port;
}

async function act(id, action) {
  const response = await fetch(`http://127.0.0.1:${port()}/api/${id}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  return response.json();
}

let id;
let loop;

/** Runs a loop command, `wait`, `say` or `sync`, as the loop the last `open` started. */
function inLoop(command, ...args) {
  return cli(command, doc, "--loop", loop, ...args);
}

/** Opens the review and keeps the loop it starts. */
async function open() {
  const opened = await cli("open", doc, "--no-browser");
  loop = opened.body.loop;
  return opened;
}

/** The id of the block at `index`, as the server saved it. */
function blockId(index) {
  return JSON.parse(readFileSync(join(home, "reviews", `${id}.json`), "utf8")).review.blockIds[index];
}

before(async () => {
  writeDoc("Alpha text.", "Beta text.");
  const opened = await open();
  assert.equal(opened.code, 0);
  id = opened.body.id;
  const first = await inLoop("wait", "--timeout", "5");
  assert.deepEqual([first.body.type, first.body.block.title], ["pointer", "Doc"]);
  await inLoop("say", JSON.stringify({ kind: "questions", items: [] }));
});

after(async () => {
  await cli("stop");
  rmSync(home, { recursive: true, force: true });
});

test("a comment reaches Claude, and Claude's edit and reply reach the page", async () => {
  await act(id, { type: "comment", block: blockId(1), quote: "Beta", text: "say gamma" });
  const event = await inLoop("wait", "--timeout", "5");
  const { type, block } = event.body;
  assert.deepEqual({ type, block }, { type: "comment", block: { index: 2, title: "Beta text.", startLine: 5, endLine: 5 } });

  writeDoc("Alpha text.", "Gamma text.");
  const said = await inLoop("say", JSON.stringify({ kind: "reply", text: "Renamed." }));
  assert.equal(said.code, 0);
  assert.deepEqual(said.body.changed, [{ index: 2, title: "Gamma text.", startLine: 5, endLine: 5 }]);
});

test("an edit to an approved block without confirmation fails the next call", async () => {
  await act(id, { type: "goto", block: blockId(0) });
  await act(id, { type: "approve", block: blockId(0) });
  const pointer = await inLoop("wait", "--timeout", "5");
  assert.equal(pointer.body.type, "pointer");
  await inLoop("say", JSON.stringify({ kind: "questions", items: [] }));

  const event = await act(id, { type: "comment", block: blockId(1), quote: "Gamma", text: "x" });
  assert.ok(event.id);
  await inLoop("wait", "--timeout", "5");
  writeDoc("Alpha rewritten.", "Gamma text.");
  const refused = await inLoop("sync");
  assert.equal(refused.code, 2);
  assert.equal(refused.body.violations[0].text, "# Doc\n\nAlpha text.");
});

test("after a restart the server resumes the saved review and still refuses an unconfirmed edit to an approved block", async () => {
  writeDoc("Alpha text.", "Gamma text.");
  await inLoop("sync");
  await stopServer();
  writeDoc("Alpha rewritten.", "Gamma text.");
  const refused = await inLoop("wait", "--timeout", "1");
  assert.equal(refused.code, 2);
  writeDoc("Alpha text.", "Gamma text.");
});

test("a wait with nothing to do times out", async () => {
  writeDoc("Alpha text.", "Gamma text.");
  const event = await inLoop("wait", "--timeout", "1");
  assert.equal(event.body.type, "timeout");
});

test("a comment Claude was handling when the server stopped comes back on the next open", async () => {
  await act(id, { type: "comment", block: blockId(1), quote: "Gamma", text: "Why gamma?" });
  const taken = await inLoop("wait", "--timeout", "5");
  await stopServer();
  await open();
  const again = await inLoop("wait", "--timeout", "5");
  assert.deepEqual([again.body.type, again.body.id], ["comment", taken.body.id]);
  await inLoop("say", JSON.stringify({ kind: "answer", text: "It follows beta." }));
});

test("a second open takes the loop over, so the older loop stops", async () => {
  const older = loop;
  const waiting = inLoop("wait", "--timeout", "5");
  await sleep(300);
  await open();
  assert.equal((await waiting).body.type, "replaced");
  assert.equal((await cli("sync", doc, "--loop", older)).body.type, "replaced");
  assert.equal((await inLoop("sync")).body.ok, true);
});

test("Exit hands control back to Claude and stops the server", async () => {
  const address = `http://127.0.0.1:${port()}/api/health`;
  const waiting = inLoop("wait", "--timeout", "5");
  await sleep(300);
  await act(id, { type: "exit" });
  assert.equal((await waiting).body.type, "exit");
  await sleep(500);
  await assert.rejects(fetch(address));
});
