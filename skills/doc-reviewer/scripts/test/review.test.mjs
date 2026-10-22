import assert from "node:assert/strict";
import { test } from "node:test";
import { Review } from "../lib/review.mjs";
import { forClaude, pageView, syncForClaude } from "../lib/views.mjs";

const DOC = ["# Doc", "", "Alpha text.", "", "Beta text.", "", "Gamma text.", "", "Delta text."].join("\n");

function idAt(review, index) {
  return review.blocks[index].id;
}

function titles(review, predicate) {
  return review.blocks.filter(predicate).map((block) => block.title);
}

/** Approves or skips the block the pointer is on, as the page does. */
function onPointer(review, type) {
  return review.act({ type, block: review.pointerBlock().id });
}

/** Hands Claude the next request as Claude receives it. */
function handOut(review) {
  const request = review.take();
  return request && forClaude(review, request);
}

function view(review) {
  return pageView(review, "away");
}

/** The pointer block's questions as the page shows them, without their ids. */
function shownQuestions(review) {
  return view(review).questions?.map(({ text, answer, status }) => ({ text, answer, status })) ?? null;
}

function questionId(review, blockIndex, number) {
  return review.questions.get(idAt(review, blockIndex))[number - 1].id;
}

/** The review as the server restores it from disk. */
function reload(review) {
  return new Review(review.path, review.document.text, JSON.parse(JSON.stringify(review)));
}

/** Approves the first block and has Claude hold back a comment's change to it. Returns the conflict's id. */
function heldConflict(review) {
  onPointer(review, "approve");
  review.act({ type: "comment", block: idAt(review, 0), quote: "Alpha", text: "change it" });
  review.take();
  review.take();
  const { id } = review.say({ kind: "conflict", lines: [1], message: "touches Doc" });
  review.requests.finish();
  return id;
}

test("approving moves the pointer to the next open block and wraps to the top", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "goto", block: idAt(review, 3) });
  onPointer(review, "approve");
  assert.equal(review.pointerBlock().title, "Doc");
  onPointer(review, "approve");
  assert.equal(review.pointerBlock().title, "Beta text.");
  assert.deepEqual(titles(review, (block) => review.isApproved(block)), ["Doc", "Delta text."]);
});

test("approving the last open block completes the review", () => {
  const review = new Review("/doc.md", "Only block.");
  onPointer(review, "approve");
  assert.deepEqual(review.requests.waiting.map((request) => request.type), ["complete"]);
});

test("approve and skip act on the block the user saw, so a pointer Claude moved meanwhile refuses them", () => {
  const review = new Review("/doc.md", DOC);
  const seen = idAt(review, 0);
  review.act({ type: "comment", block: idAt(review, 2), quote: "Gamma", text: "shorter" });
  review.take();
  review.say({ kind: "reply", text: "Shortened." });
  for (const type of ["approve", "skip"]) {
    assert.throws(() => review.act({ type, block: seen }), /moved to another block/);
  }
  assert.deepEqual([review.pointerBlock().title, review.approved.size], ["Gamma text.", 0]);
});

test("requests wait their turn: moving on while Claude works keeps what Claude is doing and what is queued", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  review.take();
  onPointer(review, "approve");
  review.act({ type: "comment", block: idAt(review, 3), quote: "Delta", text: "shorter" });
  review.act({ type: "goto", block: idAt(review, 2) });
  assert.deepEqual(
    view(review).requests.map((request) => [request.status, request.label]),
    [
      ["working", "Questions for Beta text."],
      ["queued", "Questions for Gamma text."],
      ["queued", "Comment on Delta text."],
    ],
  );
  assert.equal(handOut(review).block.title, "Gamma text.");
});

test("skip moves on without approving", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "skip");
  assert.equal(review.pointerBlock().title, "Beta text.");
  assert.equal(review.approved.size, 0);
});

test("a comment on another open block moves the pointer there once Claude replies, one on an approved block does not", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  review.act({ type: "comment", block: idAt(review, 2), quote: "Gamma", text: "shorter" });
  review.act({ type: "comment", block: idAt(review, 0), quote: "Doc", text: "rename" });
  assert.equal(review.pointerBlock().title, "Beta text.", "Claude may only answer, so the pointer waits for the reply");
  const handed = [handOut(review), handOut(review)];
  review.say({ kind: "reply", text: "Shortened." });
  assert.equal(review.pointerBlock().title, "Gamma text.");
  handed.push(handOut(review));
  review.say({ kind: "reply", text: "Renamed." });
  assert.equal(review.pointerBlock().title, "Gamma text.");
  assert.deepEqual(
    handed.map((request) => [request.type, request.block.title, request.approved]),
    [
      ["pointer", "Beta text.", false],
      ["comment", "Gamma text.", false],
      ["comment", "Doc", true],
    ],
  );
});

