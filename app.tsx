// bb-plugin-excalidash — frontend.
//
// Both surfaces show ExcaliDash itself in an iframe: its own editor, collections,
// history and live collaboration keep working, and nothing is copied into bb.
// This works because bb and ExcaliDash are served from the same host (same site),
// so ExcaliDash's SameSite=Lax cookies reach the frame, and ExcaliDash sends no
// frame-blocking headers on its pages.
//
// Agents point at a board with `::excalidash{board="<id>" title="…"}` in a reply;
// the card it renders opens that board in the thread's side panel.
import { definePluginApp, experimental_Icon as Icon, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import type {
  PluginMessageDirectiveProps,
  PluginNavPanelProps,
  PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { BOARD_ID, excalidashBase } from "./shared.ts";

type ExcalidashUrl = { state: "loading" } | { state: "invalid" } | { state: "ready"; base: string };

function useExcalidashUrl(): ExcalidashUrl {
  const { values, isLoading } = useSettings();
  if (isLoading) return { state: "loading" };
  const base = excalidashBase(values?.url);
  return base === null ? { state: "invalid" } : { state: "ready", base };
}

/** ExcaliDash page for a board id, or the dashboard when the id is missing or malformed. */
function pagePath(boardId: unknown): string {
  return typeof boardId === "string" && BOARD_ID.test(boardId) ? `/editor/${boardId}` : "/";
}

function ExcalidashFrame({ path }: { path: string }) {
  const url = useExcalidashUrl();
  if (url.state === "loading") return null;
  if (url.state === "invalid") {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
        В настройках плагина ExcaliDash указан адрес не http(s).
      </div>
    );
  }
  return (
    <iframe
      key={`${url.base}${path}`}
      src={`${url.base}${path}`}
      title="ExcaliDash"
      className="block h-full w-full border-0 bg-background"
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}

/** Sidebar page; `/plugins/excalidash/boards/editor/<id>` opens that board. */
function BoardsPage({ subPath }: PluginNavPanelProps) {
  const [section, boardId] = subPath.split("/");
  return (
    <div className="flex h-full min-h-0 flex-1">
      <ExcalidashFrame path={section === "editor" ? pagePath(boardId) : "/"} />
    </div>
  );
}

/** Tab beside a thread; `params.boardId` opens a board, otherwise the dashboard. */
function ThreadBoardPanel({ params }: PluginThreadPanelProps) {
  const boardId =
    params !== null && typeof params === "object" && !Array.isArray(params) ? params.boardId : undefined;
  return <ExcalidashFrame path={pagePath(boardId)} />;
}

/** Card for `::excalidash{board="<id>" title="…"}` in an agent reply. */
function BoardCard({ attributes, source }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const url = useExcalidashUrl();
  const boardId = attributes.board;
  if (typeof boardId !== "string" || !BOARD_ID.test(boardId)) return <span>{source}</span>;
  const title = attributes.title?.trim().slice(0, 120) || "Доска ExcaliDash";
  const openBeside = () => {
    if (!navigate.openThreadPanel({ actionId: "board", title, params: { boardId } })) {
      navigate.toPluginPanel("boards", { subPath: `editor/${boardId}` });
    }
  };
  return (
    <div className="my-2 flex max-w-xl items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <Icon name="PenTool" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium" title={title}>
        {title}
      </span>
      <button
        type="button"
        onClick={openBeside}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Открыть рядом
      </button>
      {url.state === "ready" ? (
        <a
          href={`${url.base}/editor/${boardId}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
        >
          В новой вкладке
        </a>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "boards",
    title: "ExcaliDash",
    icon: "PenTool",
    path: "boards",
    component: BoardsPage,
  });
  app.slots.threadPanelAction({
    id: "board",
    title: "ExcaliDash",
    icon: "PenTool",
    layout: "flush",
    component: ThreadBoardPanel,
  });
  app.slots.messageDirective({ id: "excalidash", component: BoardCard });
});
