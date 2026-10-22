/**
 * The review page. Each module draws one part of it from the latest view the server sent (`store.js`), and every user
 * action goes to the server (`api.js`), which answers with a new view. The page keeps nothing of the review itself,
 * only what the user typed and has not sent (`drafts.js`).
 */
import { act, follow } from "./api.js";
import { initCommentForm, placeCommentButton, reopenComment } from "./comment-form.js";
import { initConflicts, renderConflicts } from "./conflicts.js";
import { flash, initDocument, renderDocument, renderFinished } from "./document.js";
import { restore, trackDrafts } from "./drafts.js";
import { initHeader, renderHeader, showClaude } from "./header.js";
import { icon } from "./icons.js";
import { initRail, renderRail } from "./rail.js";
import { pointerBlock, setState, state } from "./store.js";
import { toast } from "./toast.js";

const help = document.getElementById("help");

function render() {
  renderHeader();
  renderFinished();
  renderDocument();
  renderConflicts();
  renderRail();
  placeCommentButton();
}

/** Sends a button's or a key's action. Approve and skip name the block the user sees, so they never land on another. */
function actOnReview(type) {
  act(type === "approve" || type === "skip" ? { type, block: pointerBlock().id } : { type });
}

/** Closes the tab, or shows that the review closed when the browser keeps a tab it did not open by script. */
function closeReview() {
  window.close();
  document.querySelectorAll("body > :not(#closed)").forEach((element) => (element.hidden = true));
  document.getElementById("closed").hidden = false;
}

document.querySelectorAll("[data-icon]").forEach((element) => element.insertAdjacentHTML("afterbegin", icon(element.dataset.icon)));
trackDrafts();
initDocument();
initConflicts();
initRail();
initCommentForm();
initHeader();

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing || event.metaKey || event.ctrlKey || event.altKey || !state || state.finished || help.open) return;
  if (event.key === "a") actOnReview("approve");
  if (event.key === "j") actOnReview("skip");
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) actOnReview(button.dataset.action);
});

follow({
  view(next) {
    const first = !state;
    setState(next);
    const comment = first && restore();
    render();
    if (comment) reopenComment(comment);
  },
  changed: flash,
  toast,
  closed: closeReview,
  disconnected: () => showClaude("away", "Disconnected"),
});
