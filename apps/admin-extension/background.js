// Blendr Admin Extension - Background Service Worker
// Handles session, WebSocket, and packet forwarding with failure detection

import { BACKEND_URL, BACKEND_WS_URL } from './config.js';

const MAX_FAILED_PACKETS = 5;

function normalizeTwitchChannel(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const withoutUrl = trimmed
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  return /^[a-zA-Z0-9_]{1,25}$/.test(withoutUrl) ? withoutUrl : null;
}

class BlendrBroadcastManager {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.adminToken = null;
    this.isBroadcasting = false;
    this.failedPacketCount = 0;
    this.successfulPacketCount = 0;
    this.lastPacket = null;
    this.lastVideoState = null;
    this.expectedVideoId = null;
    
    this.twitchId = null;
    this.twitchPosition = null;
    this.twitchEnabled = false;
    this.broadcastingTabId = null;
    
    this.init();
  }
  
  async init() {
    const result = await chrome.storage.local.get([
      'isBroadcasting', 'sessionId', 'adminToken', 'twitchId', 'twitchPosition', 'twitchEnabled',
      'failedPacketCount', 'successfulPacketCount', 'broadcastingTabId'
    ]);
    
    this.twitchEnabled = result.twitchEnabled || false;
    this.twitchId = result.twitchId || null;
    this.twitchPosition = result.twitchPosition || null;
    this.broadcastingTabId = result.broadcastingTabId || null;
    this.adminToken = result.adminToken || null;
    
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
    
    if (result.isBroadcasting && result.sessionId) {
      await this.clearBroadcastState();
    }
  }
  
  async handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'START_BROADCASTING':
        try {
          await this.startBroadcasting(message.sessionId, message.adminToken, message.twitchEnabled, message.twitchId, message.twitchPosition, message.tabId);
          sendResponse({ success: true, broadcastingTabId: this.broadcastingTabId });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
        
      case 'STOP_BROADCASTING':
        await this.stopBroadcasting();
        sendResponse({ success: true });
        break;
        
      case 'UPDATE_TWITCH_SETTINGS':
        this.twitchEnabled = message.twitchEnabled;
        this.twitchId = message.twitchId;
        this.twitchPosition = message.twitchPosition;
        await chrome.storage.local.set({
          twitchEnabled: this.twitchEnabled,
          twitchId: this.twitchId,
          twitchPosition: this.twitchPosition
        });
        sendResponse({ success: true });
        break;
        
      case 'GET_LATEST_STATE':
        sendResponse({
          ...this.lastVideoState,
          packetCount: this.successfulPacketCount,
          isBroadcasting: this.isBroadcasting,
          broadcastingTabId: this.broadcastingTabId
        });
        break;
        
      case 'GET_TWITCH_STATE':
        sendResponse({
          twitchEnabled: this.twitchEnabled,
          twitchId: this.twitchId,
          twitchPosition: this.twitchPosition
        });
        break;
        
      case 'GET_BROADCASTING_TAB':
        sendResponse({
          isBroadcasting: this.isBroadcasting,
          broadcastingTabId: this.broadcastingTabId,
          sessionId: this.sessionId
        });
        break;
        
      case 'SWITCH_TO_TAB':
        try {
          await this.switchToTab(message.tabId);
          sendResponse({ success: true, broadcastingTabId: this.broadcastingTabId });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
        
      case 'PACKET_FROM_CONTENT':
        await this.handlePacketFromContent(message.packet, sender);
        sendResponse({ received: true });
        break;
        
      case 'CHECK_YOUTUBE_STATE':
        const state = await this.checkYouTubeState(message.tabId);
        sendResponse(state);
        break;
        
      case 'REDIRECT_USERS':
        await this.redirectUsers(message.channelName);
        sendResponse({ success: true });
        break;
        
      case 'VIDEO_CHANGED':
        if (!this.isMessageFromBroadcastingTab(sender)) {
          console.log('[Blendr Background] Ignoring video change from non-broadcasting tab:', sender?.tab?.id);
          sendResponse({ success: false, ignored: true });
          break;
        }

        console.log('[Blendr Background] Video changed to:', message.videoId);
        
        // Update expected video ID
        this.expectedVideoId = message.videoId;
        
        // Reset failed packet count for fresh start
        this.failedPacketCount = 0;
        
        // Notify popup about the video change
        this.notifyPopup({
          type: 'VIDEO_CHANGED',
          videoId: message.videoId,
          url: message.url
        });
        
        sendResponse({ success: true, message: 'Video change acknowledged' });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }
  
  async getActiveTabId() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id ?? null;
  }

  async inspectTabPage(tabId) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          isYouTubeWatch:
            location.hostname === 'www.youtube.com' &&
            location.pathname === '/watch' &&
            new URLSearchParams(location.search).has('v'),
          title: document.title
        })
      });

      return result?.result || { isYouTubeWatch: false, title: '' };
    } catch {
      return { isYouTubeWatch: false, title: '' };
    }
  }

  isMessageFromBroadcastingTab(sender) {
    return !!(
      this.broadcastingTabId &&
      sender &&
      sender.tab &&
      sender.tab.id === this.broadcastingTabId
    );
  }

  async startBroadcasting(sessionId, adminToken, twitchEnabled, twitchId, twitchPosition, tabId = null) {
    // If already broadcasting from another tab, stop that first
    if (this.isBroadcasting && this.broadcastingTabId) {
      await this.sendToContentScript({ type: 'STOP_MONITORING' }, this.broadcastingTabId);
    }
    
    this.sessionId = sessionId;
    this.adminToken = adminToken;
    this.twitchEnabled = twitchEnabled;
    this.twitchId = twitchId;
    this.twitchPosition = twitchPosition;
    this.isBroadcasting = true;
    this.failedPacketCount = 0;
    this.successfulPacketCount = 0;

    this.broadcastingTabId = tabId || await this.getActiveTabId();

    if (!this.broadcastingTabId) {
      await this.handleBroadcastFailure('No active tab found');
      throw new Error('No active tab found');
    }

    const currentState = await this.checkYouTubeState(this.broadcastingTabId);
    if (!currentState || currentState.error) {
      await this.handleBroadcastFailure(currentState?.error || 'Current tab is not a YouTube video');
      throw new Error(currentState?.error || 'Current tab is not a YouTube video');
    }

    this.expectedVideoId = currentState.videoId;
    
    await chrome.storage.local.set({
      isBroadcasting: true,
      sessionId: sessionId,
      adminToken: adminToken,
      twitchEnabled: twitchEnabled,
      twitchId: twitchId,
      twitchPosition: twitchPosition,
      broadcastingTabId: this.broadcastingTabId,
      failedPacketCount: 0,
      successfulPacketCount: 0
    });
     
    await this.connectWebSocket();
    await this.sendToContentScript({ type: 'START_MONITORING' }, this.broadcastingTabId);
  }

  async switchToTab(tabId = null) {
    const targetTabId = tabId || await this.getActiveTabId();
    if (!targetTabId) {
      throw new Error('No active tab found');
    }

    const currentState = await this.checkYouTubeState(targetTabId);
    if (!currentState || currentState.error) {
      throw new Error(currentState?.error || 'Current tab is not a YouTube video');
    }

    if (this.isBroadcasting && this.broadcastingTabId) {
      await this.sendToContentScript({ type: 'STOP_MONITORING' }, this.broadcastingTabId);
    }

    this.broadcastingTabId = targetTabId;
    this.expectedVideoId = currentState.videoId;
    await chrome.storage.local.set({ broadcastingTabId: this.broadcastingTabId });
    await this.sendToContentScript({ type: 'START_MONITORING' }, this.broadcastingTabId);
    this.notifyPopup({ type: 'TAB_SWITCHED', tabId: this.broadcastingTabId });
  }
  
  async stopBroadcasting() {
    await this.sendToContentScript({ type: 'STOP_MONITORING' });
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    await this.clearBroadcastState();
  }
  
  async redirectUsers(channelName) {
    const twitchChannel = normalizeTwitchChannel(channelName);
    if (!twitchChannel) {
      this.notifyPopup({ type: 'REDIRECT_FAILED', reason: 'Enter a valid Twitch channel name' });
      return;
    }
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.notifyPopup({ type: 'REDIRECT_FAILED', reason: 'WebSocket not connected' });
      return;
    }
    
    const redirectMsg = {
      type: 'redirect',
      redirectUrl: `https://www.twitch.tv/${twitchChannel}/live`
    };
    
    try {
      this.ws.send(JSON.stringify(redirectMsg));
      console.log('[Blendr Background] Redirect sent:', redirectMsg.redirectUrl);
      this.notifyPopup({ type: 'REDIRECT_SENT', redirectUrl: redirectMsg.redirectUrl });
    } catch (error) {
      console.error('[Blendr Background] Failed to send redirect:', error);
      this.notifyPopup({ type: 'REDIRECT_FAILED', reason: 'Failed to send redirect command' });
    }
  }
  
  async clearBroadcastState() {
    this.isBroadcasting = false;
    this.sessionId = null;
    this.adminToken = null;
    this.failedPacketCount = 0;
    this.successfulPacketCount = 0;
    this.lastPacket = null;
    this.lastVideoState = null;
    this.broadcastingTabId = null;
    
    await chrome.storage.local.set({
      isBroadcasting: false,
      sessionId: null,
      adminToken: null,
      broadcastingTabId: null,
      failedPacketCount: 0,
      successfulPacketCount: 0
    });
  }
  
  connectWebSocket() {
    return new Promise((resolve, reject) => {
      const wsUrl = `${BACKEND_WS_URL}/ws?session=${this.sessionId}&role=admin&token=${this.adminToken}`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        resolve();
      };
      
      this.ws.onclose = () => {
        this.ws = null;
        if (this.isBroadcasting) {
          this.handleBroadcastFailure('WebSocket closed unexpectedly');
        }
      };
      
      this.ws.onerror = (error) => {
        if (this.isBroadcasting) {
          this.handleBroadcastFailure('WebSocket error');
        }
        reject(error);
      };
      
      this.ws.onmessage = (event) => {
        // Handle messages from backend if needed
      };
    });
  }
  
  async handlePacketFromContent(packet, sender) {
    // Ignore packets with no videoId
    if (!packet.videoId) {
      console.log('[Blendr Background] Ignoring packet with no videoId');
      return;
    }
    
    // Ignore packets from tabs that are not the designated broadcasting tab
    if (!this.isMessageFromBroadcastingTab(sender)) {
      console.log('[Blendr Background] Ignoring packet from non-broadcasting tab:', sender?.tab?.id);
      return;
    }
    
    // Accept all valid packets - content script handles the logic
    console.log('[Blendr Background] Received packet:', packet.videoId, 'playing:', packet.playing);
    
    this.lastVideoState = {
      videoId: packet.videoId,
      timestamp: packet.timestamp,
      playing: packet.playing
    };
    
    // Update expected video ID to match what we're actually broadcasting
    this.expectedVideoId = packet.videoId;
    
    const unifiedPacket = {
      type: 'sync',
      videoId: packet.videoId,
      timestamp: packet.timestamp,
      playing: packet.playing,
      twitchId: this.twitchEnabled ? this.twitchId : null,
      twitchPosition: this.twitchEnabled ? this.twitchPosition : null
    };
    
    this.lastPacket = unifiedPacket;
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.handlePacketFailure();
      return;
    }
    
    try {
      this.ws.send(JSON.stringify(unifiedPacket));
      this.successfulPacketCount++;
      this.failedPacketCount = 0;
      
      await chrome.storage.local.set({
        successfulPacketCount: this.successfulPacketCount,
        failedPacketCount: 0
      });
      
      this.notifyPopup({
        type: 'PACKET_SENT',
        packet: unifiedPacket,
        packetCount: this.successfulPacketCount
      });
      
    } catch (error) {
      await this.handlePacketFailure();
    }
  }
  
  async handlePacketFailure() {
    this.failedPacketCount++;
    
    await chrome.storage.local.set({
      failedPacketCount: this.failedPacketCount
    });
    
    if (this.failedPacketCount >= MAX_FAILED_PACKETS) {
      await this.handleBroadcastFailure(`Failed to send ${MAX_FAILED_PACKETS} consecutive packets`);
    }
  }
  
  async handleBroadcastFailure(reason) {
    this.isBroadcasting = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    await this.sendToContentScript({ type: 'STOP_MONITORING' });
    
    await chrome.storage.local.set({
      isBroadcasting: false,
      failedPacketCount: this.failedPacketCount
    });
    
    this.notifyPopup({
      type: 'BROADCAST_FAILED',
      reason: reason
    });
  }
  
  async checkYouTubeState(tabId = null) {
    const targetTabId = tabId || await this.getActiveTabId();

    if (!targetTabId) {
      return { error: 'No active tab found' };
    }

    const pageInfo = await this.inspectTabPage(targetTabId);
    if (!pageInfo.isYouTubeWatch) {
      return { error: 'Current tab is not a YouTube video. Please navigate to a YouTube video and try again.' };
    }

    // First, try to ping the content script to see if it's loaded
    try {
      await chrome.tabs.sendMessage(targetTabId, { type: 'PING' });
    } catch (e) {
      // Content script not loaded, inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          files: ['content-script.js']
        });
      } catch (injectError) {
        return { error: 'Failed to inject content script: ' + injectError.message };
      }
    }

    try {
      const response = await chrome.tabs.sendMessage(targetTabId, { type: 'GET_CURRENT_STATE' });

      if (response && response.videoId) {
        // Update expected video ID to match current video
        this.expectedVideoId = response.videoId;

        return {
          videoId: response.videoId,
          timestamp: response.timestamp,
          playing: response.playing,
          twitchId: this.twitchId,
          twitchPosition: this.twitchPosition,
          tabTitle: response.title || ''
        };
      } else if (response && response.error) {
        return { error: response.error };
      } else {
        return { error: 'No video playing on current tab' };
      }
    } catch (error) {
      return { error: 'Content script not responding: ' + error.message };
    }
  }

  async sendToContentScript(message, targetTabId = null) {
    const tabId = targetTabId ?? this.broadcastingTabId;
    if (!tabId) {
      return;
    }

    // Try to ping first to check if content script is loaded
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch (e) {
      // Content script not loaded, inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content-script.js']
        });
      } catch (injectError) {
        return;
      }
    }

    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      // Failed to send
    }
  }
  
  notifyPopup(message) {
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup not open, ignore
    });
  }
}

const broadcastManager = new BlendrBroadcastManager();

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === broadcastManager.broadcastingTabId) {
    broadcastManager.broadcastingTabId = null;
    if (broadcastManager.isBroadcasting) {
      broadcastManager.handleBroadcastFailure('YouTube tab closed');
    }
  }
});
