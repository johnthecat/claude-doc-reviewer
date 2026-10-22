import { Document } from "./document.mjs";
import { Requests } from "./requests.mjs";

/**
 * One document's review, and the rules it runs by.
 *
 * Entities: the document and its blocks, the pointer, the approved blocks, each block's questions, the user's comments,
 * the conflicts holding back a change to an approved block, the activity log, and Claude's requests.
 *
 * The user acts with `act` and Claude responds with `say`; a new version of the document comes in through `sync`.
 * Every user action names what it acts on by id: the block, the question or the conflict the user saw. One whose target
 * moved on or is gone is refused, so a change that lands while the user decides never redirects their action.
 */
export class Review {
  constructor(path, text, saved) {
    this.path = path;
    this.started = saved?.started ?? new Date().toISOString();
    this.nextId = saved?.nextId ?? 1;
    this.document = Document.parse(text, saved?.blockIds ?? [], () => this.newId("b"));
    this.approved = new Set(saved?.approved);
    /** Approved blocks the user let Claude change by updating a conflict, until Claude does. */
    this.unlocked = new Set(saved?.unlocked);
    this.pointer = saved?.pointer ?? this.blocks[0]?.id;
    this.questions = new Map(Object.entries(saved?.questions ?? {}));
    this.comments = saved?.comments ?? [];
    this.conflicts = saved?.conflicts ?? [];
    this.log = saved?.log ?? [];
    this.finished = saved?.finished ?? null;
    this.requests = new Requests(saved?.requests);
  }

  /** The state written to disk. */
  toJSON() {
    return {
      path: this.path,
      started: this.started,
      text: this.document.text,
      blockIds: this.blocks.map((block) => block.id),
      approved: [...this.approved],
      unlocked: [...this.unlocked],
      pointer: this.pointer,
      questions: Object.fromEntries(this.questions),
      comments: this.comments,
      conflicts: this.conflicts,
      log: this.log.slice(-200),
      finished: this.finished,
      requests: this.requests,
      nextId: this.nextId,
    };
  }

  get blocks() {
    return this.document.blocks;
  }

  /** The block the pointer is on. */
  pointerBlock() {
    return this.document.block(this.pointer) ?? this.blocks[0];
  }

  isApproved(block) {
    return this.approved.has(block.id);
  }

  counts() {
    const approved = this.blocks.filter((block) => this.isApproved(block)).length;
    return { total: this.blocks.length, approved, open: this.blocks.length - approved };
  }

  /** The next open block after `block`, or the first open block from the top when none follow. */
  nextOpen(block) {
    const open = this.blocks.filter((candidate) => !this.isApproved(candidate) && candidate !== block);
    return open.find((candidate) => candidate.index > (block?.index ?? -1)) ?? open[0];
  }

  comment(id) {
    return this.comments.find((comment) => comment.id === id);
  }

  /** Whether the block with this id still needs Claude's questions. */
  needsQuestions(id) {
    return Boolean(this.document.block(id)) && !this.finished && !this.questions.has(id);
  }

  /**
   * Adopts a new version of the document and returns the blocks it changed.
   *
   * `source` is `claude` for Claude's edit and `user` for any other. Claude may change an approved block only once the
   * user updated a conflict naming it; any other change Claude makes to one is refused with the blocks it changed, and
   * the review keeps the previous version. A user's own edit to an approved block is taken as intended: the block stays
   * approved, and Claude is asked to check the open blocks against it.
   */
  sync(text, source) {
    if (text === this.document.text) return { ok: true, changed: [] };
    const next = this.document.revise(text, () => this.newId("b"));
    if (source === "claude") {
      const violations = [...this.approved]
        .map((id) => this.document.block(id))
        .filter((block) => next.block(block.id)?.text !== block.text && !this.unlocked.has(block.id));
      if (violations.length > 0) return { ok: false, violations };
    }

    const changed = this.document.changedIn(next);
    const pointerIndex = this.pointerBlock()?.index ?? 0;
    this.document = next;
    for (const block of changed) {
      this.unlocked.delete(block.id);
      this.questions.delete(block.id);
    }
    for (const id of [...this.approved, ...this.questions.keys()]) {
      if (next.block(id)) continue;
      this.approved.delete(id);
      this.questions.delete(id);
    }
    if (!next.block(this.pointer)) this.pointer = this.blocks[Math.min(pointerIndex, this.blocks.length - 1)]?.id;
    if (changed.length === 0) return { ok: true, changed };
    const titles = changed.map((block) => block.title).join(", ");
    this.record(source === "claude" ? "edit" : "outside", `${source === "claude" ? "Edited" : "Edited outside"}: ${titles}`);
    if (source === "user") this.request({ type: "outside-edit", blocks: changed.map((block) => block.id) });
    return { ok: true, changed };
  }

