# Blendr Protocol

This is the canonical API and WebSocket protocol for Blendr V1.

## HTTP

### Create Session

```http
POST /api/session/create
```

Response:

```json
{
  "sessionId": "a1b2c3d4e5f67890",
  "viewerUrl": "https://blendr.live/watch?session=a1b2c3d4e5f67890",
  "adminToken": "64 hex chars"
}
```

The API creates an in-memory session and an initial Redis record.

## WebSocket

Endpoint:

```text
/ws?session={sessionId}&role={admin|viewer}&token={adminToken}
```

Parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `session` | yes | Session ID returned by create-session |
| `role` | yes | `admin` or `viewer` |
| `token` | admin only | Must match the session admin token |

Invalid admin tokens return `403`. Missing sessions return `404`.

## Messages

### Admin to API: Sync

```json
{
  "type": "sync",
  "videoId": "dQw4w9WgXcQ",
  "timestamp": 30.5,
  "playing": true,
  "twitchId": "ninja",
  "twitchPosition": "bottom-right"
}
```

Accepted when `type === "sync"` and `videoId` is present. `twitchId` and `twitchPosition` are optional.

### Admin to API: Redirect

```json
{
  "type": "redirect",
  "redirectUrl": "https://www.twitch.tv/ninja/live"
}
```

The API immediately broadcasts redirects to viewers. Redirects do not mutate stored playback state.

### API to Viewer: Sync

```json
{
  "type": "sync",
  "videoId": "dQw4w9WgXcQ",
  "timestamp": 35.2,
  "playing": true,
  "twitchId": "ninja",
  "twitchPosition": "bottom-right"
}
```

The API broadcasts sync messages to viewers every `SYNC_INTERVAL` when a video is active. If playback is running, the API extrapolates timestamp from the last admin update.

### API to Viewer: Redirect

```json
{
  "type": "redirect",
  "redirectUrl": "https://www.twitch.tv/ninja/live"
}
```

The website navigates to `redirectUrl` immediately.

## Session Lifecycle

1. Session is created through HTTP.
2. Admin connects with a valid token.
3. Viewers connect without a token.
4. Admin sync packets update session state.
5. API broadcasts state to viewers.
6. If admin disconnects, the session remains alive for `ADMIN_INACTIVE_TIMEOUT`.
7. Cleanup destroys inactive sessions and closes connected sockets.

Only one admin can be connected per session. A new valid admin connection replaces the previous admin socket.

## Redis Record

Key:

```text
blendr:session:{sessionId}
```

Value:

```json
{
  "start_date": "2026-06-14T00:00:00.000Z",
  "end_date": null,
  "status": true,
  "visited_urls": [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  ]
}
```

Redis is best-effort for metadata. Live sync state is in process memory.

## Timing

| Setting | Default |
| --- | --- |
| Extension content sync interval | 1000 ms |
| API broadcast interval | 7000 ms |
| Viewer drift threshold | 1.5 seconds |
| API ping interval | 30000 ms |
| API pong timeout | 90000 ms |
| Max WebSocket message size | 512 bytes |
