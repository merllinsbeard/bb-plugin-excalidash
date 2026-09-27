// bb-plugin-excalidash — backend.
//
// Boards live only in our ExcaliDash server; this plugin stores nothing. The
// backend answers the composer's `@` menu: it lists boards over ExcaliDash's
// REST API and, when a message is sent, turns the picked board into an
// agent-only summary (frames, their texts, counts) plus the commands of the
// global `excalidash` skill, which is how agents read and edit boards.
// The panels that show ExcaliDash itself live in app.tsx.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_URL = "https://merlin-hermes.tail78400e.ts.net:9450";
const REQUEST_TIMEOUT_MS = 8_000;
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

export function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? DEFAULT_URL : trimmed;
}

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ExcaliDash ответил HTTP ${response.status} на ${url}`);
  }
  return schema.parse(await response.json());
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

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
  lines.push(
    "",
    `Читай и правь доску через скилл excalidash: \`excalidash get ${board.id} --out board.excalidraw\`, ` +
      `правка через scene.py, затем \`excalidash update ${board.id} board.excalidraw\` (открытые редакторы увидят правку сразу). ` +
      `Посмотреть доску или фрейм картинкой: \`excalidash shot ${board.id} --out /tmp/board.png [--frame "…"]\`.`,
  );
  const context = lines.join("\n");
  return context.length > MAX_CONTEXT_CHARS
    ? `${context.slice(0, MAX_CONTEXT_CHARS)}\n…(сводка обрезана; полную даст \`excalidash summary ${board.id}\`)`
    : context;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    url: {
      type: "string",
      label: "ExcaliDash URL",
      description: "Адрес сервера ExcaliDash, где хранятся доски. Панели и @-упоминания берут доски отсюда.",
      default: DEFAULT_URL,
    },
  });
  const baseUrl = async () => normalizeBaseUrl((await settings.get()).url);

  async function collectionNames(base: string): Promise<Map<string, string>> {
    const collections = await getJson(`${base}/api/collections`, z.array(collectionSchema));
    return new Map(collections.map((collection) => [collection.id, collection.name]));
  }

  bb.ui.registerMentionProvider({
    id: "board",
    label: "ExcaliDash",
    async search({ query }) {
      const base = await baseUrl();
      // ExcaliDash's own ?search= is case-sensitive for Cyrillic, so filter here;
      // the list carries metadata only and stays small.
      const params = new URLSearchParams({ limit: "200", sortField: "updatedAt", sortDirection: "desc" });
      const [list, names] = await Promise.all([
        getJson(`${base}/api/drawings?${params}`, z.object({ drawings: z.array(boardSummarySchema) })),
        collectionNames(base),
      ]);
      const wanted = query.trim().toLocaleLowerCase("ru");
      return list.drawings
        .filter((board) => board.collectionId !== "trash")
        .filter((board) => {
          const collection = names.get(board.collectionId ?? "") ?? "";
          return wanted === "" || `${board.name} ${collection}`.toLocaleLowerCase("ru").includes(wanted);
        })
        .slice(0, 20)
        .map((board) => ({
          id: board.id,
          title: board.name,
          subtitle: names.get(board.collectionId ?? "") ?? "Без коллекции",
        }));
    },
    async resolve(boardId) {
      const base = await baseUrl();
      const [board, names] = await Promise.all([
        getJson(`${base}/api/drawings/${encodeURIComponent(boardId)}`, boardSchema),
        collectionNames(base),
      ]);
      return { context: describeBoard(board, base, names.get(board.collectionId ?? "") ?? "без коллекции") };
    },
  });
}
