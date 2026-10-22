/**
 * Claude's requests: the ones waiting, in order, and the one Claude is handling.
 *
 * Claude takes one request at a time, so a new one never interrupts the one in progress. A request Claude answered is
 * settled. One Claude stopped working on before settling goes back to the front, so it is handed out again rather than
 * lost.
 */
export class Requests {
  constructor(saved) {
    this.waiting = saved?.waiting ?? [];
    this.current = saved?.current ?? null;
  }

  toJSON() {
    return { waiting: this.waiting, current: this.current };
  }

  add(request) {
    this.waiting.push(request);
  }

  /**
   * Starts Claude on the first of `ordered`, the waiting requests as the review orders them now, and keeps the rest of
   * those that were queued. Returns the request, or `undefined` when none waits.
   */
  start(ordered) {
    const [next, ...rest] = ordered;
    if (!next) return undefined;
    this.waiting = rest.filter((request) => this.waiting.includes(request));
    this.current = next;
    return next;
  }

  /** Claude answered its current request, so it is not handed out again. */
  settle() {
    if (this.current) this.current.settled = true;
  }

  /** Claude is done with its current request and waits for the next. */
  finish() {
    this.current = null;
  }

  /** Claude stopped before settling its current request, so it goes back to the front. */
  requeue() {
    if (this.current && !this.current.settled) this.waiting.unshift(this.current);
    this.current = null;
  }
}
