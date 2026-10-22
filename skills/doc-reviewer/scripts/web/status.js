import { icon } from "./icons.js";

/** Primer's Spinner, small: a faint ring with a turning arc. */
const SPINNER = `<svg class="Spinner" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-opacity="0.25" vector-effect="non-scaling-stroke"/><path d="M15 8a7.002 7.002 0 00-7-7" stroke="currentColor" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;

const STATUS_ICONS = { queued: "dot-fill", sent: "dot-fill", listening: "dot-fill", away: "dot-fill", held: "alert", done: "check", answered: "comment" };

/** The icon for a request, answer, comment or Claude status: a spinner while Claude works on it. */
export function statusIcon(status) {
  return status === "working" ? SPINNER : icon(STATUS_ICONS[status]);
}

/** A status icon and its label, under an answer or a comment. */
export function statusLine(status, labels) {
  return `<div class="meta">${statusIcon(status)}<span>${labels[status]}</span></div>`;
}
