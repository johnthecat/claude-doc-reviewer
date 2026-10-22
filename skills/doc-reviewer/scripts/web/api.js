import { reviewId } from "./store.js";
import { toast } from "./toast.js";

/** Sends a user action. Returns the server's answer, or `null` once a toast has said why it was refused. */
export async function act(action) {
  const response = await fetch(`/api/${reviewId}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = await response.json();
  if (!response.ok) toast(body.error ?? "Something went wrong");
  return response.ok ? body : null;
}

/**
 * Follows the review's event stream: `view` gets each new view of the review, `changed` the indexes of the blocks an
 * edit changed, `toast` a message to show, `closed` the end of the review, and `disconnected` a lost connection.
 */
export function follow(handlers) {
  const stream = new EventSource(`/api/${reviewId}/stream`);
  stream.onmessage = (message) => handlers.view(JSON.parse(message.data));
  stream.addEventListener("changed", (message) => handlers.changed(JSON.parse(message.data)));
  stream.addEventListener("toast", (message) => handlers.toast(JSON.parse(message.data)));
  stream.addEventListener("closed", () => {
    stream.close();
    handlers.closed();
  });
  stream.onerror = handlers.disconnected;
}
