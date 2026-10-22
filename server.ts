// bb-plugin-excalidash — backend.
//
// Boards live only in our ExcaliDash server; this plugin stores nothing. The
// backend answers the composer's `@` menu: it lists boards over ExcaliDash's
// REST API and, when a message is sent, turns the picked board into an
// agent-only summary (frames, their texts, counts) plus the commands of the
// global `excalidash` skill, which is how agents read and edit boards.
// The panels that show ExcaliDash itself and the `::excalidash{…}` reply card
// live in app.tsx.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULT_URL, excalidashBase } from "./shared.ts";

// The host gives `search` 2 s per keystroke; `resolve` runs once at send time.
const SEARCH_TIMEOUT_MS = 1_500;
const RESOLVE_TIMEOUT_MS = 8_000;
const LIST_TTL_MS = 30_000;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_TEXTS_PER_FRAME = 20;

const collectionSchema = z.object({ id: z.string(), name: z.string() });
const boardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  collectionId: z.string().nullable().optional(),
  version: z.union([z.string(), z.number()]),
  updatedAt: z.string(),
});
const elementSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    isDeleted: z.boolean().optional(),
    frameId: z.string().nullable().optional(),
    containerId: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    text: z.string().optional(),
    fontSize: z.number().optional(),
    link: z.string().nullable().optional(),
  })
  .passthrough();
const boardSchema = boardSummarySchema.extend({
  elements: z.array(elementSchema),
  files: z.record(z.string(), z.unknown()).nullable().optional(),
});
type Board = z.infer<typeof boardSchema>;
type Element = z.infer<typeof elementSchema>;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function editingHint(boardId: string): string {
  return (
    `Читай и правь доску через скилл excalidash: \`excalidash get ${boardId} --out board.excalidraw\`, ` +
    `правка через scene.py, затем \`excalidash update ${boardId} board.excalidraw\` (открытые редакторы увидят правку сразу). ` +
    `Посмотреть доску или фрейм картинкой: \`excalidash shot ${boardId} --out /tmp/board.png [--frame "…"]\`. ` +
    `Когда покажешь доску в ответе, добавь отдельной строкой \`::excalidash{board="${boardId}" title="<название>"}\`: ` +
    `у пользователя появится карточка с кнопкой «Открыть рядом».`
  );
}

/** Agent-facing description of a board: what is on it and how to work with it. */
export function describeBoard(board: Board, base: string, collection: string): string {
  const live = board.elements.filter((element) => !element.isDeleted);
  const counts = new Map<string, number>();
  for (const element of live) counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  const texts = (items: Element[]) =>
    items
      .filter((element) => element.type === "text" && element.text && element.text.trim() !== "")
      .sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0) || (a.y ?? 0) - (b.y ?? 0))
      .map((element) => oneLine(element.text ?? "", 140));

  const frames = live
    .filter((element) => element.type === "frame")
    .sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0));
  const lines = [
    `Пользователь прикрепил доску ExcaliDash «${board.name}». Ниже её снимок на момент отправки сообщения.`,
    `id: ${board.id} · коллекция: ${collection} · версия: ${board.version} · изменена: ${board.updatedAt}`,
    `Редактор: ${base}/editor/${board.id}`,
    "",
    `На доске ${live.length} элементов (${[...counts].map(([type, n]) => `${type} ${n}`).join(", ") || "пусто"}), файлов ${Object.keys(board.files ?? {}).length}.`,
  ];
  for (const frame of frames) {
    const children = live.filter((element) => element.frameId === frame.id);
    const frameTexts = texts(children);
    lines.push("", `Фрейм «${frame.name ?? "без имени"}» (${children.length} элементов):`);
    for (const text of frameTexts.slice(0, MAX_TEXTS_PER_FRAME)) lines.push(`- ${text}`);
    if (frameTexts.length > MAX_TEXTS_PER_FRAME) {
      lines.push(`- …и ещё ${frameTexts.length - MAX_TEXTS_PER_FRAME} текстов`);
    }
  }
  const loose = texts(live.filter((element) => !element.frameId && element.type !== "frame"));
  if (loose.length > 0) {
    lines.push("", frames.length > 0 ? "Тексты вне фреймов:" : "Тексты на доске:");
    for (const text of loose.slice(0, MAX_TEXTS_PER_FRAME)) lines.push(`- ${text}`);
  }
  const embeds = live
    .filter((element) => (element.type === "embeddable" || element.type === "iframe") && element.link)
    .map((element) => element.link);
  if (embeds.length > 0) lines.push("", `Встроено: ${embeds.join(", ")}`);
  lines.push("", editingHint(board.id));
  const context = lines.join("\n");
  return context.length > MAX_CONTEXT_CHARS
    ? `${context.slice(0, MAX_CONTEXT_CHARS)}\n…(сводка обрезана; полную даст \`excalidash summary ${board.id}\`)`
    : context;
}

