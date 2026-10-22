import { escapeHtml, renderCache, setText } from "./dom.js";
import { sectionAt } from "./document.js";
import { icon } from "./icons.js";
import { statusIcon } from "./status.js";
import { state } from "./store.js";

const crumb = document.getElementById("crumb");
const approvedCount = document.getElementById("approved-count");
const openCount = document.getElementById("open-count");
const claudeVisual = document.getElementById("claude-visual");
const claudeLabel = document.getElementById("claude-label");
const claudeQueued = document.getElementById("claude-queued");
const queue = document.getElementById("queue");
const queueList = document.getElementById("queue-list");
const activity = document.getElementById("activity");
const activityList = document.getElementById("activity-list");

const CLAUDE_STATUS = { listening: "Claude listening", working: "Claude working", away: "Claude away" };
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });
const LOG_ICONS = {
  approve: ["check", "success"],
  comment: ["comment"],
  answer: ["comment"],
  reply: ["comment"],
  edit: ["file"],
  outside: ["file"],
  conflict: ["alert", "attention"],
  update: ["check"],
  drop: ["x"],
  notice: ["info"],
  finish: ["check-circle-fill", "success"],
  exit: ["sign-out"],
};
const changed = renderCache();

export function showClaude(status, label = CLAUDE_STATUS[status]) {
  if (!changed("claude", [status, label])) return;
  claudeVisual.innerHTML = statusIcon(status);
  claudeVisual.dataset.status = status;
  claudeLabel.textContent = label;
}

/** The top bar: the path, the counts, Claude's status and the requests waiting, and the request list and log when open. */
export function renderHeader() {
  if (changed("path", state.path)) {
    const parts = state.path.split("/");
    crumb.innerHTML = `${escapeHtml(parts.slice(-3, -1).join(" / "))} / <b>${escapeHtml(parts.at(-1))}</b>`;
    document.title = `Review · ${parts.at(-1)}`;
  }
  setText(approvedCount, `${state.counts.approved} approved`);
  setText(openCount, `${state.counts.open} open`);
  showClaude(state.claude);
  setText(claudeQueued, String(state.requests.filter((request) => request.status === "queued").length || ""));
  for (const [popover, renderList] of POPOVER_LISTS) if (popover.matches(":popover-open")) renderList();
}

function renderLog() {
  if (!changed("log", [state.log.length, state.log.at(-1)?.at])) return;
  activityList.innerHTML = state.log
    .toReversed()
    .map((entry) => {
      const [name, variant] = LOG_ICONS[entry.kind] ?? ["dot-fill"];
      return `<li class="TimelineItem">
        <span class="TimelineBadge"${variant ? ` data-variant="${variant}"` : ""}>${icon(name)}</span>
        <div class="TimelineBody">${escapeHtml(entry.text)}<time>${TIME.format(new Date(entry.at))}</time></div>
      </li>`;
    })
    .join("");
}

function renderQueue() {
  const items = state.requests.map(
    (request) =>
      `<li class="ActionListItem" data-index="${request.index}"><span class="LeadingVisual">${statusIcon(request.status)}</span><span>${escapeHtml(request.label)}</span></li>`,
  );
  queueList.innerHTML = `<li class="GroupHeading">Requests for Claude</li>${items.join("") || `<li class="ActionListItem" data-inactive>Nothing waiting</li>`}`;
}

/** The request list and the activity log are drawn only while open, and when they open. */
const POPOVER_LISTS = new Map([
  [queue, renderQueue],
  [activity, renderLog],
]);

export function initHeader() {
  queueList.addEventListener("click", (event) => {
    sectionAt(event.target.closest("[data-index]")?.dataset.index)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  for (const [popover, renderList] of POPOVER_LISTS) {
    popover.addEventListener("beforetoggle", (event) => state && event.newState === "open" && renderList());
  }
  for (const popover of document.querySelectorAll("[popover]")) {
    popover.addEventListener("toggle", (event) => {
      for (const opener of document.querySelectorAll(`[popovertarget="${popover.id}"]:not([popovertargetaction="hide"])`)) {
        opener.setAttribute("aria-expanded", event.newState === "open");
      }
    });
  }
}
