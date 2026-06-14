"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface SyncMessage {
  type: "sync" | "state" | "redirect";
  videoId: string;
  timestamp: number;
  playing: boolean;
  twitchId?: string;
  twitchPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  redirectUrl?: string;
  target?: string;
}

interface UseWebSocketProps {
  url: string;
  onMessage: (message: SyncMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  maxReconnectAttempts?: number;
}

export function useWebSocket({ url, onMessage, onConnect, onDisconnect, maxReconnectAttempts = 10 }: UseWebSocketProps) {
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [hasExceededMaxAttempts, setHasExceededMaxAttempts] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const baseReconnectDelay = 1000;

  // Use refs for callbacks to avoid dependency issues
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
  }, [onDisconnect]);

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      // Remove listeners before closing to prevent reconnection triggers
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      console.log("[WS] Connection already in progress, skipping...");
      return;
    }

    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log("[WS] Max reconnection attempts reached, giving up");
      setConnectionState("disconnected");
      setHasExceededMaxAttempts(true);
      return;
    }

    isConnectingRef.current = true;
    console.log("[WS] Connecting to", url, "(attempt", reconnectAttemptsRef.current + 1, "/", maxReconnectAttempts, ")");
    setConnectionState("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected successfully");
        reconnectAttemptsRef.current = 0;
        isConnectingRef.current = false;
        setConnectionState("connected");
        onConnectRef.current?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[WS] RECV:", message);
          setLastMessageTime(Date.now());
          onMessageRef.current(message);
        } catch (error) {
          console.error("[WS] Failed to parse message:", error);
        }
      };

      ws.onclose = (event) => {
        console.log("[WS] Connection closed (code:", event.code, ")");
        isConnectingRef.current = false;
        setConnectionState("disconnected");
        onDisconnectRef.current?.();
        
        // Only reconnect if it wasn't a clean close and we haven't exceeded max attempts
        if (!event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
          console.log(`[WS] Reconnecting in ${delay}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (!event.wasClean && reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setHasExceededMaxAttempts(true);
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] Error occurred");
        isConnectingRef.current = false;
        // Don't reconnect here - let onclose handle it
      };
    } catch (error) {
      console.error("[WS] Failed to create connection:", error);
      isConnectingRef.current = false;
      setConnectionState("disconnected");
      
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
        console.log(`[WS] Retrying in ${delay}ms...`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    }
  }, [url]); // Only depend on url, not callbacks

  useEffect(() => {
    connect();

    return () => {
      cleanup();
    };
  }, [connect, cleanup]);

  return { connectionState, hasExceededMaxAttempts, lastMessageTime };
}
