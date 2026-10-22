import { parseBlocks } from "./blocks.mjs";

/**
 * One version of the document: its text and its blocks.
 *
 * Every block has an id that carries over to the next version, so whatever the review keeps per block follows it
 * through edits: an unchanged block keeps its id, and an edited one takes the id of the block it replaced.
 */
export class Document {
  constructor(text, blocks) {
    this.text = text;
    this.blocks = blocks;
    this.byId = new Map(blocks.map((block) => [block.id, block]));
  }

  /** Parses `text`, giving its blocks `ids` in order, and ids from `newId` to blocks past their end. */
  static parse(text, ids, newId) {
    return new Document(text, parseBlocks(text).map((block, index) => ({ ...block, id: ids[index] ?? newId() })));
  }

  /** The next version of the document, each block keeping the id of the block it continues. */
  revise(text, newId) {
    const parsed = parseBlocks(text);
    const previous = pairBlocks(this.blocks, parsed);
    return new Document(text, parsed.map((block, index) => ({ ...block, id: previous[index]?.id ?? newId() })));
  }

  block(id) {
    return this.byId.get(id);
  }

  /** The block that starts on or contains the given 1-based line. */
  blockAtLine(line) {
    return this.blocks.find((block) => block.startLine <= line && line <= block.endLine);
  }

  /** The blocks of `next` whose text differs from their version here, new blocks included. */
  changedIn(next) {
    return next.blocks.filter((block) => this.block(block.id)?.text !== block.text);
  }
}

/**
 * Pairs each new block with the old block it continues, or `undefined` for a block that is new.
 *
 * Blocks with identical text are matched by their longest common subsequence. Between two matched blocks, the
 * unmatched old and new blocks are paired in order, so an edited block continues the block that it replaced.
 */
function pairBlocks(oldBlocks, newBlocks) {
  const rows = oldBlocks.length;
  const columns = newBlocks.length;
  const lengths = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      lengths[row][column] =
        oldBlocks[row].text === newBlocks[column].text
          ? lengths[row + 1][column + 1] + 1
          : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }

  const previous = new Array(columns).fill(undefined);
  let row = 0;
  let column = 0;
  let gapOld = [];
  let gapNew = [];
  const closeGap = () => {
    gapNew.forEach((block, offset) => (previous[block.index] = gapOld[offset]));
    gapOld = [];
    gapNew = [];
  };
  while (row < rows && column < columns) {
    if (oldBlocks[row].text === newBlocks[column].text) {
      closeGap();
      previous[column++] = oldBlocks[row++];
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      gapOld.push(oldBlocks[row++]);
    } else {
      gapNew.push(newBlocks[column++]);
    }
  }
  gapOld.push(...oldBlocks.slice(row));
  gapNew.push(...newBlocks.slice(column));
  closeGap();
  return previous;
}
