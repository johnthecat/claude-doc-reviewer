import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBlocks } from "../lib/blocks.mjs";

const outline = (markdown) => parseBlocks(markdown).map((block) => [block.startLine, block.endLine, block.title]);

test("a paragraph carries the lists, tables and code blocks that follow it", () => {
  const markdown = [
    "Intro paragraph.",
    "",
    "- one",
    "- two",
    "",
    "| a | b |",
    "| - | - |",
    "",
    "```js",
    "code();",
    "",
    "more();",
    "```",
    "",
    "Next paragraph.",
  ].join("\n");
  assert.deepEqual(outline(markdown), [
    [1, 13, "Intro paragraph.…"],
    [15, 15, "Next paragraph."],
  ]);
});

test("a heading belongs to the block that follows it, and a list under a heading is its own block", () => {
  const markdown = ["# Title", "", "First.", "", "## Terms", "", "- a", "- b", "", "Then text."].join("\n");
  assert.deepEqual(outline(markdown), [
    [1, 3, "Title"],
    [5, 8, "Terms"],
    [10, 10, "Then text."],
  ]);
});

test("the frontmatter is a block of its own", () => {
  const markdown = ["---", "name: x", "---", "", "# Doc", "", "Body."].join("\n");
  assert.deepEqual(outline(markdown), [
    [1, 3, "frontmatter"],
    [5, 7, "Doc"],
  ]);
});

test("a fence inside a list item stays inside the list", () => {
  const markdown = ["Steps:", "", "1. Run:", "", "   ```bash", "   make", "   ```", "", "2. Done.", "", "After."].join("\n");
  assert.deepEqual(outline(markdown), [
    [1, 9, "Steps:…"],
    [11, 11, "After."],
  ]);
});

test("a title drops emphasis but keeps identifiers as written, so the user can find the block", () => {
  const markdown = ["Run `${CLAUDE_SKILL_DIR}` now.", "", "Set **max_size** _here_."].join("\n");
  assert.deepEqual(outline(markdown), [
    [1, 1, "Run ${CLAUDE_SKILL_DIR} now."],
    [3, 3, "Set max_size here."],
  ]);
});

test("an unclosed fence in a list ends with the document", () => {
  assert.deepEqual(outline("Steps:\n\n1. Run:\n   ```bash\n   make"), [[1, 5, "Steps:…"]]);
});

test("the skill splits into blocks by section and paragraph", () => {
  const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
  assert.deepEqual(
    parseBlocks(skill).map((block) => block.title),
    [
      "frontmatter",
      "Doc reviewer",
      "Terms",
      "Start",
      "In the browser",
      "node ${CLAUDE_SKILL_DIR}/scripts/review.…",
      "Each open starts…",
      "The loop: wait,…",
      "The server hands…",
      "Run the loop…",
      "Each turn",
      "Then act on…",
      "Report what you…",
      "Stop after a…",
      "Approved text",
      "Keep the exact…",
      "Fix the open blocks",
      "Change only what…",
      "Review targets",
      "Finish",
      "Red flags",
    ],
  );
});
