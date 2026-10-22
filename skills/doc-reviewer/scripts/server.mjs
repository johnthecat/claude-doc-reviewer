#!/usr/bin/env node
/**
 * Local review server: serves the review page and routes the page's and Claude's calls to the live reviews.
 *
 * Binds to loopback only and accepts requests whose Host names it. One server runs at a time: a second one started
 * meanwhile finds the first on the port and exits, so a review never lives in two servers. Exits after `IDLE_MINUTES`
 * with no page open and no Claude waiting, and once the user's Exit reaches Claude.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { json } from "node:stream/consumers";
import { SERVER_FILE, reviewId } from "./lib/config.mjs";
import { Review } from "./lib/review.mjs";
import { Refusal, Session } from "./lib/session.mjs";

const WEB = join(import.meta.dirname, "web");
const IDLE_MINUTES = Number(process.env.DOC_REVIEWER_IDLE_MINUTES ?? 120);
const MAX_WAIT_SECONDS = 280;
const PORT = Number(process.env.DOC_REVIEWER_PORT ?? 4388);

/** Live reviews by id. */
const sessions = new Map();
let lastActivity = Date.now();

/** The live review with this id, or the one saved before the server restarted. */
function findSession(id) {
  if (!sessions.has(id)) {
    const saved = Session.load(id, shutdown);
    if (saved) sessions.set(id, saved);
  }
  return sessions.get(id);
}

/** Opens the review of `path` for a new Claude loop. A finished review, or `fresh`, starts over. */
function open(path, fresh) {
  const id = reviewId(path);
  let session = fresh ? undefined : findSession(id);
  if (!session || session.review.finished) {
    sessions.get(id)?.close();
    session = new Session(id, new Review(path, readFileSync(path, "utf8")), null, shutdown);
    sessions.set(id, session);
  }
  return { session, loop: session.openLoop() };
}

/** Saves every review, closes every page and stops the server. */
function shutdown() {
  setImmediate(() => {
    for (const session of sessions.values()) session.close();
  });
  setTimeout(() => process.exit(0), 200);
}

/** An event in the page stream's format. */
function frame(event, data) {
  return `${event === "message" ? "" : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

/** A page's event stream, as a session sends to it. */
function pageStream(response) {
  return {
    send: (event, data) => response.write(frame(event, data)),
    close: () => response.end(frame("closed", {})),
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function serveStatic(response, file) {
  const path = join(WEB, file);
  if (!path.startsWith(WEB) || !existsSync(path)) return sendJson(response, 404, { error: "not found" });
  response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  response.end(readFileSync(path));
}

/** Whether a request names this server as its host and, when it has an origin, comes from this server's pages. */
function allowed(request, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const { host, origin } = request.headers;
  return hosts.includes(host) && (origin === undefined || hosts.some((candidate) => origin === `http://${candidate}`));
}

async function handle(request, response, port) {
  lastActivity = Date.now();
  if (!allowed(request, port)) return sendJson(response, 403, { error: "forbidden" });
  const url = new URL(request.url, `http://${request.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && parts[0] === "review" && parts.length === 2) return serveStatic(response, "index.html");
  if (request.method === "GET" && parts[0] === "static" && parts.length === 2) return serveStatic(response, parts[1]);
  if (parts[0] !== "api") return sendJson(response, 404, { error: "not found" });

  if (parts[1] === "health") return sendJson(response, 200, { ok: true, app: "doc-reviewer", pid: process.pid });
  if (request.method === "POST" && parts[1] === "stop") {
    sendJson(response, 200, { stopped: true });
    return shutdown();
  }
  if (request.method === "POST" && parts[1] === "open") {
    const body = await json(request);
    const { session, loop } = open(body.path, body.fresh);
    return sendJson(response, 200, { id: session.id, loop, url: `http://127.0.0.1:${port}/review/${session.id}`, ...session.review.counts() });
  }

  const session = findSession(parts[1]);
  if (!session) return sendJson(response, 404, { error: "no such review; open it first" });
  const route = `${request.method} ${parts[2]}`;
  const loop = url.searchParams.get("loop");

  if (route === "GET stream") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    request.on("close", session.attach(pageStream(response)));
    return;
  }
  if (route === "POST action") return sendJson(response, 200, session.act(await json(request)));
  if (route === "POST sync") return sendJson(response, 200, session.sync(loop));
  if (route === "POST say") return sendJson(response, 200, session.say(loop, await json(request)));
  if (route === "POST wait") {
    const seconds = Math.min(Number(url.searchParams.get("timeout") ?? MAX_WAIT_SECONDS), MAX_WAIT_SECONDS);
    const dropped = new AbortController();
    request.on("close", () => dropped.abort());
    const event = await session.wait(loop, seconds, dropped.signal);
    if (event) sendJson(response, 200, event);
    return;
  }
  return sendJson(response, 404, { error: "not found" });
}

const server = createServer((request, response) => {
  handle(request, response, server.address().port).catch((error) =>
    error instanceof Refusal ? sendJson(response, error.status, error.body) : sendJson(response, 500, { error: error.message }),
  );
});

/** On a taken port, exits when the server there is another review server, and otherwise listens on any free port. */
server.once("error", async (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  const running = await fetch(`http://127.0.0.1:${PORT}/api/health`)
    .then((response) => response.json())
    .catch(() => null);
  if (running?.app === "doc-reviewer") process.exit(0);
  server.listen(0, "127.0.0.1");
});
server.on("listening", () => {
  const address = JSON.stringify({ port: server.address().port, pid: process.pid });
  writeFileSync(SERVER_FILE, address);
  process.stdout.write(`${address}\n`);
});
server.listen(PORT, "127.0.0.1");

setInterval(() => {
  const active = sessions.values().some((session) => session.active());
  if (!active && Date.now() - lastActivity > IDLE_MINUTES * 60_000) process.exit(0);
}, 60_000).unref();
