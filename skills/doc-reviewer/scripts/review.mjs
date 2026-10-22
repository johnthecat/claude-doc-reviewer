#!/usr/bin/env node
/**
 * Command-line interface Claude uses to run a browser review.
 *
 *   review.mjs open <doc> [--fresh] [--no-browser]           start or resume the review, open the page, print the loop id
 *   review.mjs wait <doc> --loop <id> [--timeout <seconds>]  wait for the user's next action and print it as JSON
 *   review.mjs say <doc> --loop <id> [<json>]                show a message on the page (JSON argument or stdin)
 *   review.mjs sync <doc> --loop <id>                        re-read the document and check approved blocks
 *   review.mjs stop                                          stop the server
 *
 * Every command prints JSON. `--loop` names the loop `open` started; once a later `open` starts another, the older
 * loop's commands print `{"type":"replaced"}`. Exit code 2 means an approved block changed without the user's
 * confirmation; the output names each block with its approved text so it can be restored.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { SERVER_FILE, STATE_DIR, reviewId } from "./lib/config.mjs";

function print(body) {
  process.stdout.write(`${JSON.stringify(body)}\n`);
}

function fail(message) {
  print({ error: message });
  process.exit(1);
}

function serverAddress() {
  if (!existsSync(SERVER_FILE)) return null;
  return JSON.parse(readFileSync(SERVER_FILE, "utf8"));
}

async function healthy(address) {
  if (!address) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    return (await response.json()).app === "doc-reviewer";
  } catch {
    return false;
  }
}

/**
 * Returns the running server's port, starting a server when none answers. A server started alongside another exits,
 * so whichever answers first is the one.
 */
async function ensureServer() {
  const current = serverAddress();
  if (await healthy(current)) return current.port;
  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(join(STATE_DIR, "server.log"), "a");
  spawn(process.execPath, [join(import.meta.dirname, "server.mjs")], { detached: true, stdio: ["ignore", log, log] }).unref();
  for (let attempt = 0; attempt < 50; attempt++) {
    await sleep(100);
    const address = serverAddress();
    if (await healthy(address)) return address.port;
  }
  fail(`the review server did not start; see ${join(STATE_DIR, "server.log")}`);
}

async function post(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Posts to the running server, starting one when none answers. */
async function call(path, body) {
  const address = serverAddress();
  if (address) {
    try {
      return await post(address.port, path, body);
    } catch {}
  }
  return post(await ensureServer(), path, body);
}

/** Calls a route of the review of `doc` for Claude's loop. The server resumes a review it saved before a restart. */
function loopCall(doc, route, query, body = {}) {
  if (!options.loop) fail("pass --loop with the loop id that open printed");
  return call(`/api/${reviewId(doc)}/${route}?${new URLSearchParams({ loop: options.loop, ...query })}`, body);
}

function finish({ status, body }) {
  print(body);
  if (status === 409) process.exit(2);
  if (status >= 400) process.exit(1);
}

function documentPath(doc) {
  if (!doc) fail("name the document");
  const path = resolve(doc);
  if (!existsSync(path)) fail(`no such document: ${path}`);
  return path;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}

const {
  positionals: [command, doc, json],
  values: options,
} = parseArgs({
  allowPositionals: true,
  options: { fresh: { type: "boolean" }, "no-browser": { type: "boolean" }, timeout: { type: "string" }, loop: { type: "string" } },
});

switch (command) {
  case "open": {
    const path = documentPath(doc);
    const result = await call("/api/open", { path, fresh: Boolean(options.fresh) });
    if (result.status === 200 && !options["no-browser"]) openBrowser(result.body.url);
    finish(result);
    break;
  }
  case "wait": {
    finish(await loopCall(documentPath(doc), "wait", options.timeout ? { timeout: options.timeout } : {}));
    break;
  }
  case "say": {
    const path = documentPath(doc);
    let message;
    try {
      message = JSON.parse(json ?? readFileSync(0, "utf8"));
    } catch {
      fail("say takes a JSON message");
    }
    finish(await loopCall(path, "say", {}, message));
    break;
  }
  case "sync": {
    finish(await loopCall(documentPath(doc), "sync", {}));
    break;
  }
  case "stop": {
    const address = serverAddress();
    if (await healthy(address)) await post(address.port, "/api/stop", {});
    print({ stopped: true });
    break;
  }
  default:
    fail("usage: review.mjs open|wait|say|sync|stop <doc>");
}
