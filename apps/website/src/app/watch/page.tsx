"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BACKEND_URL, FRONTEND_URL } from "@/config";

// TypeScript declarations for YouTube IFrame API
declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          playerVars?: {
            mute?: number;
            enablejsapi?: number;
            origin?: string;
            playsinline?: number;
            controls?: number;
            rel?: number;
            modestbranding?: number;
          };
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  destroy(): void;
}

interface SyncMessage {
  type: "sync" | "state" | "redirect";
  videoId: string;
  timestamp: number;
  playing: boolean;
  twitchId?: string;
  twitchPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  redirectUrl?: string;
  target?: string;
}

const SYNC_CONFIG = {
  DRIFT_THRESHOLD: 1.5,
  DRIFT_CHECK_INTERVAL: 1000,
  SYNC_TIMEOUT: 5000,
};

function WatchPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const [adminVideoId, setAdminVideoId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [show404, setShow404] = useState(false);
  const [twitchConfig, setTwitchConfig] = useState<{
    id: string;
    visible: boolean;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  }>({
    id: "",
    visible: false,
    position: "bottom-right",
  });

  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const driftCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageTimeRef = useRef<number>(0);
  const playerReadyRef = useRef<boolean>(false);
  const pendingSyncRef = useRef<{ timestamp: number; playing: boolean } | null>(null);
  const [apiLoaded, setApiLoaded] = useState(false);

  const currentState = useRef({
    videoId: null as string | null,
    lastTimestamp: 0,
    isPlaying: null as boolean | null,
    lastSyncTime: 0,
    adminExpectedTime: 0,
    lastSyncApplyTime: 0,
  });

  // Apply sync using the YT.Player API
  const applySync = useCallback((timestamp: number, shouldBePlaying: boolean, reason: string) => {
    const now = Date.now();
    const timeSinceLastSync = now - currentState.current.lastSyncApplyTime;

    if (timeSinceLastSync < 200) return;
    if (typeof timestamp !== "number" || isNaN(timestamp) || timestamp < 0) return;

    // If player isn't ready yet, queue the sync for later
    if (!playerReadyRef.current || !playerRef.current) {
      console.log(`[Watch] SYNC queued (player not ready): t=${timestamp.toFixed(2)}, playing=${shouldBePlaying}`);
      pendingSyncRef.current = { timestamp, playing: shouldBePlaying };
      return;
    }

    console.log(`[Watch] SYNC (${reason}): t=${timestamp.toFixed(2)}, playing=${shouldBePlaying}`);
    currentState.current.lastSyncApplyTime = now;

    try {
      playerRef.current.seekTo(timestamp, true);
      
      setTimeout(() => {
        if (!playerRef.current) return;
        if (shouldBePlaying) {
          playerRef.current.playVideo();
        } else {
          playerRef.current.pauseVideo();
        }
      }, shouldBePlaying ? 50 : 200);
    } catch (err) {
      console.error("[Watch] Error applying sync:", err);
      // Re-queue on error
      pendingSyncRef.current = { timestamp, playing: shouldBePlaying };
    }
  }, []);

  const startDriftCheck = useCallback(() => {
    if (driftCheckIntervalRef.current) clearInterval(driftCheckIntervalRef.current);

    driftCheckIntervalRef.current = setInterval(() => {
      const state = currentState.current;
      if (!state.videoId || state.isPlaying === null || !state.isPlaying || !playerRef.current) return;

      const now = Date.now();
      const timeSinceLastSync = (now - state.lastSyncTime) / 1000;
      const expectedAdminTime = state.adminExpectedTime + timeSinceLastSync;
      const expectedViewerTime = state.lastTimestamp + timeSinceLastSync;
      const drift = Math.abs(expectedAdminTime - expectedViewerTime);

      if (drift > SYNC_CONFIG.DRIFT_THRESHOLD) {
        applySync(expectedAdminTime, state.isPlaying!, "drift");
        state.lastTimestamp = expectedAdminTime;
        state.lastSyncTime = now;
      }
    }, SYNC_CONFIG.DRIFT_CHECK_INTERVAL);
  }, [applySync]);

  const stopDriftCheck = useCallback(() => {
    if (driftCheckIntervalRef.current) {
      clearInterval(driftCheckIntervalRef.current);
      driftCheckIntervalRef.current = null;
    }
  }, []);

  const processMessage = useCallback((message: SyncMessage) => {
    console.log("[Watch] Received:", message);

    if (message.type === "redirect" && message.redirectUrl) {
      console.log("[Watch] Redirect command received:", message.redirectUrl);
      window.location.href = message.redirectUrl;
      return;
    }

    // Handle Twitch config updates from sync message
    if (message.twitchId !== undefined) {
      setTwitchConfig({
        id: message.twitchId || "",
        visible: !!message.twitchId,
        position: message.twitchPosition || "bottom-right",
      });
    }

    if (message.type !== "sync") {
      return;
    }

    const now = Date.now();
    lastMessageTimeRef.current = now;

    if (!message.videoId) return;

    const state = currentState.current;

    if (message.videoId !== state.videoId) {
      // Reset player ready state when video changes
      playerReadyRef.current = false;
      pendingSyncRef.current = { timestamp: message.timestamp, playing: message.playing };

      setAdminVideoId(message.videoId);
      state.videoId = message.videoId;
      state.isPlaying = message.playing;
      state.lastTimestamp = message.timestamp;
      state.lastSyncTime = now;
      state.adminExpectedTime = message.timestamp;

      stopDriftCheck();
      console.log(`[Watch] Video changed to ${message.videoId}, creating player...`);
      return;
    }

    const timeSinceLastSync = (now - state.lastSyncTime) / 1000;
    state.adminExpectedTime = message.timestamp;
    const expectedViewerTime = state.lastTimestamp + (state.isPlaying ? timeSinceLastSync : 0);
    const timestampDiff = Math.abs(message.timestamp - expectedViewerTime);
    const playStateChanged = message.playing !== state.isPlaying;
    const significantJump = timestampDiff > SYNC_CONFIG.DRIFT_THRESHOLD;

    state.isPlaying = message.playing;
    state.lastTimestamp = message.timestamp;
    state.lastSyncTime = now;

    if (playStateChanged) {
      applySync(message.timestamp, message.playing, "play-state");
      message.playing ? startDriftCheck() : stopDriftCheck();
    } else if (significantJump) {
      applySync(message.timestamp, message.playing, "seek");
    }
  }, [applySync, startDriftCheck, stopDriftCheck]);

  const backendUrl = BACKEND_URL;
  const wsBaseUrl = backendUrl.replace(/^http/, "ws");
  const wsUrl = sessionId ? `${wsBaseUrl}/ws?session=${sessionId}&role=viewer` : "";

  const { connectionState: wsConnectionState, hasExceededMaxAttempts, lastMessageTime } = useWebSocket({
    url: wsUrl,
    onMessage: processMessage,
    onConnect: () => setConnectionState("connected"),
    onDisconnect: () => {
      setConnectionState("disconnected");
      stopDriftCheck();
    },
    maxReconnectAttempts: 5,
  });

  useEffect(() => {
    setConnectionState(wsConnectionState);
  }, [wsConnectionState]);

  useEffect(() => {
    return () => {
      stopDriftCheck();
      // Clean up player when component unmounts
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore errors during cleanup
        }
        playerRef.current = null;
      }
    };
  }, [stopDriftCheck]);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (apiLoaded) return;
    
    if (window.YT && window.YT.Player) {
      setApiLoaded(true);
      return;
    }

    // Load the IFrame API script
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    
    window.onYouTubeIframeAPIReady = () => {
      console.log("[Watch] YouTube IFrame API ready");
      setApiLoaded(true);
    };

    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    
    console.log("[Watch] Loading YouTube IFrame API...");

    return () => {
      if (window.onYouTubeIframeAPIReady) {
        window.onYouTubeIframeAPIReady = undefined;
      }
    };
  }, [apiLoaded]);

  // Create player when videoId changes and API is loaded
  useEffect(() => {
    if (!adminVideoId || !playerContainerRef.current) return;
    if (!apiLoaded || !window.YT?.Player) return;

    // Clean up previous player
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      playerRef.current = null;
    }

    // Reset state
    playerReadyRef.current = false;

    console.log("[Watch] Creating YT.Player with videoId:", adminVideoId);

    try {
      playerRef.current = new window.YT.Player("youtube-player-container", {
        videoId: adminVideoId,
        playerVars: {
          mute: 1,
          enablejsapi: 1,
          origin: FRONTEND_URL,
          playsinline: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (event) => {
            console.log("[Watch] YouTube player ready!");
            playerReadyRef.current = true;

            // Apply any pending sync
            if (pendingSyncRef.current) {
              const { timestamp, playing } = pendingSyncRef.current;
              pendingSyncRef.current = null;
              console.log("[Watch] Applying queued sync after player ready");
              applySync(timestamp, playing, "load");
              startDriftCheck();
            }
          },
          onStateChange: (event) => {
            // Log state changes for debugging
            const stateNames: Record<number, string> = {
              [-1]: "UNSTARTED",
              0: "ENDED",
              1: "PLAYING",
              2: "PAUSED",
              3: "BUFFERING",
              5: "CUED",
            };
            const stateName = stateNames[event.data] || `UNKNOWN(${event.data})`;
            console.log(`[Watch] Player state: ${stateName}`);
          },
          onError: (event) => {
            console.error("[Watch] Player error:", event.data);
          },
        },
      });
    } catch (err) {
      console.error("[Watch] Error creating player:", err);
    }

    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore errors during cleanup
        }
        playerRef.current = null;
      }
    };
  }, [adminVideoId, apiLoaded, applySync, startDriftCheck]);

  // Check for 404 conditions: max attempts exceeded or no messages for > 1 minute
  useEffect(() => {
    if (hasExceededMaxAttempts) {
      setShow404(true);
      return;
    }

    // Only start checking for message timeout after we've received at least one message
    if (!lastMessageTime) return;

    const checkInterval = setInterval(() => {
      const timeSinceLastMessage = Date.now() - lastMessageTime;
      if (timeSinceLastMessage > 60000) { // 1 minute
        setShow404(true);
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(checkInterval);
  }, [hasExceededMaxAttempts, lastMessageTime]);

  if (!sessionId) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "white",
      }}>
        <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>No Session ID</h1>
        <p style={{ color: "#888" }}>
          Please use a valid session link (e.g., /watch?session=abc123)
        </p>
      </div>
    );
  }

  if (show404) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "white",
      }}>
        <h1 style={{ fontSize: "72px", marginBottom: "16px", fontWeight: "bold" }}>404</h1>
        <p style={{ fontSize: "20px", color: "#888" }}>
          {hasExceededMaxAttempts 
            ? "Unable to connect to session" 
            : "Session no longer active"}
        </p>
      </div>
    );
  }

  if (!adminVideoId) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "white",
      }}>
        <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>Waiting for admin...</h1>
        <p style={{ color: "#888", marginBottom: "8px" }}>
          Session: <code style={{ background: "#333", padding: "2px 6px", borderRadius: "4px" }}>{sessionId}</code>
        </p>
        <p style={{ color: "#888" }}>
          {connectionState === "connected" ? "✓ Connected" : connectionState === "connecting" ? "⟳ Connecting..." : "✗ Disconnected"}
        </p>
      </div>
    );
  }

  const getTwitchStyles = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      width: "350px",
      height: "200px",
      border: "none",
      zIndex: 10,
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      display: twitchConfig.visible && twitchConfig.id ? "block" : "none",
    };

    switch (twitchConfig.position) {
      case "top-left":
        return { ...baseStyle, top: "20px", left: "20px" };
      case "top-right":
        return { ...baseStyle, top: "20px", right: "20px" };
      case "bottom-left":
        return { ...baseStyle, bottom: "20px", left: "20px" };
      case "bottom-right":
      default:
        return { ...baseStyle, bottom: "20px", right: "20px" };
    }
  };

  return (
    <div style={{
      position: "relative",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      backgroundColor: "#000",
    }}>
      {/* YouTube player container - YT.Player will create the iframe inside this */}
      <div
        ref={playerContainerRef}
        id="youtube-player-container"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      />
      
      {twitchConfig.id && (
        <iframe
          src={`https://player.twitch.tv/?channel=${twitchConfig.id}&parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&muted=true`}
          style={getTwitchStyles()}
          allowFullScreen
        />
      )}
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "white",
      }}>
        Loading...
      </div>
    }>
      <WatchPageContent />
    </Suspense>
  );
}