test("an answer to a question leaves the pointer, the questions and the requests as they are", () => {
  const review = new Review("/doc.md", DOC);
  review.take();
  review.say({ kind: "questions", items: ["Keep it?"] });
  review.requests.finish();
  review.act({ type: "comment", block: idAt(review, 2), quote: "Gamma", text: "why gamma?" });
  review.take();
  review.say({ kind: "answer", text: "Because it follows beta." });
  review.requests.finish();
  const { pointer, requests, comments } = view(review);
  assert.deepEqual(
    { pointer, questions: shownQuestions(review).map((question) => question.text), requests, comment: [comments[0].status, comments[0].reply] },
    { pointer: 0, questions: ["Keep it?"], requests: [], comment: ["answered", "Because it follows beta."] },
  );
});

test("a comment stays with its block when Claude edits that block", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "comment", block: idAt(review, 1), quote: "Beta", text: "shorter" });
  review.sync(DOC.replace("Beta text.", "Beta."), "claude");
  assert.deepEqual(
    view(review).comments.map((comment) => [comment.text, comment.index]),
    [["shorter", 1]],
  );
});

test("an action lands on the block the user saw, even after an edit moved it", () => {
  const review = new Review("/doc.md", DOC);
  const gamma = idAt(review, 2);
  review.sync(DOC.replace("Alpha text.", "Alpha text.\n\nInserted text."), "claude");
  review.act({ type: "goto", block: gamma });
  review.act({ type: "comment", block: gamma, quote: "Gamma", text: "shorter" });
  assert.deepEqual([review.pointerBlock().title, view(review).comments[0].index], ["Gamma text.", 3]);
});

test("an action on a block that is gone is refused", () => {
  const review = new Review("/doc.md", DOC);
  const delta = idAt(review, 3);
  review.sync(DOC.replace("\n\nDelta text.", ""), "user");
  assert.throws(() => review.act({ type: "goto", block: delta }), /no longer in the document/);
});

test("a question takes one answer, so a repeated submit does not queue it twice", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "questions", items: ["Why?"] });
  const answer = { type: "answer", block: idAt(review, 0), question: questionId(review, 0, 1), text: "Because." };
  review.act(answer);
  assert.throws(() => review.act(answer), /already answered/);
  assert.deepEqual(
    review.requests.waiting.map((request) => [request.type, request.question, request.text]),
    [["answer", "Why?", "Because."]],
  );
});

test("an answer goes to the question the user saw, and one Claude replaced meanwhile is refused", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "questions", items: ["Why?", "How?"] });
  const how = questionId(review, 0, 2);
  review.say({ kind: "questions", items: ["How?"] });
  assert.throws(() => review.act({ type: "answer", block: idAt(review, 0), question: how, text: "Like this." }), /replaced that question/);
  assert.deepEqual(review.requests.waiting, []);
});

test("a finished review takes no more actions", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "finish", summary: "Done." });
  assert.throws(() => onPointer(review, "approve"), /finished/);
  assert.throws(() => review.act({ type: "goto", block: idAt(review, 2) }), /finished/);
  assert.deepEqual(review.requests.waiting, []);
});

test("approving an approved block does nothing, so a stray key press neither logs nor moves on", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  review.act({ type: "goto", block: idAt(review, 0) });
  const logged = review.log.length;
  onPointer(review, "approve");
  assert.equal(review.log.length, logged);
  assert.equal(review.pointerBlock().title, "Doc");
});

test("the view says where the pointer block's request stands and how each answer is doing", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "skip");
  review.take();
  review.act({ type: "goto", block: idAt(review, 2) });
  assert.deepEqual(view(review).pending, { status: "queued", type: "pointer", ahead: 1 });

  review.requests.finish();
  review.take();
  review.say({ kind: "questions", items: ["Why?", "How?"] });
  review.requests.finish();
  review.act({ type: "answer", block: idAt(review, 2), question: questionId(review, 2, 2), text: "Like this." });
  assert.deepEqual([view(review).pending, shownQuestions(review)], [
    null,
    [
      { text: "Why?", answer: "", status: null },
      { text: "How?", answer: "Like this.", status: "queued" },
    ],
  ]);
});

