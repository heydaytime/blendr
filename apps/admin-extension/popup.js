// Blendr Admin Extension - Popup Script
// UI only displays state from background, never changes it on load

import { BACKEND_URL } from './config.js';

// UI Elements
const broadcastBtn = document.getElementById('broadcast-btn');
const statusValue = document.getElementById('status-value');
const youtubeIdEl = document.getElementById('youtube-id');
const timestampEl = document.getElementById('timestamp');
const playingStateEl = document.getElementById('playing-state');
const packetsSentEl = document.getElementById('packets-sent');
const sessionSection = document.getElementById('session-section');
const sessionIdEl = document.getElementById('session-id');
const shareLinkText = document.getElementById('share-link-text');
const packetPreview = document.getElementById('packet-preview');
const twitchIdInput = document.getElementById('twitch-id');
const copyBtn = document.getElementById('copy-btn');
const debugLog = document.getElementById('debug-log');
const twitchToggle = document.getElementById('twitch-toggle');
const twitchControls = document.getElementById('twitch-controls');

let isBroadcasting = false;
let sessionId = null;
let viewerUrl = null;
let packetCount = 0;
let lastPacket = null;
let currentTabId = null;
let broadcastingTabId = null;

// Debug logging
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}`;
  if (debugLog) {
    debugLog.textContent = line + '\n' + debugLog.textContent;
    const lines = debugLog.textContent.split('\n');
    if (lines.length > 20) {
      debugLog.textContent = lines.slice(0, 20).join('\n');
    }
  }
}

// Initialize - UI reads from background, never writes on load
document.addEventListener('DOMContentLoaded', async () => {
  log('Popup opened');
  try {
    // Step 1: Get ALL state from background (source of truth)
    const [broadcastingInfo, twitchState] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_BROADCASTING_TAB' }),
      chrome.runtime.sendMessage({ type: 'GET_TWITCH_STATE' })
    ]);
    
    // Step 2: Load broadcasting state
    if (broadcastingInfo) {
      isBroadcasting = broadcastingInfo.isBroadcasting || false;
      sessionId = broadcastingInfo.sessionId || null;
      broadcastingTabId = broadcastingInfo.broadcastingTabId || null;
    }
    
    // Step 2b: Load viewerUrl from storage
    const storedState = await chrome.storage.local.get(['viewerUrl']);
    viewerUrl = storedState.viewerUrl || null;
    
    // Step 3: Load Twitch settings from storage (values only, not toggle)
    const stored = await chrome.storage.local.get(['twitchId', 'twitchPosition']);
    if (stored.twitchId && twitchIdInput) twitchIdInput.value = stored.twitchId;
    if (stored.twitchPosition) selectPosition(stored.twitchPosition, false);
    
    // Step 4: Set toggle from background state ONLY
    if (twitchState && typeof twitchState.twitchEnabled === 'boolean') {
      log('Background says twitchEnabled=' + twitchState.twitchEnabled);
      if (twitchToggle) twitchToggle.checked = twitchState.twitchEnabled;
    } else {
      log('No twitch state from background, defaulting to OFF');
      if (twitchToggle) twitchToggle.checked = false;
    }
    
    // Step 5: Update UI based on toggle
    updateTwitchControlsState();
    
    // Step 6: Get current tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTab ? activeTab.id : null;
    
    // Step 7: Check for other tab warning
    if (isBroadcasting && broadcastingTabId && currentTabId && broadcastingTabId !== currentTabId) {
      showOtherTabWarning();
    }
    
    // Step 8: Setup everything
    setupEventListeners();
    setupRealtimeUpdates();
    updateUI();
    
    log('Popup initialized. Status: ' + (isBroadcasting ? 'Broadcasting' : 'Idle'));
  } catch (error) {
    log('FATAL ERROR: ' + error.message);
    console.error('Popup initialization error:', error);
  }
});

function showOtherTabWarning() {
  const warningDiv = document.getElementById('other-tab-warning');
  const otherTabInfo = document.getElementById('other-tab-info');
  if (warningDiv && otherTabInfo) {
    warningDiv.classList.remove('hidden');
    otherTabInfo.textContent = 'Broadcasting is currently active on another tab.';
    broadcastBtn.disabled = true;
    broadcastBtn.textContent = 'Disabled (Other Tab Active)';
    broadcastBtn.style.opacity = '0.5';
  }
}

function setupEventListeners() {
  // Broadcast button
  if (broadcastBtn) {
    broadcastBtn.addEventListener('click', async () => {
      try {
        if (broadcastBtn.classList.contains('failed')) {
          await resetAndStart();
        } else if (isBroadcasting) {
          await stopBroadcasting();
        } else {
          await startBroadcasting();
        }
      } catch (err) {
        log('ERROR: ' + err.message);
      }
    });
  }

  // Check state button
  const checkStateBtn = document.getElementById('check-state-btn');
  if (checkStateBtn) {
    checkStateBtn.addEventListener('click', checkCurrentState);
  }
  
  // Switch tab button
  const switchTabBtn = document.getElementById('switch-tab-btn');
  if (switchTabBtn) {
    switchTabBtn.addEventListener('click', switchToThisTab);
  }
  
  // Position grid
  document.querySelectorAll('.position-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      selectPosition(cell.dataset.position);
      saveTwitchSettings();
    });
  });
  
  // Twitch toggle - only this changes the enabled state
  if (twitchToggle) {
    twitchToggle.addEventListener('change', () => {
      updateTwitchControlsState();
      saveTwitchSettings();
    });
  }
  
  // Twitch ID changes
  if (twitchIdInput) {
    twitchIdInput.addEventListener('input', saveTwitchSettings);
  }
  
  // Redirect users button
  const redirectBtn = document.getElementById('redirect-btn');
  if (redirectBtn) {
    redirectBtn.addEventListener('click', redirectUsers);
  }
  
  // Copy link
  if (copyBtn) {
    copyBtn.addEventListener('click', copyShareLink);
  }
  
  // Background updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PACKET_SENT') {
      packetCount = message.packetCount;
      lastPacket = message.packet;
      packetsSentEl.textContent = packetCount;
      if (lastPacket && packetPreview) {
        packetPreview.textContent = JSON.stringify(lastPacket, null, 2);
      }
    } else if (message.type === 'BROADCAST_FAILED') {
      handleBroadcastFailed();
    } else if (message.type === 'REDIRECT_SENT') {
      const redirectBtn = document.getElementById('redirect-btn');
      if (redirectBtn) {
        redirectBtn.textContent = 'Redirect Sent!';
        redirectBtn.style.background = '#00ff88';
        redirectBtn.style.color = '#000';
        setTimeout(() => {
          redirectBtn.textContent = 'Redirect Users to Twitch';
          redirectBtn.style.background = '#9146ff';
          redirectBtn.style.color = 'white';
        }, 2000);
      }
      log('Redirect sent: ' + message.redirectUrl);
    } else if (message.type === 'REDIRECT_FAILED') {
      const redirectBtn = document.getElementById('redirect-btn');
      if (redirectBtn) {
        redirectBtn.textContent = 'Redirect Failed';
        redirectBtn.style.background = '#ff4444';
        setTimeout(() => {
          redirectBtn.textContent = 'Redirect Users to Twitch';
          redirectBtn.style.background = '#9146ff';
        }, 2000);
      }
      log('Redirect failed: ' + message.reason);
    }
    return true;
  });
}

async function checkCurrentState() {
  log('Checking current tab...');
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_YOUTUBE_STATE', tabId: activeTab?.id ?? null });
    if (response && response.videoId) {
      if (youtubeIdEl) youtubeIdEl.textContent = response.videoId;
      if (timestampEl) timestampEl.textContent = response.timestamp.toFixed(2) + 's';
      if (playingStateEl) {
        playingStateEl.textContent = response.playing ? 'Playing' : 'Paused';
        playingStateEl.className = 'status-value ' + (response.playing ? 'playing' : 'paused');
      }
      const packet = {
        type: 'sync',
        videoId: response.videoId,
        timestamp: response.timestamp,
        playing: response.playing,
        twitchId: response.twitchId,
        twitchPosition: response.twitchPosition
      };
      if (packetPreview) packetPreview.textContent = JSON.stringify(packet, null, 2);
    } else if (response && response.error) {
      log('Error: ' + response.error);
    }
  } catch (err) {
    log('Failed to check state: ' + err.message);
  }
}

function setupRealtimeUpdates() {
  setInterval(async () => {
    if (isBroadcasting) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_STATE' });
        if (response && response.videoId) {
          if (youtubeIdEl && response.videoId) youtubeIdEl.textContent = response.videoId;
          if (timestampEl && typeof response.timestamp === 'number') {
            timestampEl.textContent = response.timestamp.toFixed(2) + 's';
          }
          if (playingStateEl && typeof response.playing === 'boolean') {
            playingStateEl.textContent = response.playing ? 'Playing' : 'Paused';
            playingStateEl.className = 'status-value ' + (response.playing ? 'playing' : 'paused');
          }
        }
      } catch (err) {
        // Ignore
      }
    }
  }, 500);
}

async function startBroadcasting() {
  broadcastBtn.disabled = true;
  broadcastBtn.textContent = 'Checking...';
  
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      throw new Error('No active tab found');
    }

    const currentState = await chrome.runtime.sendMessage({
      type: 'CHECK_YOUTUBE_STATE',
      tabId: activeTab.id
    });

    if (!currentState || currentState.error) {
      throw new Error(currentState?.error || 'Please navigate to a YouTube video first');
    }
    
    broadcastBtn.textContent = 'Creating Session...';
    
    const response = await fetch(`${BACKEND_URL}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) throw new Error('Failed to create session');
    
    const data = await response.json();
    sessionId = data.sessionId;
    viewerUrl = data.viewerUrl;
    const adminToken = data.adminToken;
    
    // Get current settings from UI
    const isEnabled = twitchToggle ? twitchToggle.checked : false;
    const twitchId = isEnabled ? (twitchIdInput ? twitchIdInput.value.trim() : '') : '';
    const twitchPosition = isEnabled ? (document.querySelector('.position-cell.active')?.dataset.position || null) : null;
    
    log(`Starting broadcast: enabled=${isEnabled}, id=${twitchId || 'null'}`);
    
    const startResponse = await chrome.runtime.sendMessage({
      type: 'START_BROADCASTING',
      sessionId: sessionId,
      adminToken: adminToken,
      twitchEnabled: isEnabled,
      twitchId: twitchId || null,
      twitchPosition: twitchPosition,
      tabId: activeTab.id
    });

    if (!startResponse || startResponse.success === false) {
      throw new Error(startResponse?.error || 'Failed to start broadcasting');
    }
    
    isBroadcasting = true;
    currentTabId = activeTab.id;
    broadcastingTabId = startResponse.broadcastingTabId || activeTab.id;
    
    await chrome.storage.local.set({
      isBroadcasting: true,
      sessionId: sessionId,
      adminToken: adminToken,
      viewerUrl: viewerUrl,
      broadcastingTabId: broadcastingTabId
    });
    
    updateUI();
    log('Broadcasting started');
    
  } catch (error) {
    log('ERROR: ' + error.message);
    statusValue.textContent = error.message;
    statusValue.className = 'status-value error';
    broadcastBtn.disabled = false;
    broadcastBtn.textContent = 'Start Broadcasting';
  }
}

