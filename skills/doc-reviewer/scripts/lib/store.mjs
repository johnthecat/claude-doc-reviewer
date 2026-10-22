import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./config.mjs";

/** Saved reviews: one JSON file per document, named by its review id. */
const REVIEWS = join(STATE_DIR, "reviews");

function file(id) {
  return join(REVIEWS, `${id}.json`);
}

/** The saved state of review `id`, or `undefined` when there is none. */
export function load(id) {
  return existsSync(file(id)) ? JSON.parse(readFileSync(file(id), "utf8")) : undefined;
}

/** Replaces the saved state of review `id` with `text`, so a crash mid-write leaves the previous state whole. */
export function save(id, text) {
  mkdirSync(REVIEWS, { recursive: true });
  writeFileSync(`${file(id)}.tmp`, text);
  renameSync(`${file(id)}.tmp`, file(id));
}