  /** Applies a user action and queues what it asks of Claude. A finished review takes none. */
  act(action) {
    if (this.finished) throw new Error("The review is finished");
    switch (action.type) {
      case "comment":
        return this.addComment(this.target(action.block), action.quote ?? "", action.text);
      case "answer":
        this.answer(this.target(action.block), action.question, action.text);
        break;
      case "approve":
        this.approve(this.pointerTarget(action.block));
        break;
      case "skip":
        this.movePointer(this.nextOpen(this.pointerTarget(action.block)), "skip");
        break;
      case "goto":
        this.movePointer(this.target(action.block), "goto");
        break;
      case "update":
      case "drop":
        this.resolve(action.conflict, action.type, action.text?.trim() ?? "");
        break;
      case "finish":
        this.request({ type: "finish" });
        this.record("finish", "Review finish requested");
        break;
      default:
        throw new Error(`unknown action ${action.type}`);
    }
    return {};
  }

  /** The block an action names. */
  target(id) {
    const block = this.document.block(id);
    if (!block) throw new Error("That block is no longer in the document");
    return block;
  }

  /** The pointer block, when it is the block the action names: approving or skipping acts on the block the user saw. */
  pointerTarget(id) {
    const block = this.target(id);
    if (block.id !== this.pointerBlock()?.id) throw new Error("The review moved to another block meanwhile");
    return block;
  }

  /** Queues a comment. The pointer moves to its block only once Claude replies to it, since a question changes nothing. */
  addComment(block, quote, text) {
    if (!text?.trim()) throw new Error("empty comment");
    const comment = { id: this.newId("c"), block: block.id, quote, text, status: "sent", reply: "" };
    this.comments.push(comment);
    this.request({ type: "comment", comment: comment.id, block: block.id, quote, text });
    this.record("comment", `Comment on ${block.title}: ${text}`);
    return { id: comment.id };
  }

  answer(block, questionId, text) {
    if (!text?.trim()) throw new Error("empty answer");
    const question = this.questions.get(block.id)?.find((candidate) => candidate.id === questionId);
    if (!question) throw new Error("Claude replaced that question meanwhile");
    if (question.answer) throw new Error("That question is already answered");
    question.answer = text;
    this.request({ type: "answer", block: block.id, questionId, question: question.text, text });
    this.record("answer", `Answer to "${question.text}": ${text}`);
  }

  approve(block) {
    if (this.isApproved(block)) return;
    this.approved.add(block.id);
    this.record("approve", `Approved ${block.title}`);
    const next = this.nextOpen(block);
    if (next) this.movePointer(next, "approved");
    else this.request({ type: "complete" });
  }

  /** Moves the pointer, asking Claude for the block's questions unless the same move already waits. */
  movePointer(block, reason) {
    if (!block || block.id === this.pointer) return;
    this.pointer = block.id;
    if (this.requests.waiting.some((request) => request.type === "pointer" && request.block === block.id)) return;
    this.request({ type: "pointer", reason, block: block.id });
  }

