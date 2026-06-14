import type { ServerWebSocket } from "bun";
import { SessionManager, type ClientData } from "./session";
import { isValidSync, isValidRedirect } from "./message";
import type { Message } from "./message";
import {
  BACKEND_URL as backendUrl,
  BACKEND_HOST as hostname,
  BACKEND_PORT as port,
  FRONTEND_URL as frontendUrl,
  ALLOWED_ORIGINS,
  WS_PING_INTERVAL,
  WS_PONG_TIMEOUT,
  WS_MAX_MESSAGE_SIZE,
} from "./config";

const sessionManager = new SessionManager();
const allSockets = new Set<ServerWebSocket<ClientData>>();
const lastPong = new Map<ServerWebSocket<ClientData>, number>();

// Parse allowed origins from config
const allowedOriginsList = ALLOWED_ORIGINS === "*" 
  ? null 
  : ALLOWED_ORIGINS.split(",").map(o => o.trim());

function isOriginAllowed(origin: string | null): boolean {
  // If no origin header, reject
  if (!origin) return false;
  
  // If allowing all origins
  if (allowedOriginsList === null) return true;
  
  // Check if origin is in allowed list
  return allowedOriginsList.includes(origin);
}

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowOrigin = allowedOriginsList === null 
    ? "*" 
    : (requestOrigin && allowedOriginsList.includes(requestOrigin) ? requestOrigin : "null");
    
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const server = Bun.serve<ClientData>({
  hostname,
  port,
  maxRequestBodySize: 4096,
  fetch(req, server) {
    const url = new URL(req.url);

    const requestOrigin = req.headers.get("origin");

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders(requestOrigin) });
    }

    if (url.pathname === "/api/session/create" && req.method === "POST") {
      const session = sessionManager.createSession();
      const body = JSON.stringify({
        sessionId: session.id,
        viewerUrl: `${frontendUrl}/watch?session=${session.id}`,
        adminToken: session.adminToken,
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(requestOrigin) },
      });
    }

    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session");
      if (!sessionId) {
        return new Response("Session ID required", { status: 400 });
      }

      const role = url.searchParams.get("role");
      if (role !== "admin" && role !== "viewer") {
        return new Response("Role must be 'admin' or 'viewer'", {
          status: 400,
        });
      }

      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      // Verify admin token for admin connections
      if (role === "admin") {
        const token = url.searchParams.get("token");
        if (!token || token !== session.adminToken) {
          console.log(`[WS] Rejected admin connection to session ${sessionId}: invalid token`);
          return new Response("Invalid admin token", {
            status: 403,
            headers: corsHeaders(requestOrigin),
          });
        }
      }

      // Check origin if restrictions are configured
      if (allowedOriginsList !== null && !isOriginAllowed(requestOrigin)) {
        console.log(`[WS] Rejected connection from origin: ${requestOrigin}`);
        return new Response("Invalid origin", {
          status: 403,
          headers: corsHeaders(requestOrigin),
        });
      }

      const remoteAddr = server.requestIP(req)?.address ?? "unknown";

      const success = server.upgrade(req, {
        data: {
          sessionId,
          isAdmin: role === "admin",
          id: remoteAddr,
        },
      });

      if (success) {
        console.log(
          `[WS] ${role} connected to session ${sessionId} from ${remoteAddr}`,
        );
        return undefined as any;
      }

      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(requestOrigin) });
  },
  websocket: {
    open(ws) {
      allSockets.add(ws);
      lastPong.set(ws, Date.now());
      ws.data.sendFailures = 0;

      const session = sessionManager.getSession(ws.data.sessionId);
      if (!session) {
        ws.close(1011, "Session not found");
        return;
      }
      session.register(ws);
    },
    message(ws, message) {
      const session = sessionManager.getSession(ws.data.sessionId);
      if (!session) return;

      const size =
        typeof message === "string"
          ? Buffer.byteLength(message, "utf8")
          : message.length;
      if (size > WS_MAX_MESSAGE_SIZE) {
        ws.close(1009, "Message too large");
        return;
      }

      if (!ws.data.isAdmin) {
        try {
          const msg = JSON.parse(message.toString()) as Message;
          console.log(
            `[SESSION ${session.id}] Viewer message (ignored): ${msg.type}`,
          );
        } catch {
          console.log(`[SESSION ${session.id}] Viewer message (ignored)`);
        }
        return;
      }

      let msg: Message;
      try {
        msg = JSON.parse(message.toString()) as Message;
      } catch (err) {
        console.log(`error parsing message: ${err}`);
        return;
      }

      const videoId = msg.videoId ?? "";
      const twitchId = msg.twitchId ?? "";
      const ts = msg.timestamp?.toFixed(2) ?? "0.00";
      const playing = msg.playing ?? false;

       // Intentionally no logging here: admin packets can arrive very frequently
       // and will spam logs under normal operation.

      if (isValidRedirect(msg)) {
        const viewerCount = session.broadcastToViewers(JSON.stringify(msg));
        console.log(
          `[SESSION ${session.id}] Redirect broadcast to ${viewerCount} viewers: ${msg.redirectUrl}`,
        );
        return;
      }

      if (isValidSync(msg)) {
        session.updateState(msg);
      }
    },
    close(ws, code, reason) {
      allSockets.delete(ws);
      lastPong.delete(ws);

      const session = sessionManager.getSession(ws.data.sessionId);
      if (session) {
        session.unregister(ws);
      }
    },
    pong(ws, data) {
      lastPong.set(ws, Date.now());
    },
    drain(ws) {
      // Backpressure cleared; ready to send again
    },
  },
});

setInterval(() => {
  const now = Date.now();
  for (const ws of allSockets) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const last = lastPong.get(ws) ?? 0;
    if (now - last > WS_PONG_TIMEOUT) {
      ws.close(1001, "Keepalive timeout");
    } else {
      ws.ping();
    }
  }
}, WS_PING_INTERVAL);

console.log(`[SERVER] Starting on ${hostname}:${port}`);
console.log(`[SERVER] API: POST ${backendUrl}/api/session/create`);
console.log(
  `[SERVER] WebSocket: ${backendUrl.replace(/^http/, "ws")}/ws?session=xxx&role=admin|viewer`,
);
console.log(
  `[SERVER] CORS: ${allowedOriginsList === null ? "allow all origins" : "restricted"} (allowed: ${ALLOWED_ORIGINS})`,
);
