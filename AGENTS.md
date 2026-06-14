# Agent Instructions

This repo powers Blendr: a Chrome admin extension, a Bun WebSocket API, and a Vercel viewer website.

## Hard Rules

- Never force push.
- Never commit unless the user explicitly asks for a commit.
- Never create `blendr-admin-extension.zip` manually.
- Before creating `blendr-admin-extension.zip`, check the currently published Chrome Web Store version for extension ID `dhijdnhjdpoiegbagdcjgaokoljgdbno` and bump `apps/admin-extension/manifest.json` above it.
- Production endpoints must remain:
  - API HTTP: `https://api.blendr.live`
  - API WebSocket: `wss://api.blendr.live`
  - Website: `https://blendr.live`
- Do not expose Bun port `6767` publicly in production. Public traffic goes through Caddy on `443`.

## Repo Layout

```text
apps/website          Next.js viewer app deployed by Vercel
apps/api              Bun API/WebSocket server deployed on GCP
apps/admin-extension  Chrome MV3 admin broadcaster extension
docs/                 Protocol and operations documentation
infra/                Caddy and systemd reference config
scripts/              Local dev, deploy, and release helpers
```

## Runtime Model

- The extension creates sessions with `POST /api/session/create`.
- The extension connects as admin with `/ws?session=...&role=admin&token=...`.
- Viewers connect with `/ws?session=...&role=viewer`.
- Admin sync packets are the source of truth for current YouTube state.
- The API keeps live state in memory and writes session metadata to Redis.
- The website is read-only and controls a YouTube IFrame player from sync packets.

## Checks Before Risky Changes

Run the relevant checks before reporting completion:

```bash
cd apps/api && bunx tsc --noEmit
cd apps/website && npm run build
rg -n "blendr-api\\.heydaytime\\.net|localhost:8080" apps docs infra scripts README.md vercel.json
```

When packaging the extension:

```bash
./scripts/package-extension.sh
unzip -p blendr-admin-extension.zip manifest.json
unzip -p blendr-admin-extension.zip config.js
```

## Deployment Notes

- Vercel builds `apps/website` from `vercel.json`.
- API deployment target is `hdtrs`.
- API production env lives at `/etc/blendr/backend.env`.
- API logs are in journald:

```bash
journalctl -u blendr-backend -f
```

## Code Guidance

- Keep the WebSocket protocol compatible unless the user explicitly asks for a protocol migration.
- Avoid broad refactors in the extension unless manually testing the extension is part of the task.
- Keep extension files unbundled unless the release workflow is explicitly changed.
- Prefer small, behavior-preserving moves before logic cleanup.
- Do not remove Twitch overlay or redirect behavior; both are active product features.
- If a change affects session links, admin tokens, or Chrome permissions, call it out clearly.