test("comments on a block that is gone leave the view", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "comment", block: idAt(review, 3), quote: "Delta", text: "drop it" });
  review.sync(DOC.replace("\n\nDelta text.", ""), "claude");
  assert.deepEqual(view(review).comments, []);
});

test("a dropped change without a resolution comment asks nothing of Claude", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "drop", conflict: heldConflict(review) });
  assert.deepEqual(view(review).requests.map((request) => request.type), ["pointer"]);
  assert.deepEqual(view(review).comments, []);
});

test("a resolution comment reaches Claude with the decision, and only Update unlocks the approved block", () => {
  const edited = DOC.replace("Alpha", "Changed");
  for (const [decision, unlocked] of [["update", true], ["drop", false]]) {
    const review = new Review("/doc.md", DOC);
    review.act({ type: decision, conflict: heldConflict(review), text: " keep the old name as an alias " });
    const { type, text } = review.take();
    assert.deepEqual({ type, text }, { type: decision, text: "keep the old name as an alias" });
    assert.equal(view(review).comments[0].status, "working", "the comment stays on the page until Claude replies");
    assert.equal(review.sync(edited, "claude").ok, unlocked);
  }
});

test("a comment shows as queued until Claude takes it, including after an updated conflict", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  review.act({ type: "comment", block: idAt(review, 0), quote: "Alpha", text: "change it" });
  const status = () => view(review).comments[0].status;
  assert.equal(status(), "sent");
  review.take();
  review.take();
  assert.equal(status(), "working");
  const { id: conflict } = review.say({ kind: "conflict", lines: [1], message: "touches Doc" });
  assert.equal(status(), "held");
  review.requests.finish();
  review.act({ type: "goto", block: idAt(review, 2) });
  review.act({ type: "update", conflict });
  review.take();
  assert.equal(status(), "sent", "the update waits behind the pointer move");
  review.take();
  assert.equal(status(), "working");
  review.say({ kind: "reply", text: "Changed." });
  assert.deepEqual([status(), view(review).comments[0].reply], ["done", "Changed."]);
});

test("Claude cannot change an approved block until the user updates the conflict", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  const edited = DOC.replace("Alpha text.", "Alpha changed.");

  assert.deepEqual(syncForClaude(review.sync(edited, "claude")), {
    ok: false,
    violations: [{ index: 1, title: "Doc", startLine: 1, endLine: 3, text: "# Doc\n\nAlpha text." }],
  });
  assert.equal(review.document.text, DOC);

  const { id: comment } = review.act({ type: "comment", block: idAt(review, 0), quote: "Alpha", text: "change it" });
  const { id: conflict } = review.say({ kind: "conflict", comment, lines: [1], message: "touches Doc" });
  review.act({ type: "update", conflict });
  assert.deepEqual(review.sync(edited, "claude").ok, true);
  assert.ok(review.isApproved(review.blocks[0]), "the updated block stays approved with its new text");
  assert.deepEqual(review.sync(edited.replace("changed", "again"), "claude").ok, false, "an update covers one change");
});

test("a user's own edit keeps an approved block approved and asks Claude to check the open blocks", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  review.take();
  review.say({ kind: "questions", items: [] });
  review.requests.finish();
  assert.equal(review.sync(DOC.replace("Alpha text.", "Alpha by hand."), "user").ok, true);
  assert.ok(review.isApproved(review.blocks[0]));
  const { type, changed } = handOut(review);
  assert.deepEqual({ type, changed: changed.map((block) => block.title) }, { type: "outside-edit", changed: ["Doc"] });
});

test("the pointer follows its block when blocks above it change", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "goto", block: idAt(review, 2) });
  const { changed } = review.sync(DOC.replace("Alpha text.", "Alpha text.\n\nInserted text."), "claude");
  assert.equal(review.pointerBlock().title, "Gamma text.");
  assert.deepEqual(
    changed.map((block) => block.title),
    ["Inserted text."],
  );
});

