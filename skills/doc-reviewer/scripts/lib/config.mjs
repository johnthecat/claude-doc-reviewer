import { hash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where reviews and the running server's address are kept. */
export const STATE_DIR = process.env.DOC_REVIEWER_HOME ?? join(homedir(), ".cache", "doc-reviewer");

/** The file naming the running server's port and process. */
export const SERVER_FILE = join(STATE_DIR, "server.json");

/** The review id for a document's absolute path. */
export function reviewId(path) {
  return hash("sha256", path).slice(0, 12);
}
