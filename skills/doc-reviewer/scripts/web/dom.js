export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** Sets a node's text only when it differs, so an unchanged label is not laid out again. */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * A record of what each part of the page last drew from. The function it returns says whether `value` changed for
 * `part` since the last call, so a part whose input is unchanged is left alone.
 */
export function renderCache() {
  const drawn = new Map();
  return (part, value) => {
    const signature = JSON.stringify(value);
    if (drawn.get(part) === signature) return false;
    drawn.set(part, signature);
    return true;
  };
}
