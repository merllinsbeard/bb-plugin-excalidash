// Shared by the backend (server.ts) and the frontend (app.tsx): the ExcaliDash
// address check and the board id shape. The URL ends up in an iframe `src`, so
// anything but http(s) is refused on both sides.
export const DEFAULT_URL = "https://merlin-hermes.tail78400e.ts.net:9450";
export const BOARD_ID = /^[A-Za-z0-9-]{1,64}$/;

/** http(s) base URL without a trailing slash; the default for an empty value; null when unusable. */
export function excalidashBase(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  if (trimmed === "") return DEFAULT_URL;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "https:" || protocol === "http:" ? trimmed : null;
  } catch {
    return null;
  }
}
