import { escapeHtml } from "./dom.js";
import { sectionAt } from "./document.js";
import { draft, sendField } from "./drafts.js";
import { icon } from "./icons.js";
import { state } from "./store.js";

/** The alerts on the page, by conflict, kept while the conflict is pending so a resolution being typed stays put. */
const alerts = new Map();

/**
 * Holds a change back under the approved block it touches, with a field for how to resolve it, Update, which lets
 * Claude change the approved block, and Drop.
 */
function conflictAlert(conflict) {
  const alert = document.createElement("div");
  alert.className = "Banner conflict";
  alert.dataset.variant = "warning";
  alert.dataset.comment = conflict.comment;
  const key = `resolution:${conflict.id}`;
  alert.innerHTML = `
    <div class="BannerIcon">${icon("alert")}</div>
    <div class="BannerContent">
      <h2 class="BannerTitle">This change touches an approved block</h2>
      <div class="BannerDescription">${escapeHtml(conflict.message)}</div>
      <div class="resolution" data-conflict="${conflict.id}">
        <textarea class="TextInput" rows="1" placeholder="How to resolve it (optional)" data-draft="${key}">${escapeHtml(draft(key))}</textarea>
        <div class="resolution-actions">
          <button class="Button" data-variant="primary" data-size="small" data-resolve="update">Update</button>
          <button class="Button" data-variant="default" data-size="small" data-resolve="drop">Drop</button>
        </div>
      </div>
    </div>`;
  return alert;
}

/** Puts each pending conflict's alert under its block, reusing the alert already on the page. */
export function renderConflicts() {
  const pending = new Set(state.conflicts.map((conflict) => conflict.id));
  for (const [id, alert] of alerts) {
    if (pending.has(id)) continue;
    alert.remove();
    alerts.delete(id);
  }
  let previous = null;
  for (const conflict of state.conflicts.toSorted((first, second) => first.index - second.index)) {
    if (!alerts.has(conflict.id)) alerts.set(conflict.id, conflictAlert(conflict));
    const alert = alerts.get(conflict.id);
    const anchor = previous?.index === conflict.index ? previous.alert : sectionAt(conflict.index);
    if (anchor && anchor.nextElementSibling !== alert) anchor.after(alert);
    previous = { index: conflict.index, alert };
  }
}

/** Scrolls to the alert holding back a comment's change and puts the caret in its field. */
export function showConflictOf(commentId) {
  const alert = [...alerts.values()].find((candidate) => candidate.dataset.comment === commentId);
  alert?.scrollIntoView({ behavior: "smooth", block: "center" });
  alert?.querySelector("textarea").focus({ preventScroll: true });
}

/** Sends Update or Drop with the resolution typed under the alert. */
export function initConflicts() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resolve]");
    if (!button) return;
    const resolution = button.closest(".resolution");
    const field = resolution.querySelector("textarea");
    sendField(field, resolution.querySelectorAll("button"), { type: button.dataset.resolve, conflict: resolution.dataset.conflict, text: field.value });
  });
}
