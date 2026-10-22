// Checks that need no ExcaliDash server: the address guard (the URL ends up in
// an iframe src) and a mention that must not block the user's message when the
// server is down.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import { DEFAULT_URL, excalidashBase } from "../shared.ts";

test("accepts only http(s) ExcaliDash addresses", () => {
  assert.equal(excalidashBase(""), DEFAULT_URL);
  assert.equal(excalidashBase("  https://boards.example:9450/ "), "https://boards.example:9450");
  assert.equal(excalidashBase("http://127.0.0.1:6767"), "http://127.0.0.1:6767");
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "not a url"]) {
    assert.equal(excalidashBase(bad), null, bad);
  }
});

test("the url setting refuses a non-http address", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "excalidash" });
  await plugin(bb);
  await assert.rejects(harness.setSettings({ url: "javascript:alert(1)" }));
  await harness.setSettings({ url: "http://127.0.0.1:6767" });
});

test("a mention still sends the board link when ExcaliDash is unreachable", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "excalidash" });
  await plugin(bb);
  // Port 9 (discard) is closed here, so the fetch fails fast.
  await harness.setSettings({ url: "http://127.0.0.1:9" });
  const provider = harness.inspection.registrations.mentionProviders.find((p) => p.id === "board");
  assert.ok(provider);
  const resolved = await provider.resolve("board-123");
  const context = typeof resolved === "string" ? resolved : resolved.context;
  assert.ok(context.includes("http://127.0.0.1:9/editor/board-123"), context);
  assert.ok(context.includes("excalidash get board-123"), context);
});

async function withFakeExcaliDash(run: (url: string, seen: (string | undefined)[]) => Promise<void>) {
  const seen: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.setHeader("content-type", "application/json");
    const path = req.url ?? "";
    if (path.startsWith("/api/collections")) res.end(JSON.stringify([{ id: "c1", name: "Схемы" }]));
    else if (path.startsWith("/api/drawings")) {
      res.end(JSON.stringify({ drawings: [{ id: "b1", name: "Доска", collectionId: "c1", version: 1, updatedAt: "2026-01-01" }] }));
    } else res.writeHead(404).end("{}");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    server.close();
  }
}

async function boardSearch(url: string, apiKey: string) {
  const { bb, harness } = createFakePluginHost({ pluginId: "excalidash" });
  await plugin(bb);
  await harness.setSettings({ url, apiKey });
  const provider = harness.inspection.registrations.mentionProviders.find((p) => p.id === "board");
  assert.ok(provider);
  return provider.search({ trigger: "@", query: "", projectId: null, threadId: null });
}

test("the board list is requested with the API key as a Bearer token", async () => {
  await withFakeExcaliDash(async (url, seen) => {
    const items = await boardSearch(url, "exd_test_key");
    assert.deepEqual(items.map((item) => item.id), ["b1"]);
    assert.ok(seen.length >= 2);
    assert.ok(seen.every((header) => header === "Bearer exd_test_key"), String(seen));
  });
});

test("no Authorization header is sent without an API key", async () => {
  await withFakeExcaliDash(async (url, seen) => {
    await boardSearch(url, "");
    assert.ok(seen.length >= 2);
    assert.ok(seen.every((header) => header === undefined), String(seen));
  });
});

test("a 401 from ExcaliDash points at the apiKey setting", async () => {
  const server = createServer((_req, res) => res.writeHead(401).end("{}"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await assert.rejects(boardSearch(url, ""), /HTTP 401.*apiKey/);
  } finally {
    server.close();
  }
});
