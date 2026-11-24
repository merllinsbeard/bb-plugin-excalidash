# bb-plugin-excalidash

Boards from your self-hosted [ExcaliDash](https://github.com/zimengxiong/excalidash) server inside `bb`. Boards stay only in ExcaliDash; the plugin stores nothing.

- **ExcaliDash** in the sidebar: the ExcaliDash app itself (collections, search, history, editor). `/plugins/excalidash/boards/editor/<id>` opens one board.
- **ExcaliDash** in a thread's right panel (New tab → Actions): the same app beside the conversation.
- **`@` in the composer**: pick a board; at send time the agent gets its id, link, frames with their texts, and editing commands.
- **Reply card**: an agent reply with `::excalidash{board="<id>" title="…"}` renders a card that opens the board beside the thread.

## Install

```sh
bb plugin install git:https://github.com/merllinsbeard/bb-plugin-excalidash.git --yes
bb plugin config excalidash set url "https://your-excalidash-host:9450"
```

If your ExcaliDash server has authentication enabled, set a read-access API key (`exd_…`):

```sh
bb plugin config excalidash set apiKey "exd_..."
```

## How it works

The panels embed ExcaliDash in an iframe. Serving `bb` and ExcaliDash from the same host (for example, the same Tailscale hostname on different ports) lets ExcaliDash's `SameSite=Lax` cookies work inside the iframe without extra proxy headers.

## Develop

```sh
npm install
npm run typecheck
node --test --experimental-strip-types test/offline.test.ts
bb plugin build .
bb plugin install . --yes
```

## License

MIT