type BoardListing = { base: string; boards: { id: string; name: string; collection: string }[] };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    url: {
      type: "string",
      label: "ExcaliDash URL",
      description: "Адрес сервера ExcaliDash (http или https), где хранятся доски. Панели и @-упоминания берут доски отсюда.",
      default: DEFAULT_URL,
      experimental_schema: z
        .string()
        .refine((value) => excalidashBase(value) !== null, "Нужен адрес вида https://host:port"),
    },
    apiKey: {
      type: "string",
      label: "ExcaliDash API-ключ",
      description: "Ключ ExcaliDash (exd_…) с правом чтения досок и коллекций. Нужен, когда на сервере ExcaliDash включён вход.",
      secret: true,
    },
  });
  async function baseUrl(): Promise<string> {
    const base = excalidashBase((await settings.get()).url);
    if (base === null) throw new Error("В настройках плагина ExcaliDash указан адрес не http(s)");
    return base;
  }

  async function getJson<T>(url: string, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
    const apiKey = (await settings.get()).apiKey?.trim();
    const response = await fetch(url, {
      headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? ": задайте или проверьте настройку плагина apiKey" : "";
      throw new Error(`ExcaliDash ответил HTTP ${response.status} на ${url}${hint}`);
    }
    return schema.parse(await response.json());
  }

  async function collectionNames(base: string, timeoutMs: number): Promise<Map<string, string>> {
    const collections = await getJson(`${base}/api/collections`, z.array(collectionSchema), timeoutMs);
    return new Map(collections.map((collection) => [collection.id, collection.name]));
  }

  // One listing serves every keystroke for LIST_TTL_MS; a failed fetch is dropped
  // at once so the next keystroke retries.
  let listing: { at: number; value: Promise<BoardListing> } | null = null;
  async function loadListing(base: string): Promise<BoardListing> {
    // ExcaliDash's own ?search= is case-sensitive for Cyrillic, so filter here;
    // the list carries metadata only and stays small.
    const params = new URLSearchParams({ limit: "200", sortField: "updatedAt", sortDirection: "desc" });
    const [list, names] = await Promise.all([
      getJson(
        `${base}/api/drawings?${params}`,
        z.object({ drawings: z.array(boardSummarySchema) }),
        SEARCH_TIMEOUT_MS,
      ),
      collectionNames(base, SEARCH_TIMEOUT_MS),
    ]);
    const boards = list.drawings
      .filter((board) => board.collectionId !== "trash")
      .map((board) => ({
        id: board.id,
        name: board.name,
        collection: names.get(board.collectionId ?? "") ?? "",
      }));
    return { base, boards };
  }
  async function boardListing(): Promise<BoardListing> {
    const base = await baseUrl();
    const cached = listing && Date.now() - listing.at < LIST_TTL_MS ? await listing.value.catch(() => null) : null;
    if (cached?.base === base) return cached;
    const value = loadListing(base);
    listing = { at: Date.now(), value };
    value.catch(() => {
      if (listing?.value === value) listing = null;
    });
    return value;
  }

  bb.ui.registerMentionProvider({
    id: "board",
    label: "ExcaliDash",
    async search({ query }) {
      const { boards } = await boardListing();
      const wanted = query.trim().toLocaleLowerCase("ru");
      return boards
        .filter((board) => wanted === "" || `${board.name} ${board.collection}`.toLocaleLowerCase("ru").includes(wanted))
        .slice(0, 20)
        .map((board) => ({ id: board.id, title: board.name, subtitle: board.collection || "Без коллекции" }));
    },
    // Throwing here would block the user's message, so a failure still sends the
    // board id and link and leaves reading the board to the agent.
    async resolve(boardId) {
      let base = DEFAULT_URL;
      try {
        base = await baseUrl();
        const [board, names] = await Promise.all([
          getJson(`${base}/api/drawings/${encodeURIComponent(boardId)}`, boardSchema, RESOLVE_TIMEOUT_MS),
          collectionNames(base, RESOLVE_TIMEOUT_MS),
        ]);
        return { context: describeBoard(board, base, names.get(board.collectionId ?? "") ?? "без коллекции") };
      } catch (error) {
        bb.log.warn(`resolve ${boardId}: ${error instanceof Error ? error.message : String(error)}`);
        return {
          context: [
            `Пользователь прикрепил доску ExcaliDash (id ${boardId}), но снимок получить не удалось: ` +
              `${error instanceof Error ? error.message : String(error)}.`,
            `Редактор: ${base}/editor/${boardId}`,
            "",
            editingHint(boardId),
          ].join("\n"),
        };
      }
    },
  });
}
