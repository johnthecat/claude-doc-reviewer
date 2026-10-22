import { showConflictOf } from "./conflicts.js";
import { escapeHtml, setText } from "./dom.js";
import { sectionAt } from "./document.js";
import { draft, sendField } from "./drafts.js";
import { statusIcon, statusLine } from "./status.js";
import { pointerBlock, state } from "./store.js";

const doc = document.getElementById("doc");
const rail = document.getElementById("rail");
const NARROW = matchMedia("(max-width: 1100px)");
const RAIL_GAP = 8;

/** The rail's cards in order, kept between renders so a card that moves slides to its new place. */
let railCards = [];
const resizes = new ResizeObserver(() => layoutRail());

/** What the pointer card says while its questions are not in yet, from where the server says the request stands. */
function pendingText(pending) {
  if (pending?.status === "working") return pending.type === "pointer" ? "Claude is writing questions…" : "Claude is working on this block…";
  if (pending?.status === "queued") return `Queued for Claude · ${pending.ahead} ahead`;
  return state.claude === "away" ? "Waiting for Claude" : "Loading questions…";
}

function pointerContent(block) {
  return {
    block,
    total: state.counts.total,
    questions: state.questions,
    pending: state.questions === null ? { text: pendingText(state.pending), away: state.claude === "away" } : null,
  };
}

/** A draft answer is kept per block and question text, so it survives Claude posting the same question again. */
function answerDraftKey(block, question) {
  return `answer:${block.id}\n${question.text}`;
}

const ANSWER_STATUS = { working: "Claude is applying it", queued: "Queued for Claude", done: "Applied" };

function answeredHtml(question) {
  return `<div class="answered" data-status="${question.status}">
    <div class="answer-text">${escapeHtml(question.answer)}</div>
    ${statusLine(question.status, ANSWER_STATUS)}
  </div>`;
}

/** A question with a field for its answer; `updatePointerCard` draws an answered one. */
function questionHtml(question, offset) {
  const field = `<div class="answer-row">
      <textarea class="TextInput" rows="1" placeholder="Answer…"></textarea>
      <button class="Button IconButton" data-variant="primary" aria-label="Send answer" title="Send · Shift+Enter for a new line">↵</button>
    </div>`;
  return `<div class="question"><span class="number">${offset + 1}</span><div>
      <div class="question-text">${escapeHtml(question.text)}</div>
      <div class="answer" data-question="${question.id}">${question.answer ? "" : field}</div>
    </div></div>`;
}

/** Builds the pointer card for a block and its questions. `updatePointerCard` fills in everything that changes later. */
function pointerCard({ block, questions }) {
  const card = document.createElement("div");
  card.className = "Box pointer-card";
  card.toggleAttribute("data-approved", block.approved);
  const body = questions ? questions.map(questionHtml).join("") || `<div class="pending">No questions</div>` : `<div class="pending" data-waiting></div>`;
  card.innerHTML = `
    <div class="Box-header">
      <span class="index"></span>
      <span class="title truncate"></span>
      <span class="lines"></span>
    </div>
    <div class="Box-body">${body}</div>
    ${
      block.approved
        ? ""
        : `<div class="Box-footer">
            <button class="Button" data-variant="primary" data-size="small" data-action="approve">Approve<kbd class="Chord">A</kbd></button>
            <button class="Button" data-variant="default" data-size="small" data-action="skip">Skip<kbd class="Chord">J</kbd></button>
          </div>`
    }`;
  card.querySelectorAll(".answer textarea").forEach((textarea) => {
    const questionId = textarea.closest(".answer").dataset.question;
    const send = textarea.nextElementSibling;
    const submit = () => {
      const text = textarea.value.trim();
      if (text) sendField(textarea, [send], { type: "answer", block: block.id, question: questionId, text });
    };
    textarea.dataset.draft = answerDraftKey(block, questions.find((question) => question.id === questionId));
    textarea.value = draft(textarea.dataset.draft);
    send.disabled = !textarea.value.trim();
    textarea.addEventListener("input", () => (send.disabled = !textarea.value.trim()));
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      submit();
    });
    send.addEventListener("click", submit);
  });
  return card;
}

/** Brings the pointer card up to date in place, so an answer being typed keeps its field, caret and undo history. */
function updatePointerCard(card, { block, total, questions, pending }) {
  setText(card.querySelector(".index"), `${block.index + 1} / ${total}`);
  setText(card.querySelector(".title"), block.title);
  setText(card.querySelector(".lines"), `${block.startLine} – ${block.endLine}`);
  const waiting = card.querySelector("[data-waiting]");
  const shown = pending && `${pending.away}:${pending.text}`;
  if (pending && waiting.dataset.waiting !== shown) {
    waiting.dataset.waiting = shown;
    waiting.innerHTML = `${statusIcon(pending.away ? "away" : "working")}<span>${escapeHtml(pending.text)}</span>`;
  }
  for (const question of questions ?? []) {
    const slot = card.querySelector(`.answer[data-question="${question.id}"]`);
    if (question.answer && slot.firstElementChild?.dataset.status !== question.status) slot.innerHTML = answeredHtml(question);
  }
}

