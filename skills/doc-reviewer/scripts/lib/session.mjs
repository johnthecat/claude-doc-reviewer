import { randomUUID } from "node:crypto";
import { readFileSync, watch } from "node:fs";
import { Review } from "./review.mjs";
import * as store from "./store.mjs";
import { forClaude, pageView, syncForClaude, updatedToast } from "./views.mjs";

const EXIT_GRACE_SECONDS = 60;

/** A refused call, with the HTTP status and body that say why. */
export class Refusal extends Error {
  constructor(status, body) {
    super(body.error ?? "refused");
    this.status = status;
    this.body = body;
  }
}

/**
 * A live review: the review, the pages showing it, the Claude loop working on it, and the document on disk.
 *
 * Every change to the review comes through here, from a page, from Claude or from the file, and each one is saved and
 * sent to every page before the next.
 *
 * - The loop belongs to the last `open`. A call from an older loop is answered `replaced`, so two loops never work on
 *   the same review.
 * - A change to the file that lands while Claude holds a request is Claude's, checked against the approved blocks on
 *   Claude's next call. Any other change is the user's.
 * - The user's Exit goes to Claude's wait ahead of every request.
 *
 * A page is anything with `send(event, data)` and `close()`.
 */
export class Session {
  constructor(id, review, loop, onExit) {
    this.id = id;
    this.review = review;
    this.loop = loop;
    this.onExit = onExit;
    this.pages = new Set();
    this.waiter = null;
    this.exiting = false;
    this.saved = undefined;
    this.watcher = this.watchDocument();
    this.save();
  }

  /** The review saved under `id`, unless there is none or it finished. */
  static load(id, onExit) {
    const saved = store.load(id);
    if (!saved || saved.review.finished) return undefined;
    return new Session(id, new Review(saved.review.path, saved.review.text, saved.review), saved.loop, onExit);
  }

  /**
   * Starts a new Claude loop and returns its id. The older loop's wait is answered `replaced`, the request it held goes
   * back to the front, and the file as it now stands is taken as the user's.
   */
  openLoop() {
    this.exiting = false;
    this.review.requests.requeue();
    this.endWait({ type: "replaced" });
    this.loop = randomUUID().slice(0, 8);
    this.update(this.review.sync(this.readDocument(), "user").changed);
    return this.loop;
  }

  /** Shows the review on `page` from now on. Returns the function that detaches it. */
  attach(page) {
    this.pages.add(page);
    page.send("message", this.view());
    return () => this.pages.delete(page);
  }

  /** Applies a user action from a page. */
  act(action) {
    if (action.type === "exit") return this.exit();
    let result;
    try {
      result = this.review.act(action);
    } catch (error) {
      throw new Refusal(400, { error: error.message });
    }
    this.update();
    return result;
  }

  /** The user closed the review: every page closes, and Claude's loop receives `exit` next and the server stops. */
  exit() {
    this.exiting = true;
    this.review.record("exit", "Review page closed");
    this.save();
    this.broadcast("closed", {});
    this.deliver();
    setTimeout(() => this.exiting && this.onExit(), EXIT_GRACE_SECONDS * 1000).unref();
    return {};
  }

  /** Checks the document after Claude's edit. */
  sync(loop) {
    return this.fromClaude(loop, (sync) => ({ body: syncForClaude(sync) }));
  }

  /** Applies what Claude says about the request it is handling. */
  say(loop, message) {
    return this.fromClaude(loop, (sync) => {
      const result = this.review.say(message);
      return { body: { ...result, changed: syncForClaude(sync).changed }, toast: message.kind === "notice" ? message.text : undefined };
    });
  }

  /**
   * Ends Claude's current request and waits up to `seconds` for the next. Resolves with the request, or with `timeout`,
   * `exit` or `replaced`. When `signal` aborts, as when Claude's call drops, the wait ends with nothing.
   */
  wait(loop, seconds, signal) {
    if (loop !== this.loop) return Promise.resolve({ type: "replaced" });
    return new Promise((resolve) => {
      this.fromClaude(loop, () => {
        this.review.requests.finish();
        this.endWait({ type: "replaced" });
        const timer = setTimeout(() => {
          this.endWait(forClaude(this.review, { type: "timeout" }));
          this.publish();
        }, seconds * 1000);
        const waiter = { resolve, timer };
        this.waiter = waiter;
        signal.addEventListener("abort", () => {
          if (this.waiter !== waiter) return;
          this.endWait(undefined);
          this.publish();
        });
        return {};
      });
    });
  }

  /**
   * Runs a call from Claude's loop: answers an older loop `replaced`, takes the file as Claude's edit, and refuses the
   * call when that changed an approved block. `run` returns the call's `body` and an optional toast.
   */
  fromClaude(loop, run) {
    if (loop !== this.loop) return { type: "replaced" };
    const sync = this.review.sync(this.readDocument(), "claude");
    if (!sync.ok) throw new Refusal(409, syncForClaude(sync));
    let toast;
    try {
      const outcome = run(sync);
      toast = outcome.toast;
      return outcome.body;
    } catch (error) {
      throw new Refusal(400, { error: error.message });
    } finally {
      this.update(sync.changed, toast);
    }
  }

  /** Hands the next request to Claude's wait, if one is pending; after the user's Exit, that is the exit. */
  deliver() {
    if (!this.waiter) return;
    const event = this.exiting ? { type: "exit" } : this.review.take();
    if (!event) return;
    this.endWait(forClaude(this.review, event));
    if (this.exiting) this.onExit();
  }

  /** Ends Claude's pending wait, answering it with `event`. */
  endWait(event) {
    if (!this.waiter) return;
    const { resolve, timer } = this.waiter;
    clearTimeout(timer);
    this.waiter = null;
    resolve(event);
  }

  /** Hands Claude its next request, saves the review, sends it to every page, then flashes the changed blocks with a toast. */
  update(changed = [], toast = changed.length > 0 ? updatedToast(changed) : undefined) {
    this.deliver();
    this.save();
    this.publish();
    if (changed.length > 0) this.broadcast("changed", changed.map((block) => block.index));
    if (toast) this.broadcast("toast", toast);
  }

  view() {
    return pageView(this.review, this.waiter ? "listening" : this.review.requests.current ? "working" : "away");
  }

  publish() {
    this.broadcast("message", this.view());
  }

  broadcast(event, data) {
    for (const page of this.pages) page.send(event, data);
  }

  /** Writes the review to disk when it changed since the last write. */
  save() {
    const text = JSON.stringify({ loop: this.loop, review: this.review });
    if (text === this.saved) return;
    store.save(this.id, text);
    this.saved = text;
  }

  /** Saves the review, closes every page and stops watching the file. */
  close() {
    this.watcher.close();
    this.save();
    for (const page of this.pages) page.close();
  }

  readDocument() {
    return readFileSync(this.review.path, "utf8");
  }

  /** Takes a change to the file as the user's, unless Claude holds a request: then Claude's next call takes it. */
  watchDocument() {
    let timer;
    return watch(this.review.path, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (this.review.requests.current) return;
        let text;
        try {
          text = this.readDocument();
        } catch {
          return;
        }
        const { changed } = this.review.sync(text, "user");
        if (changed.length > 0) this.update(changed);
      }, 150);
    });
  }

  /** Whether a page shows the review or Claude waits on it. */
  active() {
    return this.pages.size > 0 || this.waiter !== null;
  }
}
