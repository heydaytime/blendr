# Blendr

Synchronized watch parties for YouTube and Twitch. One admin broadcasts playback state from YouTube; viewers open a Blendr session link and stay in sync without screenshare.

Live services:

| Service | URL |
| --- | --- |
| Website | https://blendr.live |
| API | https://api.blendr.live |
| Chrome extension | Chrome Web Store ID `dhijdnhjdpoiegbagdcjgaokoljgdbno` |

## Repository Layout

```text
blendr/
├── apps/
│   ├── website/          # Next.js viewer app deployed by Vercel
│   ├── api/              # Bun WebSocket/API server deployed on GCP
│   └── admin-extension/  # Chrome MV3 admin broadcaster extension
├── docs/
│   ├── PROTOCOL.md       # HTTP/WebSocket protocol and session lifecycle
│   └── RUNBOOK.md        # Local dev, deploy, release, and operations
├── infra/
│   ├── caddy/            # Production reverse proxy config
│   └── systemd/          # Production API service unit
├── scripts/
│   ├── dev-local.sh
│   ├── start-api.sh
│   ├── deploy-api.sh
│   └── package-extension.sh
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
└── vercel.json
```

## How It Works

1. The admin opens a YouTube video and starts broadcasting from the Chrome extension.
2. The extension creates a session with `POST /api/session/create`, then connects as the authenticated admin over WebSocket.
3. The content script reads the YouTube `<video>` state and sends sync packets through the background service worker.
4. The API stores session state in memory, tracks session metadata in Redis, and broadcasts state to viewers.
5. Viewers open `https://blendr.live/watch?session=...`; the website connects as a read-only viewer and controls the YouTube IFrame player.

## Local Development

Prerequisites:

- Bun 1.1+
- Node.js 18+
- npm or pnpm
- Chrome for extension testing

Start the full local stack:

```bash
./scripts/dev-local.sh
```

Access points:

| Service | URL |
| --- | --- |
| Website | http://localhost:3000 |
| API | http://localhost:6767/api/session/create |
| WebSocket | ws://localhost:6767/ws |

Manual commands:

```bash
cd apps/api && bun run dev
cd apps/website && npm run dev
```

For extension testing, load `apps/admin-extension` as an unpacked extension in Chrome. `scripts/dev-local.sh` temporarily points `apps/admin-extension/config.js` at localhost and restores production config on exit.

## Production

- Website: Vercel builds `apps/website` using `vercel.json`.
- API: GCP VM `hdtrs`, Caddy on ports `80/443`, Bun bound to `127.0.0.1:6767`, Redis local on `127.0.0.1:6379`.
- Extension: packaged from `apps/admin-extension`; production endpoints must stay `https://api.blendr.live` and `wss://api.blendr.live`.

More detail:

- [docs/RUNBOOK.md](./docs/RUNBOOK.md)
- [docs/PROTOCOL.md](./docs/PROTOCOL.md)

## Checks

```bash
cd apps/api && bunx tsc --noEmit
cd apps/website && npm run build
./scripts/package-extension.sh
```

`package-extension.sh` queries the Chrome update endpoint and refuses to create `blendr-admin-extension.zip` unless `apps/admin-extension/manifest.json` is higher than the currently published version.
