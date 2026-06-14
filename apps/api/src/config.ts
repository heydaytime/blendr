// Backend
export const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 6767;
export const BACKEND_HOST = process.env.BACKEND_HOST || "0.0.0.0";
export const BACKEND_URL = process.env.BACKEND_URL || "https://api.blendr.live";

// Frontend
export const FRONTEND_URL = process.env.FRONTEND_URL || "https://blendr.live";

// ============================================================================
// CORS / ORIGIN CONFIGURATION
// ============================================================================

// Which origins are allowed to connect to the backend.
// Options:
//   - "*" or not set: Allow any origin (default for local development)
//   - "https://blendr.live": Allow only this specific origin
//   - "https://blendr.live,https://www.blendr.live": Allow multiple origins (comma-separated)
//
// Default: "*" (allow all origins)
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*";

// ============================================================================
// SESSION CONFIGURATION
// ============================================================================

// How long (in milliseconds) a session stays alive after admin disconnects
// Default: 5 minutes (5 * 60 * 1000)
export const ADMIN_INACTIVE_TIMEOUT = Number(process.env.ADMIN_INACTIVE_TIMEOUT) || 5 * 60 * 1000;

// How often (in milliseconds) to sync state to all viewers in a session
// Default: 7 seconds
export const SYNC_INTERVAL = Number(process.env.SYNC_INTERVAL) || 7_000;

// How often (in milliseconds) to check for and cleanup inactive sessions
// Default: 30 seconds
export const SESSION_CLEANUP_INTERVAL = Number(process.env.SESSION_CLEANUP_INTERVAL) || 30_000;

// ============================================================================
// WEBSOCKET CONFIGURATION
// ============================================================================

// How often (in milliseconds) to ping connected clients
// Default: 30 seconds
export const WS_PING_INTERVAL = Number(process.env.WS_PING_INTERVAL) || 30_000;

// How long (in milliseconds) to wait for pong response before disconnecting
// Default: 90 seconds
export const WS_PONG_TIMEOUT = Number(process.env.WS_PONG_TIMEOUT) || 90_000;

// Maximum message size in bytes
// Default: 512 bytes
export const WS_MAX_MESSAGE_SIZE = Number(process.env.WS_MAX_MESSAGE_SIZE) || 512;

// Number of send failures before disconnecting a client
// Default: 3 failures
export const WS_SEND_FAILURE_THRESHOLD = Number(process.env.WS_SEND_FAILURE_THRESHOLD) || 3;

// ============================================================================
// REDIS CONFIGURATION
// ============================================================================

// Redis connection URL
// Default: "redis://localhost:6379" (no auth, local Redis)
// For production, set REDIS_URL environment variable
export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Redis key prefix for session data
// Default: "blendr:session"
export const REDIS_SESSION_PREFIX = process.env.REDIS_SESSION_PREFIX || "blendr:session";

// ============================================================================
// REDIS CONFIGURATION (Grouped style)
// ============================================================================

export const redis = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
} as const;

// Redis key patterns
export const REDIS_KEYS = {
  session: (id: string) => `${REDIS_SESSION_PREFIX}:${id}`,
} as const;
