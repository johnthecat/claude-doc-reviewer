import { blockOf, sectionOf } from "./document.js";
import { draft, forget, openCommentTarget, sendField, setCommentTarget } from "./drafts.js";
import { state } from "./store.js";

const button = document.getElementById("comment-button");
const anchor = document.getElementById("selection-anchor");
const form = document.getElementById("comment-popover");
const quoteElement = document.getElementById("comment-quote");
const field = document.getElementById("comment-text");

/** The text selected within one block, if any. */
function selectedText() {
  const current = getSelection();
  if (current.isCollapsed) return null;
  const range = current.getRangeAt(0);
  const block = blockOf(range.commonAncestorContainer);
  return block && { block: block.dataset.block, quote: current.toString().trim().slice(0, 500), range };
}

/** Shows the Comment button over the selected text, unless a comment is already being written. */
export function placeCommentButton() {
  const selected = !openCommentTarget() && selectedText();
  button.hidden = !selected;
  if (selected) placeAnchor(selected.range);
}

/** Moves the anchor the comment button and form sit on over `range`. */
function placeAnchor(range) {
  const rect = range.getBoundingClientRect();
  Object.assign(anchor.style, {
    left: `${rect.left + scrollX}px`,
    top: `${rect.top + scrollY}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

/** Opens the comment form, a popover anchored to the quoted text, which stays highlighted while the form is open. */
function openComment({ block, quote, range }) {
  setCommentTarget({ block, quote });
  placeAnchor(range);
  CSS.highlights.set("comment-quote", new Highlight(new StaticRange(range)));
  quoteElement.textContent = quote;
  field.value = draft("comment");
  field.readOnly = false;
  button.hidden = true;
  getSelection().removeAllRanges();
  form.showPopover();
}

/** Reopens the comment form left open when the page last closed, on its quote while the block still has it. */
export function reopenComment({ block, quote }) {
  const section = sectionOf(block);
  if (section && !state.finished) openComment({ block, quote, range: quoteRange(section.querySelector(".blk-body"), quote) });
}

/** The range of `quote` in a block's rendered text, or the whole block when its text no longer has the quote. */
function quoteRange(body, quote) {
  const range = document.createRange();
  range.selectNodeContents(body);
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = "";
  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, start: text.length });
    text += walker.currentNode.data;
  }
  const start = text.indexOf(quote);
  if (!quote || start < 0) return range;
  const position = (offset) => {
    const { node, start: nodeStart } = nodes.findLast((candidate) => candidate.start <= offset);
    return [node, offset - nodeStart];
  };
  range.setStart(...position(start));
  range.setEnd(...position(start + quote.length));
  return range;
}

function closeComment() {
  forget("comment");
  setCommentTarget(null);
  CSS.highlights.delete("comment-quote");
  form.togglePopover(false);
}

async function sendComment() {
  const target = openCommentTarget();
  const text = field.value.trim();
  if (target && text && (await sendField(field, [], { type: "comment", block: target.block, quote: target.quote, text }))) closeComment();
}

/** Selects the word under a single click, so a click is enough to comment on a word. */
function selectWordAt(current) {
  const node = current.anchorNode;
  if (node?.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent;
  const isWordCharacter = (character) => /[\p{L}\p{N}_'-]/u.test(character ?? "");
  let start = current.anchorOffset;
  let end = start;
  while (start > 0 && isWordCharacter(text[start - 1])) start--;
  while (end < text.length && isWordCharacter(text[end])) end++;
  if (start < end) current.setBaseAndExtent(node, start, node, end);
}

export function initCommentForm() {
  document.addEventListener("mouseup", (event) => {
    const clickedText = event.detail === 1 && event.target.closest?.(".blk-body");
    setTimeout(() => {
      const current = getSelection();
      if (clickedText && current.isCollapsed) selectWordAt(current);
      placeCommentButton();
    });
  });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    const selected = selectedText();
    if (selected) openComment(selected);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendComment();
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
    if (event.key === "Escape") closeComment();
  });
  document.getElementById("comment-cancel").addEventListener("click", closeComment);
}
