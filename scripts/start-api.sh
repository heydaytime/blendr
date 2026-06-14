#!/bin/bash

# Start only the Blendr API with .env loaded
# Usage: ./scripts/start-api.sh

set -e

# Load environment variables from root .env
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

cd apps/api

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    bun install
fi

# Start backend in foreground (logs go to stdout)
exec bun run src/index.ts
