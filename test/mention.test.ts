// Integration test against the live ExcaliDash server (tailnet): a temporary
// board is created and deleted with the `excalidash` skill CLI, and the
// plugin's @-mention provider is driven through the official fake bb host.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

const CLI = join(homedir(), ".agents/skills/excalidash/scripts/excalidash");
const SCRIPTS = join(homedir(), ".agents/skills/excalidash/scripts");
const tag = Math.random().toString(36).slice(2, 8);
const boardName = `Проверка упоминания ${tag}`;
let boardId = "";

const cli = (...args: string[]) => JSON.parse(execFileSync(CLI, args, { encoding: "utf8" }));

before(() => {
  const dir = mkdtempSync(join(tmpdir(), "excalidash-test-"));
  const build = join(dir, "build.py");
  writeFileSync(
    build,
    [
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
      "from scene import *",
      "s = Scene()",
      'f = s.frame("1 · План", 0, 0)',
      's.text("Главная мысль", 80, 60, size=48, frame=f)',
      'a = s.box(80, 300, 300, 120, "Блок A", frame=f)',
      'b = s.box(600, 300, 300, 120, "Блок B", frame=f)',
      's.arrow(a, b, "связь", frame=f)',
      `s.save(${JSON.stringify(join(dir, "board.excalidraw"))})`,
    ].join("\n"),
  );
  execFileSync("python3", [build]);
  boardId = cli("create", boardName, join(dir, "board.excalidraw")).id;
});

after(() => {
  if (boardId) cli("delete", boardId, "--yes");
});

async function loadProvider() {
  const { bb, harness } = createFakePluginHost({ pluginId: "excalidash" });
  await plugin(bb);
  await harness.setSettings({ apiKey: process.env.EXCALIDASH_BB_PLUGIN_API_KEY ?? "" });
  const provider = harness.inspection.registrations.mentionProviders.find((p) => p.id === "board");
  assert.ok(provider, "mention provider registered");
  return provider;
}

const search = (provider: Awaited<ReturnType<typeof loadProvider>>, query: string) =>
  Promise.resolve(provider.search({ trigger: "@", query, projectId: null, threadId: null }));

test("finds a board by its Cyrillic name regardless of case", async () => {
  const provider = await loadProvider();
  const items = await search(provider, `ПРОВЕРКА упоминания ${tag}`);
  assert.deepEqual(
    items.map((item) => item.id),
    [boardId],
  );
  assert.equal(items[0]?.title, boardName);
});

test("resolves a board into its frames, texts and editing commands", async () => {
  const provider = await loadProvider();
  const resolved = await provider.resolve(boardId);
  const context = typeof resolved === "string" ? resolved : resolved.context;
  for (const expected of [
    boardName,
    `/editor/${boardId}`,
    "Фрейм «1 · План»",
    "- Главная мысль",
    "- Блок A",
    "- связь",
    `excalidash get ${boardId}`,
    `::excalidash{board="${boardId}"`,
  ]) {
    assert.ok(context.includes(expected), `context mentions ${expected}\n---\n${context}`);
  }
});

test("does not offer boards from the trash", async () => {
  cli("move", boardId, "trash");
  const provider = await loadProvider();
  assert.deepEqual(await search(provider, tag), []);
});
