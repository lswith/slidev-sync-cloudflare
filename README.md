# slidev-sync-cloudflare

A [Cloudflare Workers](https://workers.cloudflare.com/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) backend for [`slidev-addon-sync`](https://github.com/Smile-SA/slidev-addon-sync) — one-click deploy, drop-in compatible with the [`slidev-sync-server`](https://github.com/Smile-SA/slidev-sync-server) wire protocol.

Use this to **sync Slidev presenter ↔ slides ↔ notes across browsers, profiles, and devices** in your static-built decks. Slidev's built-in BroadcastChannel sync only works between tabs of the same browser session on the same device — this server replaces that with a real WebSocket / SSE backend, fanning state out to every connected client in a room.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lswith/slidev-sync-cloudflare)

Click the button, sign in to Cloudflare, give the Worker a name. You get a `https://<name>.<account>.workers.dev` URL — that's your sync server.

Runs on the **Workers free plan**: SQLite-backed Durable Objects (declared via `new_sqlite_classes`) are free-tier eligible, plus the standard 100k requests/day Worker quota. A single-presenter deployment with a handful of viewers is comfortably inside the free tier.

## Wire it into your Slidev deck

Install the client addon (this repo provides the **server**, not the client):

```bash
npm i slidev-addon-sync
```

Add it to your `slides.md` frontmatter:

```yaml
---
addons:
  - slidev-addon-sync
syncSettings:
  server: wss://<your-name>.<account>.workers.dev
  autoConnect: true
---
```

Build and serve your static deck as usual. Click the "connect" icon in the Slidev nav, type a long random room hash (or accept the proposed one), and share that hash with any tab or device you want kept in sync. Drive from any one, the rest follow.

See [`examples/slides.md`](./examples/slides.md) for a minimal working frontmatter.

## Security model

> [!IMPORTANT]
> By default the Worker is **open to any origin** — matching the upstream Node server. Before relying on it, restrict `ALLOWED_ORIGINS` to your slide host.

### Built-in protections

| Setting | Where | Default | Notes |
|---|---|---|---|
| `ALLOWED_ORIGINS` | `wrangler.jsonc` `vars` | `"*"` | Comma-separated list of allowed `Origin` header values (e.g. `https://talks.example.com,http://localhost:3030`). Connections from other origins get HTTP 403 before reaching the DO. **Set this** for any public deployment. |
| `MAX_GROUPS` | `src/room.ts` constant | `1000` | Cap on concurrently-tracked rooms per deployment. Blocks storage spam from non-browser clients that bypass `Origin` checks. |
| 3-day room GC | upstream protocol | always on | Inactive rooms get evicted three days after last update, matching `slidev-sync-server` behaviour. |

`Origin` is a browser-set header, so any non-browser client (curl, wscat) can forge it. **The room hash is the only real "secret"** — treat it like a password:

- Use the long random hash the addon proposes; don't shorten it.
- Don't share screenshots of your address bar mid-talk.
- The hash transits over WSS (TLS) on `*.workers.dev`, so the wire itself is encrypted.

### Stronger protection (when you need it)

For deployments where you can't trust the `Origin` header alone:

- **WAF rate limiting.** Cloudflare's free plan includes [basic rate-limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) — add one per IP, per minute, against your Worker's hostname.
- **Cloudflare Access** in front of the Worker. Adds SSO (Google, GitHub, etc.) so only authenticated devices can connect. **Caveat:** Access uses an authentication cookie, which the addon's WebSocket connection will only carry if the browser has already completed Access auth on that origin. This works fine on devices you control (presenter laptop, your phone) but is awkward for borrowed laptops — those devices need to complete an Access login first, in a normal browser tab, before the sync WebSocket can connect.

### What this repo deliberately does NOT do

- No per-room write secret, no bearer tokens. Real auth requires patching `slidev-addon-sync` — out of scope for v1 drop-in compatibility. If you need write-protection, use Cloudflare Access.
- No persisted room history. State is held in Durable Object storage for the 3-day GC window and gone after that.

## Configuration

After deploying, edit `wrangler.jsonc` and redeploy (`npm run deploy`) to tighten settings:

```jsonc
{
  "vars": {
    "ALLOWED_ORIGINS": "https://talks.example.com"
  }
}
```

Or set the variable in the Cloudflare dashboard (Workers → your Worker → Settings → Variables) — no redeploy needed.

## Architecture

```
┌────────────────┐    WSS / SSE    ┌─────────────────────────┐
│  Presenter tab │ ──────────────▶ │  Worker (origin check,  │
│  (slidev-addon-                  │   CORS, dispatch)       │
│   sync)        │                 └──────────┬──────────────┘
└────────────────┘                            │
                                              │ stub.fetch()
                                              ▼
┌────────────────┐                  ┌─────────────────────────┐
│  Notes tab     │ ◀──────────────  │  SyncRoom Durable       │
│  Audience tab  │   broadcast      │  Object (single named   │
└────────────────┘                  │  instance per Worker)   │
                                    │  • holds groups in mem  │
                                    │  • persists to SQLite   │
                                    │  • WS via Hibernation   │
                                    │  • SSE via stream       │
                                    └─────────────────────────┘
```

- One Durable Object instance (`idFromName("default")`) holds all rooms for the deployment. Matches upstream's single-process model and keeps the wire protocol identical to `slidev-sync-server`.
- WebSocket connections use Cloudflare's [Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocket-hibernation) — idle connections don't keep the DO alive, costs round to zero between talks.
- Room state is persisted to DO storage on every change so it survives DO restarts inside the 3-day GC window.

## Wire protocol

This Worker implements the same four-message protocol as upstream `slidev-sync-server`:

- `connect` — register a client into a room (`{ id, uid, states?, full? }`)
- `patch` — merge state into the room and broadcast (`{ id, uid, states, full? }`)
- `replace` — overwrite a state channel and broadcast (`{ id, uid, states }`)
- `reset` — wipe room state and broadcast empty (`{ id, uid }`)

Sent as JSON over WebSocket, or as `POST /<op>?uid=<uid>` with an open `GET /event?uid=<uid>` SSE stream for the read side. See [`src/protocol.ts`](./src/protocol.ts) for the type definitions.

## Local development

```bash
npm install
npm run dev       # wrangler dev — local server with hot reload
npm run typecheck # tsc --noEmit
npm run deploy    # wrangler deploy — push to your Cloudflare account
```

## Credits

- Wire protocol and original Node implementation: [`Smile-SA/slidev-sync-server`](https://github.com/Smile-SA/slidev-sync-server) (MIT)
- Client addon: [`Smile-SA/slidev-addon-sync`](https://github.com/Smile-SA/slidev-addon-sync) (MIT)
- This repo: ports the wire protocol to Cloudflare Workers + Durable Objects for one-click hosting.

## License

MIT. See [`LICENSE`](./LICENSE) — derivative work of `slidev-sync-server` (also MIT, Copyright Smile).
