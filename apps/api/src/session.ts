import type { ServerWebSocket } from "bun";
import type { Message } from "./message";
import {
  ADMIN_INACTIVE_TIMEOUT,
  SYNC_INTERVAL,
  SESSION_CLEANUP_INTERVAL,
  WS_SEND_FAILURE_THRESHOLD,
  redis,
  REDIS_KEYS,
} from "./config";

// Initialize Redis client
const redisClient = new Bun.RedisClient(redis.url);

export interface ClientData {
  sessionId: string;
  isAdmin: boolean;
  id: string;
  sendFailures?: number;
}

// Helper to construct YouTube URL from video ID
function getYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

interface SessionData {
  start_date: string;
  end_date: string | null;
  status: boolean;
  visited_urls: string[];
}

export class Session {
  id: string;
  adminToken: string;
  clients: Set<ServerWebSocket<ClientData>>;
  admin: ServerWebSocket<ClientData> | null = null;
  adminDisconnectTime: number | null = null;
  state: {
    videoId: string;
    timestamp: number;
    playing: boolean;
    twitchId: string;
    twitchPosition: string;
    lastUpdate: number;
  };
  createdAt: number;
  syncInterval: Timer;
  visitedUrls: Set<string> = new Set();

  constructor(id: string) {
    this.id = id;
    this.adminToken = generateAdminToken();
    this.clients = new Set();
    this.state = {
      videoId: "",
      timestamp: 0,
      playing: false,
      twitchId: "",
      twitchPosition: "",
      lastUpdate: 0,
    };
    this.createdAt = Date.now();
    this.syncInterval = setInterval(() => this.broadcastSync(), SYNC_INTERVAL);
    
    // Create initial Redis entry
    this.createRedisEntry();
  }

  private async createRedisEntry() {
    const sessionData: SessionData = {
      start_date: new Date().toISOString(),
      end_date: null,
      status: true,
      visited_urls: [],
    };
    
    try {
      await redisClient.set(REDIS_KEYS.session(this.id), JSON.stringify(sessionData));
      console.log(`[REDIS] Created session entry: ${this.id}`);
    } catch (err) {
      console.error(`[REDIS] Failed to create session entry: ${err}`);
    }
  }

  private async updateRedisEntry() {
    const sessionData: SessionData = {
      start_date: new Date(this.createdAt).toISOString(),
      end_date: this.adminDisconnectTime ? new Date(this.adminDisconnectTime).toISOString() : null,
      status: this.admin !== null,
      visited_urls: Array.from(this.visitedUrls),
    };
    
    try {
      await redisClient.set(REDIS_KEYS.session(this.id), JSON.stringify(sessionData));
    } catch (err) {
      console.error(`[REDIS] Failed to update session entry: ${err}`);
    }
  }

  register(ws: ServerWebSocket<ClientData>) {
    this.clients.add(ws);

    if (ws.data.isAdmin) {
      if (this.admin && this.admin !== ws) {
        console.log(`[SESSION ${this.id}] New admin replacing old`);
        try {
          this.admin.close(1000, "Replaced by new admin");
        } catch {
          // already closed
        }
      }
      this.admin = ws;
      this.adminDisconnectTime = null; // Clear disconnect time when admin reconnects
      console.log(`[SESSION ${this.id}] Admin connected from ${ws.data.id}`);
    } else {
      console.log(
        `[SESSION ${this.id}] Viewer connected from ${ws.data.id} (total: ${this.clients.size})`,
      );
    }

    const stateMsg: Message = {
      type: "sync",
      videoId: this.state.videoId,
      timestamp: this.state.timestamp,
      playing: this.state.playing,
      twitchId: this.state.twitchId,
      twitchPosition: this.state.twitchPosition,
    };

    if (ws.readyState === WebSocket.OPEN) {
      const ok = ws.send(JSON.stringify(stateMsg));
      if (ok) {
        ws.data.sendFailures = 0;
      } else {
        ws.data.sendFailures = (ws.data.sendFailures ?? 0) + 1;
        if (ws.data.sendFailures >= WS_SEND_FAILURE_THRESHOLD) {
          ws.close(1011, "Send failed");
        }
      }
    }
  }

  unregister(ws: ServerWebSocket<ClientData>) {
    if (!this.clients.has(ws)) return;
    this.clients.delete(ws);

    if (this.admin === ws) {
      this.admin = null;
      this.adminDisconnectTime = Date.now(); // Mark when admin disconnected
      console.log(`[SESSION ${this.id}] Admin disconnected`);
      // Update Redis to mark session as closed
      this.updateRedisEntry();
    } else {
      console.log(`[SESSION ${this.id}] Viewer disconnected`);
    }
  }

