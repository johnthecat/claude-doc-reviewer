import { act } from "./api.js";
import { escapeHtml, renderCache } from "./dom.js";
import { icon } from "./icons.js";
import { state } from "./store.js";

const doc = document.getElementById("doc");
const finished = document.getElementById("finished");
const changed = renderCache();
/** The rendered blocks, by index. */
let sections = [];
/** The block the user clicked to move the pointer to, kept in place on screen while the pointer moves there. */
let clickedBlock = null;

export function sectionAt(index) {
  return sections[index];
}

export function sectionOf(blockId) {
  return sections.find((section) => section.dataset.block === blockId);
}

/** The block element a node sits in, if any. */
export function blockOf(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest(".blk");
}

function renderMarkdown(block) {
  if (block.kind === "frontmatter" || !window.marked) return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  return window.marked.parse(block.text, { gfm: true });
}

function blockSection(block) {
  const section = document.createElement("section");
  section.className = "blk";
  section.dataset.index = block.index;
  section.dataset.block = block.id;
  section.innerHTML = `<div class="blk-body markdown-body">${renderMarkdown(block)}</div>`;
  return section;
}

/**
 * Draws the blocks, marking the approved ones and the pointer, and brings the pointer block into view when the pointer
 * moves. Blocks are rebuilt only when their text changes, so the word a click selected survives the pointer move.
 */
export function renderDocument() {
  const anchorTop = clickedBlock === state.pointer ? sections[clickedBlock]?.getBoundingClientRect().top : undefined;
  if (changed("texts", state.blocks.map((block) => block.text))) {
    sections = state.blocks.map(blockSection);
    doc.replaceChildren(...sections);
  }
  for (const block of state.blocks) {
    sections[block.index].classList.toggle("approved", block.approved);
    sections[block.index].classList.toggle("pointer", block.index === state.pointer);
  }
  if (changed("pointer", state.pointer)) {
    clickedBlock = null;
    const section = sections[state.pointer];
    if (anchorTop === undefined) section?.scrollIntoView({ behavior: "smooth", block: "center" });
    else scrollBy(0, section.getBoundingClientRect().top - anchorTop);
  }
}

/** The banner that closes a finished review with Claude's summary. */
export function renderFinished() {
  if (!changed("finished", state.finished)) return;
  finished.innerHTML = state.finished
    ? `<div class="Banner" data-variant="success">
        <div class="BannerIcon">${icon("check-circle-fill")}</div>
        <div class="BannerContent">
          <h2 class="BannerTitle">Review complete · approved ${state.finished.counts.approved}/${state.finished.counts.total}</h2>
          <div class="BannerDescription">${escapeHtml(state.finished.summary)}</div>
        </div>
      </div>`
    : "";
}

/** Flashes the blocks an edit changed. */
export function flash(indexes) {
  for (const index of indexes) {
    sections[index]?.animate([{ background: "var(--bgColor-accent-muted)" }, { background: "transparent" }], { duration: 2400, easing: "ease-out" });
  }
}

/** Moves the pointer to a block when the user clicks it. */
export function initDocument() {
  doc.addEventListener("click", async (event) => {
    const section = blockOf(event.target);
    if (!section || !state || state.finished) return;
    const index = Number(section.dataset.index);
    if (index === state.pointer) return;
    clickedBlock = index;
    if (!(await act({ type: "goto", block: section.dataset.block }))) clickedBlock = null;
  });
}
