import { icon } from "./icons.js";

const toasts = document.getElementById("toasts");

/** Shows `text` in a floating overlay for a few seconds. */
export function toast(text) {
  const element = document.createElement("div");
  element.className = "Overlay toast";
  element.innerHTML = `${icon("info")}<span></span>`;
  element.lastChild.textContent = text;
  toasts.append(element);
  setTimeout(() => element.remove(), 4000);
}