async function stopBroadcasting() {
  await chrome.runtime.sendMessage({ type: 'STOP_BROADCASTING' });
  
  isBroadcasting = false;
  sessionId = null;
  viewerUrl = null;
  packetCount = 0;
  broadcastingTabId = null;
  
  await chrome.storage.local.set({
    isBroadcasting: false,
    sessionId: null,
    adminToken: null,
    viewerUrl: null,
    packetCount: 0,
    broadcastingTabId: null
  });
  
  updateUI();
}

async function resetAndStart() {
  isBroadcasting = false;
  await chrome.storage.local.set({ isBroadcasting: false, sessionId: null });
  broadcastBtn.classList.remove('failed');
  await startBroadcasting();
}

async function switchToThisTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    log('Switch failed: No active tab found');
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: activeTab.id });
  if (!response || response.success === false) {
    log('Switch failed: ' + (response?.error || 'Unable to switch tabs'));
    return;
  }

  currentTabId = activeTab.id;
  const warningDiv = document.getElementById('other-tab-warning');
  if (warningDiv) warningDiv.classList.add('hidden');
  broadcastBtn.disabled = false;
  broadcastBtn.style.opacity = '1';
  
  // Reload state from background
  const info = await chrome.runtime.sendMessage({ type: 'GET_BROADCASTING_TAB' });
  if (info) {
    isBroadcasting = info.isBroadcasting;
    sessionId = info.sessionId;
    broadcastingTabId = info.broadcastingTabId;
  }
  updateUI();
}