test("the pointer follows its block when the block itself is edited", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "goto", block: idAt(review, 1) });
  review.sync(DOC.replace("Beta text.", "Beta rewritten."), "claude");
  assert.equal(review.pointerBlock().title, "Beta rewritten.");
});

test("dropping a conflict keeps the approved block locked", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  const { id: comment } = review.act({ type: "comment", block: idAt(review, 0), quote: "Alpha", text: "change it" });
  const { id: conflict } = review.say({ kind: "conflict", comment, lines: [1], message: "touches Doc" });
  review.act({ type: "drop", conflict });
  assert.equal(review.sync(DOC.replace("Alpha", "Changed"), "claude").ok, false);
});

test("questions come back with their block, without asking Claude again", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "questions", items: ["Why?"] });
  onPointer(review, "skip");
  assert.equal(view(review).questions, null);
  review.act({ type: "goto", block: idAt(review, 0) });
  assert.deepEqual(shownQuestions(review), [{ text: "Why?", answer: "", status: null }]);
  review.requests.waiting.splice(0, 1);
  assert.equal(review.take(), undefined);
});

test("questions go to the block Claude was handed, even after the user moved on", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "goto", block: idAt(review, 1) });
  review.take();
  review.act({ type: "goto", block: idAt(review, 2) });
  review.say({ kind: "questions", items: ["About Beta?"] });
  assert.deepEqual(view(review).questions, null);
  review.act({ type: "goto", block: idAt(review, 1) });
  assert.deepEqual(shownQuestions(review), [{ text: "About Beta?", answer: "", status: null }]);
});

test("questions follow the block Claude was handed when Claude edits it", () => {
  const review = new Review("/doc.md", DOC);
  review.act({ type: "goto", block: idAt(review, 1) });
  review.take();
  review.act({ type: "goto", block: idAt(review, 3) });
  review.sync(DOC.replace("Beta text.", "Beta rewritten."), "claude");
  review.say({ kind: "questions", items: ["Still?"] });
  review.act({ type: "goto", block: idAt(review, 1) });
  assert.equal(review.pointerBlock().title, "Beta rewritten.");
  assert.deepEqual(shownQuestions(review), [{ text: "Still?", answer: "", status: null }]);
});

test("editing a block drops its questions", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "questions", items: ["Why?"] });
  review.sync(DOC.replace("Alpha text.", "Alpha rewritten."), "claude");
  assert.equal(review.pointerBlock().title, "Doc");
  assert.equal(view(review).questions, null);
});

test("an edit that clears the pointer block's questions asks Claude for new ones", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "questions", items: ["Why?"] });
  review.sync(DOC.replace("Alpha text.", "Alpha rewritten."), "claude");
  assert.deepEqual(
    view(review).requests.map((request) => [request.status, request.label]),
    [["queued", "Questions for Doc"]],
  );
  review.say({ kind: "questions", items: [] });
  assert.deepEqual(view(review).requests, []);
});

test("moving the pointer to the block it is on does nothing", () => {
  const review = new Review("/doc.md", DOC);
  review.say({ kind: "questions", items: ["Why?"] });
  review.act({ type: "goto", block: idAt(review, 0) });
  assert.deepEqual(review.requests.waiting, []);
  assert.deepEqual(shownQuestions(review), [{ text: "Why?", answer: "", status: null }]);
});

test("the request Claude was handling when the review closed comes first on reopening, unless Claude already responded", () => {
  for (const replied of [false, true]) {
    const review = new Review("/doc.md", DOC);
    review.say({ kind: "questions", items: [] });
    review.act({ type: "comment", block: idAt(review, 1), quote: "Beta", text: "Say beta twice." });
    review.act({ type: "comment", block: idAt(review, 2), quote: "Gamma", text: "Why gamma?" });
    review.take();
    if (replied) review.say({ kind: "reply", text: "Done." });
    const reopened = reload(review);
    reopened.requests.requeue();
    const waiting = reopened.waiting().map((request) => request.text ?? request.type);
    assert.deepEqual(waiting, replied ? ["Why gamma?", "pointer"] : ["Say beta twice.", "Why gamma?"]);
  }
});

test("the review survives a round trip through its saved form", () => {
  const review = new Review("/doc.md", DOC);
  onPointer(review, "approve");
  review.say({ kind: "questions", items: ["Why?"] });
  assert.deepEqual(view(reload(review)), view(review));
});