const COMMENT_STATUS = { sent: "Queued for Claude", working: "Claude is working…", held: "Resolve it under the approved block", done: "Done", answered: "Answered" };

/**
 * A comment card. A handled comment folds to one line, except an answer, which starts open so it can be read. A held
 * comment leads to the alert under the approved block, where the user resolves it.
 */
function commentCard(comment) {
  const card = document.createElement("div");
  card.className = "Box note";
  card.dataset.status = comment.status;
  const body = `
    <div class="Box-body">
      ${comment.quote ? `<div class="quote truncate">${escapeHtml(comment.quote)}</div>` : ""}
      <div>${escapeHtml(comment.text)}</div>
      ${comment.reply ? `<div class="reply">${escapeHtml(comment.reply)}</div>` : ""}
      ${statusLine(comment.status, COMMENT_STATUS)}
    </div>`;
  if (comment.status === "held") card.addEventListener("click", () => showConflictOf(comment.id));
  if (comment.status !== "done" && comment.status !== "answered") {
    card.innerHTML = body;
    return card;
  }
  card.innerHTML = `<details ${comment.status === "answered" ? "open" : ""}><summary class="Box-body">${statusIcon(comment.status)}<span class="truncate">${escapeHtml(comment.reply || comment.text)}</span></summary>${body}</details>`;
  const details = card.firstElementChild;
  card.addEventListener("click", (event) => {
    if (details.open && !event.target.closest("summary")) details.open = false;
  });
  return card;
}

/**
 * The rail's cards in order: by block, then the comments, then the pointer card, as the sort keeps that order. A card is
 * rebuilt only when its signature changes; `update` patches the rest in place.
 */
function railEntries() {
  const entries = [];
  for (const comment of state.comments) {
    const { index, ...content } = comment;
    entries.push({ key: comment.id, index, signature: JSON.stringify(content), build: () => commentCard(comment) });
  }
  const pointer = pointerBlock();
  if (pointer && !state.finished) {
    const content = pointerContent(pointer);
    const { block, questions } = content;
    const signature = JSON.stringify([block.id, block.approved, questions?.map((question) => question.id)]);
    entries.push({ key: "pointer", index: pointer.index, signature, build: () => pointerCard(content), update: (card) => updatePointerCard(card, content) });
  }
  return entries.sort((first, second) => first.index - second.index);
}

/** Replaces a card, keeping its place for the slide and the cursor in the answer field being typed in. */
function replaceCard(previous, card) {
  const typing = previous.contains(document.activeElement) && document.activeElement.matches(".answer textarea") ? document.activeElement : null;
  card.style.top = previous.style.top;
  previous.replaceWith(card);
  const field = typing && [...card.querySelectorAll(".answer textarea")].find((candidate) => candidate.dataset.draft === typing.dataset.draft);
  field?.focus();
  field?.setSelectionRange(typing.selectionStart, typing.selectionEnd);
}

/** Rebuilds only the cards whose content changed, then lays them out. */
export function renderRail() {
  const previous = new Map(railCards.map((entry) => [entry.key, entry]));
  railCards = railEntries();
  for (const entry of railCards) {
    const current = previous.get(entry.key);
    previous.delete(entry.key);
    if (current?.signature === entry.signature) {
      entry.element = current.element;
    } else {
      entry.element = entry.build();
      if (current) {
        resizes.unobserve(current.element);
        replaceCard(current.element, entry.element);
      }
      resizes.observe(entry.element);
    }
    entry.update?.(entry.element);
  }
  for (const removed of previous.values()) {
    resizes.unobserve(removed.element);
    removed.element.remove();
  }
  layoutRail();
}

/**
 * Places each card beside its block, below the card above it. Cards keep their elements, so a change of `top` slides
 * them, and a card that grows pushes the ones below it down. On a narrow page each card sits under its block and its
 * alerts instead. All positions are read before any is written, so laying out the rail costs one layout pass.
 */
function layoutRail() {
  if (NARROW.matches) {
    let anchor = null;
    railCards.forEach((entry, offset) => {
      if (railCards[offset - 1]?.index !== entry.index) {
        anchor = sectionAt(entry.index);
        while (anchor?.nextElementSibling?.matches(".conflict")) anchor = anchor.nextElementSibling;
      }
      if (anchor && anchor.nextElementSibling !== entry.element) anchor.after(entry.element);
      anchor = entry.element;
    });
    rail.style.minHeight = "";
    return;
  }
  for (const entry of railCards) if (entry.element.parentElement !== rail) rail.append(entry.element);
  const railTop = rail.getBoundingClientRect().top;
  const measured = railCards.map((entry) => ({
    blockTop: sectionAt(entry.index) ? sectionAt(entry.index).getBoundingClientRect().top - railTop : 0,
    height: entry.element.offsetHeight,
  }));
  let floor = 0;
  railCards.forEach((entry, offset) => {
    const top = Math.max(measured[offset].blockTop, floor);
    entry.element.style.top = `${top}px`;
    floor = top + measured[offset].height + RAIL_GAP;
  });
  rail.style.minHeight = `${floor}px`;
}

/** Lays the rail out again when the document resizes or the page crosses the narrow breakpoint. */
export function initRail() {
  NARROW.addEventListener("change", layoutRail);
  resizes.observe(doc);
}
