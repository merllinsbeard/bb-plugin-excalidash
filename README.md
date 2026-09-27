# bb-plugin-excalidash

Boards from our ExcaliDash server (https://merlin-hermes.tail78400e.ts.net:9450) inside bb. Boards stay only in ExcaliDash; the plugin stores nothing.

- **ExcaliDash** in the sidebar: the ExcaliDash app itself (collections, search, history, its editor). `/plugins/excalidash/boards/editor/<id>` opens one board.
- **ExcaliDash** in a thread's right panel (New tab → Actions): the same app beside the conversation.
- **`@` in the composer**: pick a board; at send time the agent gets its id, link, frames with their texts and the `excalidash` skill commands to edit it.

Setting: `url` (ExcaliDash address), `bb plugin config excalidash set url <url>`.

## How it works

The panels are an iframe of ExcaliDash. That works because bb and ExcaliDash are served from the same host (same site), so ExcaliDash's SameSite=Lax cookies reach the frame, and ExcaliDash sends no frame-blocking headers on its HTML pages. If ExcaliDash moves to another host or starts sending `frame-ancestors`, the panels stop loading.

Agents edit boards with the global `excalidash` skill (`~/.agents/skills/excalidash`). Its `update` and `restore` broadcast the saved scene into the board's socket.io room, so open editors (in bb or a browser) show agent edits without a reload.

## Develop

```sh
npm install
npm run typecheck
npm test          # integration test against the live ExcaliDash: creates and deletes a temporary board
bb plugin build .
bb plugin install . --yes
```