  broadcastSync() {
    if (this.state.videoId === "") return;

    const now = Date.now();
    let expectedTimestamp = this.state.timestamp;
    if (this.state.playing && this.state.lastUpdate > 0) {
      const elapsed = (now - this.state.lastUpdate) / 1000;
      expectedTimestamp = this.state.timestamp + elapsed;
    }

    const stateMsg: Message = {
      type: "sync",
      videoId: this.state.videoId,
      timestamp: expectedTimestamp,
      playing: this.state.playing,
      twitchId: this.state.twitchId,
      twitchPosition: this.state.twitchPosition,
    };
    const data = JSON.stringify(stateMsg);

    const dead: ServerWebSocket<ClientData>[] = [];
    let viewerCount = 0;
    for (const client of this.clients) {
      if (client.data.isAdmin) continue;
      if (client.readyState === WebSocket.OPEN) {
        const ok = client.send(data);
        if (ok) {
          viewerCount++;
          client.data.sendFailures = 0;
        } else {
          client.data.sendFailures = (client.data.sendFailures ?? 0) + 1;
          if (client.data.sendFailures >= WS_SEND_FAILURE_THRESHOLD) {
            dead.push(client);
          }
        }
      } else {
        dead.push(client);
      }
    }
    for (const client of dead) {
      try {
        client.close(1011, "Send failed");
      } catch {
        // ignore
      }
      this.clients.delete(client);
      if (this.admin === client) this.admin = null;
    }

    // Intentionally no logging here: this runs on a fixed interval and was
    // generating high-volume heartbeat logs.
  }

  broadcastToViewers(data: string) {
    const dead: ServerWebSocket<ClientData>[] = [];
    let viewerCount = 0;
    for (const client of this.clients) {
      if (client.data.isAdmin) continue;
      if (client.readyState === WebSocket.OPEN) {
        const ok = client.send(data);
        if (ok) {
          viewerCount++;
          client.data.sendFailures = 0;
        } else {
          client.data.sendFailures = (client.data.sendFailures ?? 0) + 1;
          if (client.data.sendFailures >= WS_SEND_FAILURE_THRESHOLD) {
            dead.push(client);
          }
        }
      } else {
        dead.push(client);
      }
    }
    for (const client of dead) {
      try {
        client.close(1011, "Send failed");
      } catch {
        // ignore
      }
      this.clients.delete(client);
      if (this.admin === client) this.admin = null;
    }
    return viewerCount;
  }

  updateState(msg: Message) {
    const oldVideoId = this.state.videoId;
    this.state.videoId = msg.videoId ?? "";
    this.state.timestamp = msg.timestamp ?? 0;
    this.state.playing = msg.playing ?? false;
    this.state.twitchId = msg.twitchId ?? "";
    this.state.twitchPosition = msg.twitchPosition ?? "";
    this.state.lastUpdate = Date.now();
    
    // Track visited URLs when video changes
    if (this.state.videoId && this.state.videoId !== oldVideoId) {
      const youtubeUrl = getYouTubeUrl(this.state.videoId);
      this.visitedUrls.add(youtubeUrl);
      this.updateRedisEntry();
      console.log(`[REDIS] Added URL to session ${this.id}: ${youtubeUrl}`);
    }
  }

  destroy() {
    clearInterval(this.syncInterval);
    for (const client of this.clients) {
      client.close(1001, "Session destroyed");
    }
    this.clients.clear();
    
    // Update Redis to mark session as closed
    const sessionData: SessionData = {
      start_date: new Date(this.createdAt).toISOString(),
      end_date: new Date().toISOString(),
      status: false,
      visited_urls: Array.from(this.visitedUrls),
    };
    
    redisClient.set(REDIS_KEYS.session(this.id), JSON.stringify(sessionData))
      .then(() => console.log(`[REDIS] Closed session entry: ${this.id}`))
      .catch((err) => console.error(`[REDIS] Failed to close session entry: ${err}`));
  }

  isAdminInactive(): boolean {
    // If admin is connected, session is active
    if (this.admin !== null) return false;
    // If admin was connected and disconnected, check timeout from disconnect
    if (this.adminDisconnectTime !== null) {
      return Date.now() - this.adminDisconnectTime > ADMIN_INACTIVE_TIMEOUT;
    }
    // Admin never connected — check timeout from session creation
    return Date.now() - this.createdAt > ADMIN_INACTIVE_TIMEOUT;
  }
}

export class SessionManager {
  sessions = new Map<string, Session>();
  cleanupInterval: Timer;

  constructor() {
    // Check for inactive sessions periodically
    this.cleanupInterval = setInterval(() => this.cleanupInactiveSessions(), SESSION_CLEANUP_INTERVAL);
  }

  createSession(): Session {
    const id = generateSessionID();
    const session = new Session(id);
    this.sessions.set(id, session);
    console.log(`[SESSION] Created new session: ${id}`);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  deleteSession(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.destroy();
      this.sessions.delete(id);
      console.log(`[SESSION] Deleted session: ${id}`);
    }
  }

  cleanupInactiveSessions() {
    const now = Date.now();
    const sessionsToDelete: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.isAdminInactive()) {
        const since = session.adminDisconnectTime ?? session.createdAt;
        const inactiveFor = Math.floor((now - since) / 1000);
        console.log(`[SESSION] Session ${id} admin inactive for ${inactiveFor}s, destroying...`);
        sessionsToDelete.push(id);
      }
    }

    for (const id of sessionsToDelete) {
      this.deleteSession(id);
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    for (const [id, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();
  }
}

function generateSessionID(): string {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Date.now().toString(36);
  }
}

function generateAdminToken(): string {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}
