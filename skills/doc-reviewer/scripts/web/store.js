/** The review this page shows, named in its address. */
export const reviewId = location.pathname.split("/").filter(Boolean)[1];

/** The latest view of the review the server sent. Every part of the page draws from it. */
export let state = null;

export function setState(next) {
  state = next;
}

/** The block the pointer is on. */
export function pointerBlock() {
  return state.blocks[state.pointer];
}
