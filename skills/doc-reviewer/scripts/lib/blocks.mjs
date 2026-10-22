/**
 * Splits a Markdown document into review blocks.
 *
 * A block is a paragraph together with the lists, tables and code blocks that follow it, up to the next paragraph or
 * heading. Content with no paragraph before it is a block of its own. A heading belongs to the block that follows it.
 * The frontmatter is a block.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_FENCE = /^\s+(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
const TABLE_ROW = /^ {0,3}\|/;
const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;
const HTML = /^ {0,3}<[A-Za-z!/]/;

/** Splits the text into units: frontmatter, heading, paragraph, list, table, code, quote, rule or html. */
function units(lines) {
  const found = [];
  let index = 0;

  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      found.push({ kind: "frontmatter", start: 0, end });
      index = end + 1;
    }
  }

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index++;
      continue;
    }
    const start = index;
    const fence = line.match(FENCE);
    if (fence) {
      index = fenceEnd(lines, index, fence[1]);
      found.push({ kind: "code", start, end: index - 1 });
      continue;
    }
    if (HEADING.test(line)) {
      found.push({ kind: "heading", start, end: start });
      index++;
      continue;
    }
    if (RULE.test(line)) {
      found.push({ kind: "rule", start, end: start });
      index++;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      index = listEnd(lines, index);
      found.push({ kind: "list", start, end: index - 1 });
      continue;
    }
    const kind = TABLE_ROW.test(line) ? "table" : QUOTE.test(line) ? "quote" : HTML.test(line) ? "html" : "paragraph";
    index++;
    while (index < lines.length && continues(lines[index], kind)) index++;
    found.push({ kind, start, end: index - 1 });
  }
  return found;
}

/** Whether a line carries on a paragraph-like unit of the given kind. */
function continues(line, kind) {
  if (line.trim() === "") return false;
  if (kind === "table") return TABLE_ROW.test(line);
  if (kind === "quote") return QUOTE.test(line) || !startsUnit(line);
  return !startsUnit(line);
}

/** Whether a line opens a new unit rather than continuing the current paragraph. */
function startsUnit(line) {
  return FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || RULE.test(line) || QUOTE.test(line);
}

/** Returns the index just past the closing fence of a code block that opens at `index`, or the end of an unclosed one. */
function fenceEnd(lines, index, marker) {
  index++;
  while (index < lines.length && !lines[index].trimStart().startsWith(marker)) index++;
  return Math.min(index + 1, lines.length);
}

/** Returns the index just past a list that starts at `index`, including its nested and indented content. */
function listEnd(lines, index) {
  index++;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      let next = index + 1;
      while (next < lines.length && lines[next].trim() === "") next++;
      if (next === lines.length || !(LIST_ITEM.test(lines[next]) || /^\s{2,}\S/.test(lines[next]))) break;
      index++;
      continue;
    }
    const fence = line.match(INDENTED_FENCE);
    if (fence) {
      index = fenceEnd(lines, index, fence[1]);
      continue;
    }
    if (LIST_ITEM.test(line) || /^\s+\S/.test(line) || !startsUnit(line)) {
      index++;
      continue;
    }
    break;
  }
  return index;
}

/**
 * Parses Markdown into blocks.
 *
 * Each block carries its 1-based `startLine` and `endLine`, its exact `text`, the `kind` of the unit that opens it, and a
 * `title`: the heading that opens it, "frontmatter", or its first words.
 */
export function parseBlocks(markdown) {
  const lines = markdown.split("\n");
  const groups = [];
  let current = null;
  let openHeading = false;

  for (const unit of units(lines)) {
    const startsBlock =
      current === null ||
      unit.kind === "frontmatter" ||
      unit.kind === "heading" ||
      (unit.kind === "paragraph" && !openHeading) ||
      current.kind === "frontmatter";
    if (startsBlock) {
      current = { kind: unit.kind, start: unit.start, end: unit.end };
      groups.push(current);
    } else {
      current.end = unit.end;
    }
    openHeading = unit.kind === "heading";
  }

  return groups.map((group, index) => {
    const text = lines.slice(group.start, group.end + 1).join("\n");
    return { index, startLine: group.start + 1, endLine: group.end + 1, text, kind: group.kind, title: titleOf(group.kind, text) };
  });
}

function titleOf(kind, text) {
  if (kind === "frontmatter") return "frontmatter";
  const firstLine = text.split("\n")[0];
  if (kind === "heading") return firstLine.replace(/^\s*#+\s*/, "").trim();
  // Code spans keep their text as written; elsewhere an underscore inside a word, as in snake_case, is not emphasis.
  const plain = firstLine
    .replace(/^\s*([-*+>]|\d+[.)])\s+/, "")
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 ? part.replace(/`/g, "") : part.replace(/[*#|[\]]|\b_+|_+\b/g, "")))
    .join("");
  const all = plain.trim().split(/\s+/);
  const words = all.slice(0, 3).join(" ");
  if (words.length > 40) return `${words.slice(0, 40)}…`;
  return all.length > 3 || text.includes("\n") ? `${words}…` : words;
}
