// Blendr Admin Extension - Content Script
// Gathers YouTube state and sends to background every second

(function() {
  'use strict';

  if (window.__blendrContentScriptLoaded) {
    return;
  }
  window.__blendrContentScriptLoaded = true;

  const SYNC_INTERVAL = 1000;
  
  let videoElement = null;
  let isMonitoring = false;
  let syncTimer = null;
  let currentVideoId = null;
  let lastKnownState = null; // Store last known state for when not on video page
  let glowOverlay = null;
  let glowRafId = null;

  function getPlayerContainer() {
    return document.getElementById('movie_player') || document.querySelector('video');
  }

  function ensureGlowOverlay() {
    if (glowOverlay) return;
    glowOverlay = document.createElement('div');
    glowOverlay.id = 'blendr-glow-overlay';
    glowOverlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      box-shadow: 0 0 24px 4px rgba(34, 197, 94, 0.7), inset 0 0 0 2px rgba(34, 197, 94, 0.4);
      border-radius: 12px;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(glowOverlay);
  }

  function syncGlowOverlay() {
    if (!glowOverlay || !isMonitoring || document.fullscreenElement) {
      if (glowOverlay) glowOverlay.style.opacity = '0';
      return;
    }
    const player = getPlayerContainer();
    if (!player) {
      glowOverlay.style.opacity = '0';
      return;
    }
    const rect = player.getBoundingClientRect();
    glowOverlay.style.top = rect.top + 'px';
    glowOverlay.style.left = rect.left + 'px';
    glowOverlay.style.width = rect.width + 'px';
    glowOverlay.style.height = rect.height + 'px';
    glowOverlay.style.opacity = '1';
  }

  function applyBroadcastGlow() {
    if (document.fullscreenElement) return;
    ensureGlowOverlay();
    syncGlowOverlay();
  }

  function removeBroadcastGlow() {
    if (glowOverlay) glowOverlay.style.opacity = '0';
  }

  function startGlowTracking() {
    ensureGlowOverlay();
    syncGlowOverlay();
    window.addEventListener('resize', syncGlowOverlay);
    window.addEventListener('scroll', syncGlowOverlay, true);

    function tick() {
      if (isMonitoring) {
        syncGlowOverlay();
        glowRafId = requestAnimationFrame(tick);
      }
    }
    glowRafId = requestAnimationFrame(tick);
  }

  function stopGlowTracking() {
    if (glowRafId) {
      cancelAnimationFrame(glowRafId);
      glowRafId = null;
    }
    window.removeEventListener('resize', syncGlowOverlay);
    window.removeEventListener('scroll', syncGlowOverlay, true);
    removeBroadcastGlow();
  }

  // Handle fullscreen enter/exit
  document.addEventListener('fullscreenchange', () => {
    if (!isMonitoring) return;
    if (document.fullscreenElement) {
      removeBroadcastGlow();
    } else {
      applyBroadcastGlow();
    }
  });
  
  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ pong: true });
    } else if (message.type === 'START_MONITORING') {
      startMonitoring();
      sendResponse({ success: true });
    } else if (message.type === 'STOP_MONITORING') {
      stopMonitoring();
      sendResponse({ success: true });
    } else if (message.type === 'GET_CURRENT_STATE') {
      const state = getCurrentState();
      sendResponse(state);
    } else {
      sendResponse({ error: 'Unknown message type' });
    }
    
    return true;
  });
  
  function getCurrentState() {
    const video = document.querySelector('video');
    const videoId = getVideoId();
    
    if (!video || !videoId) {
      return { error: 'Current tab is not a YouTube video. Please navigate to a YouTube video and try again.' };
    }
    
    return {
      videoId: videoId,
      timestamp: video.currentTime,
      playing: !video.paused,
      url: window.location.href,
      title: document.title
    };
  }
  
  function startMonitoring() {
    if (isMonitoring) {
      console.log('[Blendr] Already monitoring');
      return;
    }

    const video = document.querySelector('video');
    const videoId = getVideoId();

    if (!video || !videoId) {
      console.log('[Blendr] No video available to monitor');
      // If we have last known state, we can still broadcast paused
      if (lastKnownState) {
        console.log('[Blendr] Will broadcast last known video as paused');
        isMonitoring = true;
        sendPacket();
        syncTimer = setInterval(sendPacket, SYNC_INTERVAL);
      }
      return;
    }

    videoElement = video;
    currentVideoId = videoId;

    // Update last known state
    lastKnownState = {
      videoId: currentVideoId,
      timestamp: videoElement.currentTime,
      playing: !videoElement.paused
    };

    isMonitoring = true;
    console.log('[Blendr] Started monitoring video:', currentVideoId);

    // Apply green glow indicator
    startGlowTracking();

    sendPacket();
    syncTimer = setInterval(sendPacket, SYNC_INTERVAL);
  }
  
  function stopMonitoring() {
    console.log('[Blendr] Stopping monitoring');
    isMonitoring = false;

    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }

    stopGlowTracking();
    videoElement = null;
    currentVideoId = null;
  }
  
  function sendPacket() {
    if (!isMonitoring) {
      return;
    }
    
    const freshVideoId = getVideoId();
    const video = document.querySelector('video');
    
    if (freshVideoId && video) {
      // We're on a video page - use current video state
      currentVideoId = freshVideoId;
      videoElement = video;
      
      lastKnownState = {
        videoId: currentVideoId,
        timestamp: videoElement.currentTime,
        playing: !videoElement.paused
      };
      
      const packet = {
        videoId: currentVideoId,
        timestamp: videoElement.currentTime,
        playing: !videoElement.paused
      };
      
      console.log('[Blendr] Sending packet for current video:', packet.videoId, 'playing:', packet.playing);
      
      chrome.runtime.sendMessage({
        type: 'PACKET_FROM_CONTENT',
        packet: packet
      }).catch(() => {});
      
    } else if (lastKnownState) {
      // Not on a video page - send last known video as paused
      const pausedPacket = {
        videoId: lastKnownState.videoId,
        timestamp: lastKnownState.timestamp,
        playing: false // Force paused when not on video page
      };
      
      console.log('[Blendr] Sending paused packet for last video:', pausedPacket.videoId);
      
      chrome.runtime.sendMessage({
        type: 'PACKET_FROM_CONTENT',
        packet: pausedPacket
      }).catch(() => {});
    }
  }
  
  function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }
  
  function notifyBackgroundOfError(error) {
    chrome.runtime.sendMessage({
      type: 'PACKET_FROM_CONTENT',
      packet: {
        error: error,
        videoId: null,
        timestamp: 0,
        playing: false
      }
    }).catch(() => {});
  }
  
  // Handle page navigation
  let lastUrl = location.href;
  
  function handleNavigation() {
    if (location.href === lastUrl) return;
    
    console.log('[Blendr] Navigation:', lastUrl, '->', location.href);
    lastUrl = location.href;
    
    // Always restart monitoring on navigation to handle video changes
    if (isMonitoring) {
      stopMonitoring();
      
      // Small delay to let page settle
      setTimeout(() => {
        const newVideoId = getVideoId();
        console.log('[Blendr] After nav, videoId:', newVideoId, 'lastKnown:', lastKnownState?.videoId);
        
        if (newVideoId) {
          // If new video is different from last known, notify background
          if (lastKnownState && newVideoId !== lastKnownState.videoId) {
            console.log('[Blendr] Video changed! Notifying background');
            chrome.runtime.sendMessage({
              type: 'VIDEO_CHANGED',
              videoId: newVideoId,
              url: location.href
            }).catch(() => {});
          }
        }
        
        // Restart monitoring (will use new video if available, or last known paused if not)
        startMonitoring();
      }, 300);
    }
  }
  
  // Listen for history changes (SPA navigation)
  window.addEventListener('popstate', handleNavigation);
  
  // Override pushState and replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    handleNavigation();
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    handleNavigation();
  };
  
  // MutationObserver as backup
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      handleNavigation();
    }
  }).observe(document, { subtree: true, childList: true });
  
})();