function handleBroadcastFailed() {
  isBroadcasting = false;
  broadcastBtn.classList.remove('start', 'stop');
  broadcastBtn.classList.add('failed');
  broadcastBtn.textContent = 'Failed - Click to Restart';
  broadcastBtn.disabled = false;
  statusValue.textContent = 'Failed';
  statusValue.className = 'status-value error';
}

function updateUI() {
  const isCurrentTab = isBroadcasting && (broadcastingTabId === currentTabId);
  
  if (isCurrentTab) {
    broadcastBtn.classList.remove('start', 'failed');
    broadcastBtn.classList.add('stop');
    broadcastBtn.textContent = 'Stop Broadcasting';
    broadcastBtn.disabled = false;
    statusValue.textContent = 'Broadcasting';
    statusValue.className = 'status-value success';
    sessionSection.classList.remove('hidden');
    if (sessionId) {
      sessionIdEl.textContent = sessionId;
      shareLinkText.textContent = viewerUrl || `https://blendr.live/watch?session=${sessionId}`;
    }
  } else if (isBroadcasting) {
    broadcastBtn.classList.remove('start', 'stop', 'failed');
    broadcastBtn.textContent = 'Other Tab Active';
    broadcastBtn.disabled = true;
    statusValue.textContent = 'Other Tab';
    sessionSection.classList.add('hidden');
  } else {
    broadcastBtn.classList.remove('stop', 'failed');
    broadcastBtn.classList.add('start');
    broadcastBtn.textContent = 'Start Broadcasting';
    broadcastBtn.disabled = false;
    statusValue.textContent = 'Idle';
    statusValue.className = 'status-value';
    sessionSection.classList.add('hidden');
    youtubeIdEl.textContent = '-';
    timestampEl.textContent = '-';
    playingStateEl.textContent = '-';
    packetsSentEl.textContent = '0';
  }
}