  /**
   * Settles a held change with the user's decision and their comment on how to resolve it. An update goes back to
   * Claude with the approved blocks it names unlocked. A drop goes back only when the user said what to do instead,
   * and otherwise drops the comment with nothing for Claude to do.
   */
  resolve(id, decision, text) {
    const conflict = this.conflicts.find((candidate) => candidate.id === id && candidate.status === "pending");
    if (!conflict) throw new Error("That change is no longer held");
    const updated = decision === "update";
    const forClaude = updated || text !== "";
    conflict.status = updated ? "updated" : "dropped";
    const comment = this.comment(conflict.comment);
    if (comment) comment.status = forClaude ? "sent" : "dropped";
    if (updated) for (const block of conflict.blocks) this.unlocked.add(block);
    if (forClaude) this.request({ type: decision, conflict: id, comment: conflict.comment, message: conflict.message, ...(text && { text }) });
    this.record(decision, `${updated ? "Updated" : "Dropped"}: ${conflict.message}${text && ` · ${text}`}`);
  }

  /**
   * Applies Claude's response to the request it is handling. Anything but a notice settles that request, so it is not
   * handed out again when the review reopens.
   *
   * A reply, an answer or a conflict is about the request's comment unless it names another with `comment`. A reply
   * follows a change and moves the pointer to the comment's block when that block is open. An answer only answers a
   * question, so it leaves the pointer, the questions and the requests as they are.
   */
  say(message) {
    const result = this.respond(message);
    if (message.kind !== "notice") this.requests.settle();
    return result;
  }

  respond(message) {
    const current = this.requests.current;
    const comment = this.comment(message.comment ?? current?.comment);
    switch (message.kind) {
      case "questions": {
        const block = message.line ? this.document.blockAtLine(message.line) : (this.document.block(current?.block) ?? this.pointerBlock());
        if (!block) throw new Error(`no block at line ${message.line}`);
        this.questions.set(block.id, (message.items ?? []).map((text) => ({ id: this.newId("q"), text, answer: "" })));
        return {};
      }
      case "reply": {
        if (comment) {
          comment.status = "done";
          comment.reply = message.text ?? "";
          const block = this.document.block(comment.block);
          if (block && !this.isApproved(block)) this.pointer = block.id;
        }
        if (message.text) this.record("reply", message.text);
        return {};
      }
      case "answer": {
        if (!comment) throw new Error("an answer is for a comment");
        if (!message.text) throw new Error("an answer needs text");
        comment.status = "answered";
        comment.reply = message.text;
        this.record("reply", message.text);
        return {};
      }
      case "conflict": {
        const blocks = (message.lines ?? []).map((line) => this.document.blockAtLine(line)).filter((block) => block && this.isApproved(block));
        if (blocks.length === 0) throw new Error("a conflict must name the start line of an approved block");
        const id = this.newId("x");
        this.conflicts.push({ id, comment: comment?.id ?? null, blocks: blocks.map((block) => block.id), message: message.message ?? "", status: "pending" });
        if (comment) comment.status = "held";
        this.record("conflict", message.message ?? "Conflict with an approved block");
        return { id };
      }
      case "notice":
        this.record("notice", message.text ?? "");
        return {};
      case "finish":
        this.finished = { summary: message.summary ?? "", counts: this.counts() };
        this.record("finish", "Review complete");
        return {};
      default:
        throw new Error(`unknown message kind ${message.kind}`);
    }
  }

  request(request) {
    this.requests.add({ ...request, id: this.newId("r") });
  }

  /**
   * The requests waiting for Claude, in order: the user's actions, then the pointer block's questions if it has none.
   * A pointer request whose block already has its questions has nothing left to ask.
   */
  waiting() {
    const waiting = this.requests.waiting.filter((request) => request.type !== "pointer" || this.needsQuestions(request.block));
    const pointer = this.pointerBlock();
    const asked = [this.requests.current, ...waiting].some((request) => request?.type === "pointer" && request.block === pointer?.id);
    if (this.needsQuestions(pointer?.id) && !asked) waiting.push({ id: `q${pointer.id}`, type: "pointer", reason: "questions", block: pointer.id });
    return waiting;
  }

  /** Hands Claude the next request, or `undefined` when none is waiting. */
  take() {
    return this.requests.start(this.waiting());
  }

  record(kind, text) {
    this.log.push({ at: new Date().toISOString(), kind, text });
  }

  newId(prefix) {
    return `${prefix}${this.nextId++}`;
  }
}
