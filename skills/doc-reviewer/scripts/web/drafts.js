import { act } from "./api.js";
import { reviewId, state } from "./store.js";

/**
 * What the user typed and has not sent, by the `data-draft` key of its field: answers, resolution comments and the
 * comment form. The browser keeps them for the review they belong to, so they come back after a reload or when the
 * review opens again, and a review started over never picks up an older one's.
 */
const fields = new Map();
/** The block and quote the comment form is open on, or `null` while it is closed. */
let commentTarget = null;
const STORAGE_KEY = `doc-reviewer:${reviewId}`;

export function draft(key) {
  return fields.get(key) ?? "";
}

export function forget(key) {
  fields.delete(key);
  save();
}

export function openCommentTarget() {
  return commentTarget;
}

export function setCommentTarget(target) {
  commentTarget = target;
  save();
}

/** Takes back the drafts saved for this review. Returns the comment form's target when it was open. */
export function restore() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
  if (saved?.review !== state.started) return null;
  for (const [key, text] of saved.fields) fields.set(key, text);
  return saved.comment;
}

function save() {
  const typed = [...fields].filter(([, text]) => text.trim());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ review: state.started, fields: typed, comment: commentTarget }));
  } catch {
    // Without storage the drafts last as long as the page.
  }
}

/** Keeps the text of every field marked `data-draft` as it is typed. */
export function trackDrafts() {
  document.addEventListener("input", (event) => {
    const key = event.target.dataset?.draft;
    if (!key) return;
    fields.set(key, event.target.value);
    save();
  });
}

/**
 * Sends what a field holds with `action`, locking the field and `buttons` meanwhile so a second submit sends nothing.
 * Once sent, the field's draft is gone and the field stays locked until the page redraws it. Returns whether it was sent.
 */
export async function sendField(field, buttons, action) {
  if (field.readOnly) return false;
  const lock = (locked) => {
    field.readOnly = locked;
    for (const button of buttons) button.disabled = locked;
  };
  lock(true);
  if (!(await act(action))) {
    lock(false);
    return false;
  }
  forget(field.dataset.draft);
  return true;
}