function selectPosition(position, save = true) {
  document.querySelectorAll('.position-cell').forEach(cell => {
    cell.classList.toggle('active', cell.dataset.position === position);
  });
  if (save) saveTwitchSettings();
}

function updateTwitchControlsState() {
  if (!twitchToggle || !twitchControls) return;
  if (twitchToggle.checked) {
    twitchControls.classList.remove('disabled');
  } else {
    twitchControls.classList.add('disabled');
  }
}

async function saveTwitchSettings() {
  const isEnabled = twitchToggle ? twitchToggle.checked : false;
  const twitchId = twitchIdInput ? twitchIdInput.value.trim() : '';
  const twitchPosition = document.querySelector('.position-cell.active')?.dataset.position || null;
  
  log(`Saving: enabled=${isEnabled}, id="${twitchId}", pos=${twitchPosition}`);
  
  // Save values to storage (for UI persistence)
  await chrome.storage.local.set({
    twitchId: twitchId,
    twitchPosition: twitchPosition
  });
  
  // Tell background about the change
  await chrome.runtime.sendMessage({
    type: 'UPDATE_TWITCH_SETTINGS',
    twitchEnabled: isEnabled,
    twitchId: isEnabled ? (twitchId || null) : null,
    twitchPosition: isEnabled ? twitchPosition : null
  });
}

async function redirectUsers() {
  const channelName = twitchIdInput ? twitchIdInput.value.trim() : '';
  if (!channelName) {
    log('Redirect failed: No Twitch channel ID entered');
    const redirectBtn = document.getElementById('redirect-btn');
    if (redirectBtn) {
      redirectBtn.textContent = 'Enter Twitch ID First!';
      redirectBtn.style.background = '#ff4444';
      setTimeout(() => {
        redirectBtn.textContent = 'Redirect Users to Twitch';
        redirectBtn.style.background = '#9146ff';
      }, 2000);
    }
    return;
  }
  
  log(`Sending redirect to twitch.tv/${channelName}`);
  await chrome.runtime.sendMessage({
    type: 'REDIRECT_USERS',
    channelName: channelName
  });
}

function copyShareLink() {
  if (!sessionId) return;
  const link = shareLinkText?.textContent || `https://blendr.live/watch?session=${sessionId}`;
  navigator.clipboard.writeText(link).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy', 1500);
  });
}
