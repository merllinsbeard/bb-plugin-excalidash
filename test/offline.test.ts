// Checks that need no ExcaliDash server: the address guard (the URL ends up in
// an iframe src) and a mention that must not block the user's message when the
// server is down.
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
