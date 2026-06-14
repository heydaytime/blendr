#!/bin/bash

# Start all Blendr services for LOCAL testing
# This script:
#   1. Switches the Chrome extension config to localhost
#   2. Starts the backend (Bun, port 6767)
#   3. Starts the frontend (Next.js, port 3000)
#   4. Restores extension config to production on exit
#
# Usage: ./scripts/dev-local.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/api"
FRONTEND_DIR="$ROOT_DIR/apps/website"
EXTENSION_DIR="$ROOT_DIR/apps/admin-extension"
EXTENSION_CONFIG="$EXTENSION_DIR/config.js"

LOCAL_BACKEND_PORT=6767
LOCAL_FRONTEND_PORT=3000
LOCAL_BACKEND_URL="http://localhost:$LOCAL_BACKEND_PORT"
LOCAL_BACKEND_WS_URL="ws://localhost:$LOCAL_BACKEND_PORT"
LOCAL_FRONTEND_URL="http://localhost:$LOCAL_FRONTEND_PORT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

BACKEND_PID=""
FRONTEND_PID=""

# ── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"

    [ -n "$BACKEND_PID" ]  && kill $BACKEND_PID  2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null || true

    # Restore extension config to production
    cat > "$EXTENSION_CONFIG" << 'PROD_EOF'
// Blendr Admin Extension - Configuration
// Centralized config for backend URL and other settings

// export const BACKEND_URL = 'http://localhost:6767';
// export const BACKEND_WS_URL = 'ws://localhost:6767';

// For production, these would be:
export const BACKEND_URL = "https://api.blendr.live";
export const BACKEND_WS_URL = "wss://api.blendr.live";
PROD_EOF

    echo -e "${GREEN}✓ Extension config restored to production${NC}"
    echo -e "${GREEN}Done.${NC}"
    exit 0
}

trap cleanup INT TERM EXIT

# ── Check ports ──────────────────────────────────────────────────────────────
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}Port $1 is already in use. Kill it first:${NC}"
        echo "  lsof -ti:$1 | xargs kill -9"
        exit 1
    fi
}

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}   Blendr Local Development Environment   ${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

echo "Checking ports..."
check_port $LOCAL_BACKEND_PORT
check_port $LOCAL_FRONTEND_PORT
echo -e "${GREEN}✓ Ports $LOCAL_BACKEND_PORT and $LOCAL_FRONTEND_PORT are free${NC}"
echo ""

# ── Step 1: Switch extension config to local ─────────────────────────────────
echo -e "${YELLOW}[1/3] Switching extension config to localhost...${NC}"

cat > "$EXTENSION_CONFIG" << LOCAL_EOF
// Blendr Admin Extension - Configuration
// Centralized config for backend URL and other settings

// LOCAL DEV MODE (auto-set by scripts/dev-local.sh)
export const BACKEND_URL = 'http://localhost:$LOCAL_BACKEND_PORT';
export const BACKEND_WS_URL = 'ws://localhost:$LOCAL_BACKEND_PORT';
LOCAL_EOF

echo -e "${GREEN}✓ Extension config now points to localhost:$LOCAL_BACKEND_PORT${NC}"
echo -e "${YELLOW}  → Reload the extension in chrome://extensions/ to pick up the change${NC}"
echo ""

# ── Step 2: Start Backend ────────────────────────────────────────────────────
echo -e "${YELLOW}[2/3] Starting backend on port $LOCAL_BACKEND_PORT...${NC}"

cd "$BACKEND_DIR"
if [ ! -d "node_modules" ]; then
    echo "  Installing backend dependencies..."
    bun install
fi

BACKEND_PORT=$LOCAL_BACKEND_PORT \
BACKEND_URL=$LOCAL_BACKEND_URL \
FRONTEND_URL=$LOCAL_FRONTEND_URL \
ALLOWED_ORIGINS="*" \
bun run src/index.ts > "$ROOT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

sleep 2

if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}Backend failed to start. Check backend.log${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Backend running (PID $BACKEND_PID)${NC}"
echo ""

# ── Step 3: Start Frontend ───────────────────────────────────────────────────
echo -e "${YELLOW}[3/3] Starting frontend on port $LOCAL_FRONTEND_PORT...${NC}"

cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    echo "  Installing frontend dependencies..."
    npm install
fi

NEXT_PUBLIC_BACKEND_URL=$LOCAL_BACKEND_URL \
NEXT_PUBLIC_FRONTEND_URL=$LOCAL_FRONTEND_URL \
npm run dev > "$ROOT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

sleep 5

if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${RED}Frontend failed to start. Check frontend.log${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Frontend running (PID $FRONTEND_PID)${NC}"
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  All services running!${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""
echo "  Backend API:   $LOCAL_BACKEND_URL/api/session/create"
echo "  Backend WS:    $LOCAL_BACKEND_WS_URL/ws?session=xxx&role=admin|viewer"
echo "  Frontend:      $LOCAL_FRONTEND_URL"
echo ""
echo "  Logs:"
    echo "    backend.log   ->  tail -f $ROOT_DIR/backend.log"
    echo "    frontend.log  ->  tail -f $ROOT_DIR/frontend.log"
echo ""
echo -e "${CYAN}── How to test the Redirect feature ──${NC}"
echo ""
echo "  1. Go to chrome://extensions/ and reload the Blendr Admin extension"
echo "  2. Open a YouTube video in Chrome"
echo "  3. Click the Blendr extension icon → Start Broadcasting"
echo "  4. Copy the viewer link and open it in another browser/tab"
echo "     (it will be something like $LOCAL_FRONTEND_URL/watch?session=...)"
echo "  5. In the extension popup, enter a Twitch channel in the Twitch ID field"
echo "  6. Click \"Redirect Users to Twitch\""
echo "  7. The viewer tab should navigate to twitch.tv/<channel>"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services and restore prod config${NC}"
echo ""

wait
