/**
 * What each side sees of a review: the page's view, and the requests and results Claude receives. The review keeps
 * ids; these name blocks by their index, title and lines as they stand now.
 */

const closeReview = () => "Close the review";

const LABELS = {
  pointer: (title) => `Questions for ${title}`,
  comment: (title) => `Comment on ${title}`,
  answer: (title) => `Answer on ${title}`,
  update: () => "Update an approved block",
  drop: () => "Rework a dropped change",
  "outside-edit": () => "Check your edit to the file",
  complete: closeReview,
  finish: closeReview,
};

/** A block as Claude and the toasts name it. */
export function describeBlock(block) {
  return block && { index: block.index + 1, title: block.title, startLine: block.startLine, endLine: block.endLine };
}

/**
 * A request or loop event as Claude receives it: its block described, the blocks an outside edit changed, where the
 * pointer is when that is another block, and the counts.
 */
export function forClaude(review, event) {
  const { settled, blocks, ...request } = event;
  const block = review.document.block(event.block);
  const pointer = review.pointerBlock();
  return {
    ...request,
    ...(block && { block: describeBlock(block), approved: review.isApproved(block) }),
    ...(blocks && { changed: blocks.map((id) => describeBlock(review.document.block(id))).filter(Boolean) }),
    ...(block?.id !== pointer?.id && { pointer: describeBlock(pointer) }),
    counts: review.counts(),
  };
}

/** A sync result as Claude receives it: the blocks it changed, or the approved blocks Claude must restore. */
export function syncForClaude({ ok, changed, violations }) {
  return ok ? { ok, changed: changed.map(describeBlock) } : { ok, violations: violations.map((block) => ({ ...describeBlock(block), text: block.text })) };
}

/** The toast after an edit: the blocks it changed, up to three by name. */
export function updatedToast(changed) {
  const titles = changed.map((block) => block.title);
  return `Updated ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? ` and ${titles.length - 3} more` : ""}`;
}

/** The requests the page lists: the one Claude is working on, then the ones waiting, each with a short label. */
function requestList(review) {
  const entry = (request, status) => {
    const block = review.document.block(request.block);
    return {
      id: request.id,
      type: request.type,
      comment: request.comment,
      block: request.block,
      questionId: request.questionId,
      status,
      label: LABELS[request.type](block?.title ?? ""),
      index: block?.index ?? null,
    };
  };
  const current = review.requests.current;
  return [...(current ? [entry(current, "working")] : []), ...review.waiting().map((request) => entry(request, "queued"))];
}

/**
 * The view the page draws. `claude` is whether Claude is listening, working or away.
 *
 * The pointer block's questions carry the status of their answers. While the block has no questions, `pending` says
 * where its request stands: its status, its type, and how many requests are ahead. A comment waiting on Claude is
 * `sent` while its request is queued and `working` once Claude has taken it.
 */
export function pageView(review, claude) {
  const pointer = review.pointerBlock();
  const requests = requestList(review);
  const answerStatus = (question) => requests.find((request) => request.questionId === question.id)?.status ?? "done";
  const questions = review.questions.get(pointer?.id);
  const pointerRequest = requests.find((request) => request.block === pointer?.id);
  return {
    path: review.path,
    started: review.started,
    claude,
    counts: review.counts(),
    finished: review.finished,
    pointer: pointer?.index ?? 0,
    blocks: review.blocks.map((block) => ({ ...block, approved: review.isApproved(block) })),
    questions: questions?.map((question) => ({ ...question, status: question.answer ? answerStatus(question) : null })) ?? null,
    pending: questions || !pointerRequest ? null : { status: pointerRequest.status, type: pointerRequest.type, ahead: requests.indexOf(pointerRequest) },
    requests,
    comments: review.comments
      .filter((comment) => comment.status !== "dropped" && review.document.block(comment.block))
      .map((comment) => {
        const working = comment.status === "sent" && requests.some((request) => request.comment === comment.id && request.status === "working");
        return { ...comment, status: working ? "working" : comment.status, index: review.document.block(comment.block).index };
      }),
    conflicts: review.conflicts
      .filter((conflict) => conflict.status === "pending")
      .map((conflict) => ({ id: conflict.id, comment: conflict.comment, message: conflict.message, index: review.document.block(conflict.blocks[0])?.index ?? null })),
    log: review.log.slice(-100),
  };
}
