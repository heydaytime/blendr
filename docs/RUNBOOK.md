# Blendr Runbook

Operational steps for local development, deployment, and releases.

## Environment

### API (`apps/api`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_HOST` | `0.0.0.0` | Bind interface for Bun |
| `BACKEND_PORT` | `6767` | Bun listen port |
| `BACKEND_URL` | `https://api.blendr.live` | Public API URL used in logs |
| `FRONTEND_URL` | `https://blendr.live` | Used to generate viewer links |
| `ALLOWED_ORIGINS` | `*` | CORS and WebSocket origin policy |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REDIS_SESSION_PREFIX` | `blendr:session` | Redis key prefix |

Production `/etc/blendr/backend.env`:

```env
BACKEND_HOST=127.0.0.1
BACKEND_PORT=6767
BACKEND_URL=https://api.blendr.live
FRONTEND_URL=https://blendr.live
ALLOWED_ORIGINS=*
REDIS_URL=redis://127.0.0.1:6379
```

### Website (`apps/website`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_BACKEND_URL` | `https://api.blendr.live` | API and WebSocket base URL |
| `NEXT_PUBLIC_FRONTEND_URL` | `https://blendr.live` | YouTube player origin |

For local dev:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:6767
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
```

### Extension (`apps/admin-extension`)

Production config in `config.js`:

```js
export const BACKEND_URL = "https://api.blendr.live";
export const BACKEND_WS_URL = "wss://api.blendr.live";
```

## Local Development

Run everything:

```bash
./scripts/dev-local.sh
```

Manual API:

```bash
cd apps/api
bun install
bun run dev
```

Manual website:

```bash
cd apps/website
npm install
npm run dev
```

Load the extension from `apps/admin-extension` in `chrome://extensions`.

## API Deployment

Production target:

- Host: `hdtrs`
- Public API: `https://api.blendr.live`
- Reverse proxy: Caddy
- Bun listens on `127.0.0.1:6767`
- Redis listens on `127.0.0.1:6379`

Deploy API code:

```bash
./scripts/deploy-api.sh
```

Useful remote commands:

```bash
ssh hdtrs 'sudo systemctl status blendr-backend --no-pager'
ssh hdtrs 'journalctl -u blendr-backend -f'
ssh hdtrs 'redis-cli ping'
```

Firewall:

- Open TCP `80` and `443`.
- Do not open TCP `6767` publicly.

## Website Deployment

Vercel is connected to the GitHub repo and builds `apps/website` using `vercel.json`.

Required Vercel production env, if configured:

```env
NEXT_PUBLIC_BACKEND_URL=https://api.blendr.live
NEXT_PUBLIC_FRONTEND_URL=https://blendr.live
```

After deploy, verify the live bundle does not contain the old API host:

```bash
curl -fsSL 'https://blendr.live/watch?session=test' | grep '_next/static'
```

## Extension Release

Never create `blendr-admin-extension.zip` manually.

```bash
./scripts/package-extension.sh
```

The script checks the published Chrome Web Store version for extension ID `dhijdnhjdpoiegbagdcjgaokoljgdbno` and fails unless `apps/admin-extension/manifest.json` is higher.

Upload `blendr-admin-extension.zip` to Chrome Web Store.

## Smoke Tests

API:

```bash
curl -X POST https://api.blendr.live/api/session/create
```

WebSocket:

1. Create a session.
2. Connect viewer to `wss://api.blendr.live/ws?session=...&role=viewer`.
3. Connect admin to `wss://api.blendr.live/ws?session=...&role=admin&token=...`.
4. Send a sync packet from admin.
5. Confirm viewer receives a sync packet.

Website:

```bash
cd apps/website
npm run build
```

API typecheck:

```bash
cd apps/api
bunx tsc --noEmit
```
