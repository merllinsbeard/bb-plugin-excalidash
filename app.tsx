// bb-plugin-excalidash — frontend.
//
// Both surfaces show ExcaliDash itself in an iframe: its own editor, collections,
// history and live collaboration keep working, and nothing is copied into bb.
// This works because bb and ExcaliDash are served from the same host (same site),
// so ExcaliDash's SameSite=Lax cookies reach the frame, and ExcaliDash sends no
// frame-blocking headers on its pages.
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";

const DEFAULT_URL = "https://merlin-hermes.tail78400e.ts.net:9450";
const BOARD_ID = /^[A-Za-z0-9-]{1,64}$/;

function useExcalidashUrl(): string | null {
  const { values, isLoading } = useSettings();
  if (isLoading) return null;
  const url = values?.url;
  const raw = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  return raw === "" ? DEFAULT_URL : raw;
}

/** ExcaliDash page for a board id, or the dashboard when the id is missing or malformed. */
function pagePath(boardId: unknown): string {
  return typeof boardId === "string" && BOARD_ID.test(boardId) ? `/editor/${boardId}` : "/";
}

function ExcalidashFrame({ path }: { path: string }) {
  const base = useExcalidashUrl();
  if (base === null) return null;
  return (
    <iframe
      key={`${base}${path}`}
      src={`${base}${path}`}
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
});
