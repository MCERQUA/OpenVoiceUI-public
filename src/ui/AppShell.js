/**
 * AppShell — injects the application DOM structure into document.body
 *
 * Extracted from index.html (P3-T9: thin shell). Call inject() before
 * any module that queries DOM elements by ID.
 *
 * Usage:
 *   import { inject } from './ui/AppShell.js';
 *   inject(); // must be first, before DOM queries
 */
export function inject() {
    document.body.insertAdjacentHTML('afterbegin', SHELL_HTML);
}

const SHELL_HTML = `
    <!-- Canvas Menu Button - Top Left Corner -->
    <button id="canvas-menu-button" title="Canvas Pages Menu">📋</button>

    <!-- Canvas Menu Modal -->
    <div id="canvas-menu-modal" class="canvas-menu-modal" style="display: none;">
        <div class="cmm-backdrop"></div>
        <div class="cmm-content">
            <div class="cmm-header">
                <input type="text" id="canvas-search" placeholder="Search canvas pages...">
                <button class="cmm-close" title="Close">×</button>
            </div>
            <div class="cmm-quick-actions">
                <button class="cmm-qa active" data-filter="all">All</button>
                <button class="cmm-qa" data-filter="recent">🕐 Recent</button>
                <button class="cmm-qa" data-filter="starred">⭐ Starred</button>
            </div>
            <div class="cmm-categories" id="canvas-categories">
                <div class="cmm-loading">Loading canvas pages...</div>
            </div>
            <div class="cmm-footer">
                <span id="cmm-page-count">0 pages</span>
                <button id="cmm-edit-mode">✏️ Edit</button>
            </div>
        </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div id="cmm-confirm-modal" class="cmm-confirm-modal" style="display: none;">
        <div class="cmm-confirm-box">
            <div class="cmm-confirm-icon">🗑️</div>
            <div class="cmm-confirm-title">Archive Canvas Page?</div>
            <div class="cmm-confirm-message">This will remove the page from the menu and archive it. The file will be renamed to .bak for safety.</div>
            <div class="cmm-confirm-page-name" id="cmm-confirm-page-name">Page Name</div>
            <div class="cmm-confirm-buttons">
                <button class="cmm-confirm-btn cancel" id="cmm-confirm-cancel">Cancel</button>
                <button class="cmm-confirm-btn delete" id="cmm-confirm-delete">Archive</button>
            </div>
        </div>
    </div>

    <!-- Canvas System - Full Screen Visual Display -->
    <div id="canvas-container" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 100; background: #000;">
        <iframe
            id="canvas-iframe"
            src="about:blank"
            data-canvas-src=""
            style="width: 100vw; height: 100vh; border: none; display: block;"
            allow="autoplay; fullscreen">
        </iframe>
    </div>

    <!-- Action Console (bottom-left popup) -->
    <button class="console-button" id="console-button" onclick="ActionConsole.toggle()">
        <span>&gt;_</span>
        <div class="unread-dot" id="console-unread"></div>
    </button>
    <div id="action-console">
        <div class="ac-header">
            <span>Actions</span>
            <div style="display:flex;gap:6px;align-items:center;">
                <button class="ac-clear" onclick="ActionConsole.showSessionInfo()" title="Session Info" style="font-size:13px;">ℹ️ Session</button>
                <button class="ac-clear" style="color:#f85149;" onclick="ActionConsole.resetSession()" title="Reset Session">🔄 Reset</button>
                <button class="ac-clear" onclick="ActionConsole.clear()">Clear</button>
                <button class="ac-close" onclick="ActionConsole.hide()">&times;</button>
            </div>
        </div>
        <div class="ac-entries" id="action-entries"></div>
    </div>

    <!-- Transcript Panel (bottom-right popup) -->
    <button class="transcript-button" id="transcript-button" onclick="TranscriptPanel.toggle()">
        <span>💬</span>
        <div class="unread-dot" id="transcript-unread"></div>
    </button>
    <div id="transcript-panel">
        <div class="tp-header">
            <span>Transcript</span>
            <button class="tp-close" onclick="TranscriptPanel.hide()">&times;</button>
        </div>
        <div class="tp-messages" id="transcript-messages"></div>
        <div class="tp-input-bar">
            <label class="tp-upload-btn" title="Attach file">
                📎
                <input type="file" id="tp-file-input" style="display:none"
                       accept="image/*,.pdf,.txt,.md,.json,.csv,.html,.js,.py,.ts,.css"
                       onchange="TranscriptPanel.handleUpload(this)">
            </label>
            <div class="tp-file-preview" id="tp-file-preview" style="display:none">
                <span id="tp-file-name"></span>
                <button class="tp-file-clear" onclick="TranscriptPanel.clearFile()">✕</button>
            </div>
            <input type="text" class="tp-text-input" id="tp-text-input"
                   placeholder="Type a message..."
                   onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();TranscriptPanel.sendText()}">
            <button class="tp-send-btn" onclick="TranscriptPanel.sendText()" title="Send">➤</button>
        </div>
    </div>

    <!-- User Auth Section -->
    <div id="auth-section">
        <div id="user-button"></div>
        <div id="sign-in-button" style="display: none;">
            <button id="login-btn">Login</button>
        </div>
    </div>

    <!-- Login Modal -->
    <div id="clerk-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 2000; justify-content: center; align-items: center;">
        <div id="sign-in-container" style="background: var(--panel-bg); padding: 20px; border-radius: 10px; border: 1px solid var(--blue);"></div>
    </div>

    <!-- Settings Drawer (top-center dropdown) -->
    <div class="settings-drawer" id="settings-drawer">
        <div class="settings-tab" onclick="document.getElementById('settings-drawer').classList.toggle('open')"><span class="status-dot" id="status-dot"></span> SETTINGS</div>
        <div class="settings-panel">
            <div class="settings-group">
                <label>Agent</label>
                <select id="voice-mode-select" onchange="window.QuickSettings?.switchAgent(this.value)">
                    <option value="" disabled>Loading agents…</option>
                </select>
                <div class="provider-status" id="agent-status"></div>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-group">
                <label>TTS Provider</label>
                <select id="voice-provider-select" onchange="window.providerManager?.switchProvider(this.value)">
                    <option value="supertonic">Supertonic (Free)</option>
                    <option value="groq">Groq Orpheus</option>
                    <option value="hume">Hume EVI</option>
                </select>
                <div class="provider-status" id="provider-status">✓ Active</div>
            </div>
            <div class="settings-group" id="voice-select-group">
                <label>Voice</label>
                <select id="voice-select" onchange="window.providerManager?.setVoice(this.value)">
                </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-group">
                <label>PTT Hotkey</label>
                <div class="ptt-hotkey-row">
                    <span class="ptt-hotkey-label" id="ptt-hotkey-label">None</span>
                    <button class="ptt-hotkey-btn" id="ptt-hotkey-set" onclick="window.PTTHotkey?.capture()">Set</button>
                    <button class="ptt-hotkey-btn ptt-hotkey-clear" id="ptt-hotkey-clear" onclick="window.PTTHotkey?.clear()">✕</button>
                </div>
                <div class="provider-status" id="ptt-hotkey-status">Hold hotkey = hold PTT button</div>
            </div>
        </div>
    </div>

    <!-- Clawdbot Chat UI (hidden - voice-only mode) -->
    <div class="clawdbot-container" id="clawdbot-container" style="display: none !important;">
        <div class="clawdbot-status">
            <span class="clawdbot-status-dot" id="clawdbot-status-dot"></span>
            <span id="clawdbot-status-text">Disconnected</span>
        </div>
        <div class="chat-history" id="chat-history">
            <div class="message message-system">Welcome to Clawdbot mode! Select Clawdbot from the mode selector to connect.</div>
        </div>
        <div class="input-container">
            <input type="text" id="clawdbot-text-input" placeholder="Type your message to Clawdbot..." disabled>
            <button id="clawdbot-send-btn" disabled>Send</button>
        </div>
    </div>

    <!-- Status text (hidden, kept for JS compatibility) -->
    <span id="status-text" style="display:none;">OFFLINE</span>

    <!-- PARTY EFFECTS - Behind face, visible when music plays with FX enabled -->
    <div class="party-effects-container" id="party-effects-container">
        <div class="center-glow" id="center-glow"></div>
        <div class="ripple-container" id="ripple-container"></div>
        <div class="explosion-container" id="explosion-container"></div>
        <div class="fireworks-container" id="fireworks-container"></div>
        <div class="party-particle-container" id="party-particle-container"></div>
        <div class="disco-container" id="disco-container"></div>
        <div class="oscilloscope-container" id="oscilloscope-container">
            <canvas id="oscilloscope-canvas"></canvas>
        </div>
        <div class="beat-flash" id="beat-flash"></div>
    </div>

    <!-- Main Face -->
    <div class="face-container">
        <div class="face-box" id="face-box">
            <div class="eyes-container">
                <!-- Left Eye -->
                <div class="eye left-eye" id="left-eye">
                    <div class="eye-white">
                        <div class="pupil-container" id="left-pupil-container">
                            <div class="pupil"></div>
                        </div>
                    </div>
                    <div class="eyelid-top"></div>
                    <div class="eyelid-bottom"></div>
                    <div class="eye-cap-top"></div>
                </div>

                <!-- Right Eye -->
                <div class="eye right-eye" id="right-eye">
                    <div class="eye-white">
                        <div class="pupil-container" id="right-pupil-container">
                            <div class="pupil"></div>
                        </div>
                    </div>
                    <div class="eyelid-top"></div>
                    <div class="eyelid-bottom"></div>
                    <div class="eye-cap-top"></div>
                </div>

                <!-- Thought Bubbles -->
                <div class="thought-bubbles" id="thought-bubbles">
                    <div class="thought-bubble tb-1"></div>
                    <div class="thought-bubble tb-2"></div>
                    <div class="thought-bubble tb-3"></div>
                </div>
            </div>

            <!-- Waveform Mouth -->
            <div class="mouth-container">
                <canvas id="waveform-canvas"></canvas>
            </div>

            <!-- Side visualizers - inside face box so they extend from sides -->
            <div class="side-visualizer left" id="left-viz">
                <!-- Bars added by JS -->
            </div>
            <div class="side-visualizer right" id="right-viz">
                <!-- Bars added by JS -->
            </div>

            <!-- Top/Bottom visualizers - inside face box -->
            <div class="visualizer-container top" id="top-viz">
                <!-- Bars added by JS -->
            </div>
            <div class="visualizer-container bottom" id="bottom-viz">
                <!-- Bars added by JS -->
            </div>
        </div>
    </div>

    <!-- Face notification -->
    <div class="face-notification" id="face-notification"></div>

    <!-- Error message -->
    <div class="error-message" id="error-message"></div>

    <!-- Control buttons — Edge Tabs -->
    <div class="controls-left">
        <button class="edge-tab left call-button" id="call-button" onclick="ModeManager.toggleVoice()">
            <span id="call-icon">📞</span>
        </button>
        <button class="edge-tab left call-button" id="stop-button" onclick="ModeManager.stopAll()" style="display: none; background: rgba(239,68,68,0.25); border-color: rgba(239,68,68,0.6);">
            <span id="stop-icon">⏹️</span>
        </button>
        <button class="edge-tab left wake-button" id="wake-button" onclick="window.toggleWakeWord?.()">
            <span id="wake-icon">👂</span>
        </button>
        <button class="edge-tab left mode-button" id="mode-button" onclick="window.ModeSelector?.toggle(event)">
            <span id="mode-button-icon">🎛️</span>
        </button>
        <button class="edge-tab left ptt-button" id="ptt-button" title="Push to Talk — hold to speak">
            <span id="ptt-icon">🎙️</span>
        </button>
    </div>

    <div class="controls-right">
        <button class="edge-tab right music-button" id="music-button" onclick="window.musicPlayer?.togglePanel()">
            <span id="music-icon">🎵</span>
        </button>
        <button class="edge-tab right canvas-button" id="canvas-button" onclick="CanvasControl.toggle()">
            <span id="canvas-icon">🖥️</span>
        </button>
        <button class="edge-tab right face-button" id="face-button" onclick="window.FacePanel?.toggle()">
            <span id="face-icon">👥</span>
        </button>
        <button class="edge-tab right camera-button" id="camera-button" onclick="window.cameraModule?.toggle()">
            <span class="camera-icon">📷</span>
            <video id="camera-video" autoplay playsinline muted></video>
        </button>
    </div>

    <!-- Face Recognition Panel — slide-out from right edge -->
    <div class="face-panel" id="face-panel">
        <div class="fp-header">
            <span>👥 Recognized Faces</span>
            <button class="fp-close" onclick="window.FacePanel?.hide()">&times;</button>
        </div>
        <ul class="fp-face-list" id="fp-face-list">
            <!-- Populated by JS -->
        </ul>
        <div class="fp-actions">
            <button class="fp-btn" id="fp-identify-btn" onclick="window.FacePanel?.identify()">📷 Identify Me</button>
            <div class="fp-status" id="fp-status"></div>
        </div>
        <div class="fp-register" id="fp-register">
            <input type="text" id="fp-name-input" placeholder="Enter your name..." maxlength="30">
            <div class="fp-register-btns">
                <button class="fp-btn" onclick="window.FacePanel?.capture()">📷 Capture</button>
                <button class="fp-btn fp-upload" onclick="document.getElementById('fp-file-input').click()">📁 Upload</button>
            </div>
            <input type="file" id="fp-file-input" accept="image/*" multiple style="display:none"
                   onchange="window.FacePanel?.handleUpload(this)">
            <div class="fp-photos" id="fp-photos"></div>
        </div>
    </div>

    <!-- Mode Picker Popup — floats beside the mode button -->
    <div class="mode-picker" id="mode-picker">
        <div class="mode-picker-label">CONVERSATION MODE</div>
        <button class="mode-option" id="mode-opt-normal" onclick="window.ModeSelector?.select('normal')">
            <span class="mode-opt-icon">🎙️</span>
            <span class="mode-opt-info">
                <span class="mode-opt-name">Normal</span>
                <span class="mode-opt-desc">Auto-detect speech, 3s silence</span>
            </span>
            <span class="mode-opt-check" id="mode-check-normal">✓</span>
        </button>
        <button class="mode-option" id="mode-opt-listen" onclick="window.ModeSelector?.select('listen')">
            <span class="mode-opt-icon">👂</span>
            <span class="mode-opt-info">
                <span class="mode-opt-name">Listen</span>
                <span class="mode-opt-desc">Accumulate, send manually</span>
            </span>
            <span class="mode-opt-check" id="mode-check-listen"></span>
        </button>
        <button class="mode-option" id="mode-opt-a2a" onclick="window.ModeSelector?.select('a2a')">
            <span class="mode-opt-icon">🤝</span>
            <span class="mode-opt-info">
                <span class="mode-opt-name">Agent to Agent</span>
                <span class="mode-opt-desc">AI room — human can interject</span>
            </span>
            <span class="mode-opt-check" id="mode-check-a2a"></span>
        </button>
    </div>

    <!-- Listen Mode Panel — slide-out from right edge (shown in Listen mode) -->
    <div class="listen-panel" id="listen-panel">
        <div class="listen-header">
            <span>👂 Live Transcription</span>
            <button class="listen-close" onclick="window.ModeSelector?.select('normal')">&times;</button>
        </div>
        <input class="listen-title-input" id="listen-title" type="text"
               placeholder="Session title (optional)" maxlength="80" />
        <div class="listen-meta">
            <span id="listen-word-count">0 words</span>
            <button class="listen-clear-btn" onclick="window.ListenPanel?.clear()">Clear</button>
        </div>
        <div class="listen-transcript" id="listen-transcript">
            <span id="listen-empty" style="color:#3d3d3d;font-style:italic">Start speaking — transcript will appear here</span>
        </div>
        <div class="listen-interim" id="listen-interim"></div>
        <div class="listen-actions">
            <button class="listen-save-btn" id="listen-save-btn" onclick="window.ListenPanel?.save()" disabled title="Save to server">
                💾
            </button>
            <button class="listen-send-btn" id="listen-send-btn" onclick="window.ListenPanel?.sendAsContext()" disabled>
                📤 Send as Context
            </button>
        </div>
        <div class="listen-save-status" id="listen-save-status"></div>
    </div>

    <!-- Agent-to-Agent Panel — slide-out from left edge (shown in A2A mode) -->
    <div class="a2a-panel" id="a2a-panel">
        <div class="a2a-header">
            <span>🤝 Agent-to-Agent</span>
            <button class="a2a-close" onclick="window.AgentToAgentPanel?.hide()">&times;</button>
        </div>
        <div class="a2a-config">
            <label class="a2a-label">This client is:</label>
            <select id="a2a-role" onchange="window.AgentToAgentPanel?.setRole(this.value)">
                <option value="default">Assistant</option>
                <option value="pgai">PGAI</option>
                <option value="observer">Observer (Human)</option>
            </select>
        </div>
        <div class="a2a-status-row">
            <div class="a2a-turn-indicator" id="a2a-turn-indicator">
                <span class="a2a-dot" id="a2a-dot"></span>
                <span id="a2a-turn-label">Idle</span>
            </div>
            <div class="a2a-room-id" id="a2a-room-id"></div>
        </div>
        <div class="a2a-controls">
            <button class="a2a-btn a2a-start" id="a2a-start-btn" onclick="window.AgentToAgentRoom?.start()">▶ Start Room</button>
            <button class="a2a-btn a2a-stop" id="a2a-stop-btn" onclick="window.AgentToAgentRoom?.stop()" style="display:none">⏹ Stop</button>
        </div>
        <div class="a2a-transcript" id="a2a-transcript">
            <div class="a2a-transcript-empty">Conversation will appear here</div>
        </div>
    </div>

    <!-- Music Panel — slide-up card -->
    <div class="music-panel" id="music-panel">
        <!-- FULL VIEW (Concept T — Waveform Bar) -->
        <div class="mp-full" id="mp-full">
            <div class="mp-waveform-bg" id="mp-waveform">
                <div class="bar" style="height:12px;--d:0.6s"></div><div class="bar" style="height:22px;--d:0.9s"></div>
                <div class="bar" style="height:18px;--d:0.7s"></div><div class="bar" style="height:28px;--d:1.1s"></div>
                <div class="bar" style="height:14px;--d:0.5s"></div><div class="bar" style="height:24px;--d:0.8s"></div>
                <div class="bar" style="height:10px;--d:1.0s"></div><div class="bar" style="height:30px;--d:0.65s"></div>
                <div class="bar" style="height:20px;--d:0.85s"></div><div class="bar" style="height:16px;--d:0.75s"></div>
                <div class="bar" style="height:26px;--d:0.55s"></div><div class="bar" style="height:12px;--d:0.95s"></div>
                <div class="bar" style="height:22px;--d:0.7s"></div><div class="bar" style="height:18px;--d:1.05s"></div>
                <div class="bar" style="height:28px;--d:0.6s"></div><div class="bar" style="height:14px;--d:0.9s"></div>
                <div class="bar" style="height:24px;--d:0.8s"></div><div class="bar" style="height:10px;--d:0.55s"></div>
                <div class="bar" style="height:20px;--d:1.1s"></div><div class="bar" style="height:16px;--d:0.75s"></div>
            </div>
            <button class="mp-collapse" onclick="window.musicPlayer?.collapsePanel()" title="Minimize">&#9660;</button>
            <div class="mp-info-row">
                <div class="mp-track-info">
                    <span class="track-label">NOW PLAYING</span>
                    <span class="track-name" id="track-name">-</span>
                </div>
                <select id="playlist-select" onchange="window.switchPlaylist?.(this.value)" title="Switch Playlist">
                    <option value="generated" selected>Generated Tracks</option>
                    <option value="music">Playlist 1</option>
                </select>
            </div>
            <div class="mp-timeline-row">
                <span class="mp-time" id="mp-time-cur">0:00</span>
                <div class="mp-timeline-wrap">
                    <input type="range" class="mp-timeline" id="mp-timeline" min="0" max="100" value="0">
                    <div class="mp-timeline-fill" id="mp-timeline-fill" style="width:0%"></div>
                </div>
                <span class="mp-time" id="mp-time-dur">0:00</span>
            </div>
            <div class="mp-controls-row">
                <button onclick="window.musicPlayer?.prev()">&#9198;</button>
                <button class="mp-play" onclick="window.musicPlayer?.togglePlay()" id="play-pause-btn">&#9208;</button>
                <button onclick="window.musicPlayer?.next()">&#9197;</button>
                <input type="range" class="mp-vol" id="volume-slider" min="0" max="100" value="85"
                       onchange="window.musicPlayer?.setVolume(this.value)">
                <div class="mp-toggle"><input type="checkbox" id="autoplay-checkbox"
                     onchange="window.toggleAutoplay?.(this.checked)"><label for="autoplay-checkbox">Auto</label></div>
                <div class="mp-toggle"><input type="checkbox" id="visualizer-checkbox"
                     onchange="window.toggleVisualizer?.(this.checked)" checked><label for="visualizer-checkbox">FX</label></div>
            </div>
        </div>
        <!-- MINI VIEW -->
        <div class="mp-mini" id="mp-mini" style="display:none">
            <button onclick="window.musicPlayer?.prev()">&#9198;</button>
            <button class="mp-play" onclick="window.musicPlayer?.togglePlay()" id="play-pause-btn-mini">&#9208;</button>
            <button onclick="window.musicPlayer?.next()">&#9197;</button>
            <input type="range" class="mp-vol mp-mini-vol" min="0" max="100" value="85"
                   onchange="window.musicPlayer?.setVolume(this.value)">
            <button class="mp-expand" onclick="window.musicPlayer?.expandPanel()" title="Expand">&#9650;</button>
        </div>
    </div>

    <!-- TTS Provider Selector (moved to settings drawer) -->
    <div class="voice-provider-selector" id="voice-provider-selector" style="display: none;"></div>

    <!-- Voice-only UI - no text input, voice-to-voice only -->

    <!-- Hidden elements -->
    <audio id="music-player" style="display: none;" crossorigin="anonymous"></audio>
    <audio id="music-player-2" style="display: none;" crossorigin="anonymous"></audio>
    <canvas id="capture-canvas" style="display: none;"></canvas>
`;
