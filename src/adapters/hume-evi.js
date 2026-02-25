/**
 * Hume EVI Adapter (P6-T3)
 *
 * Agent adapter for Hume Empathic Voice Interface (EVI).
 * Wraps the Hume EVI WebSocket API in the EventBridge adapter contract.
 *
 * Hume EVI features:
 *  - SDK-managed audio pipeline (mic input + TTS output)
 *  - Emotional expression data per utterance
 *  - Configurable voice via Hume config_id
 *  - Tool calling (server-side tools via config)
 *  - WebSocket transport (wss://api.hume.ai/v0/evi/chat)
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md
 * Ref: future-dev-plans/15-ELEVENLABS-CLASSIC-AGENT.md (similar pattern)
 *
 * Usage:
 *   const { HumeEVIAdapter } = await import('./adapters/hume-evi.js');
 *   orchestrator.register('hume-evi', HumeEVIAdapter, {
 *       serverUrl: 'http://localhost:5001',
 *       configId: '<hume-config-id>',  // Optional override
 *       voiceName: 'DJ-FoamBot'
 *   });
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';

// ─────────────────────────────────────────────────────────────────
// Emotion → mood mapping (Hume sends emotion scores per utterance)
// ─────────────────────────────────────────────────────────────────

const EMOTION_TO_MOOD = {
    Joy:          'happy',
    Excitement:   'happy',
    Amusement:    'happy',
    Contentment:  'happy',
    Satisfaction:  'happy',
    Sadness:      'sad',
    Disappointment: 'sad',
    Distress:     'sad',
    Anger:        'thinking',
    Disgust:      'thinking',
    Confusion:    'thinking',
    Contemplation: 'thinking',
    Concentration: 'thinking',
    Interest:     'listening',
    Curiosity:    'listening',
    Surprise:     'listening',
    Realization:  'listening',
    // Default: neutral
};

/**
 * Derive the dominant emotion mood from Hume's emotion scores array.
 * @param {Array<{name: string, score: number}>} emotions
 * @returns {string} mood name
 */
function dominantMood(emotions) {
    if (!emotions || emotions.length === 0) return 'neutral';
    const top = emotions.reduce((a, b) => (a.score > b.score ? a : b));
    return EMOTION_TO_MOOD[top.name] || 'neutral';
}

// ─────────────────────────────────────────────────────────────────
// HumeEVIAdapter
// ─────────────────────────────────────────────────────────────────

export const HumeEVIAdapter = {
    name: 'Hume EVI',

    /**
     * What this adapter supports.
     * UI shows/hides features based on this list.
     */
    capabilities: [
        'emotion_detection',  // Hume sends per-utterance emotion scores
        'multi_voice',        // Voice configured via Hume config_id
        'canvas',             // Agent can issue canvas commands via tool
        'dj_soundboard',      // Agent can trigger sound effects via tool
        'music_sync',         // Agent can control music via tool
    ],

    // ── Private state ─────────────────────────────────────────────
    _bridge:          null,
    _config:          null,
    _socket:          null,
    _accessToken:     null,
    _audioContext:    null,
    _mediaStream:     null,
    _mediaRecorder:   null,
    _audioQueue:      [],    // Queued audio chunks from Hume TTS
    _isPlaying:       false,
    _reconnectTimer:  null,
    _reconnectDelay:  1000,
    _maxReconnectDelay: 30000,
    _destroyed:       false,
    _unsubscribers:   [],    // Bridge subscription cleanup functions
    _lastMood:        'neutral',
    _currentSourceNode: null,

    // ─────────────────────────────────────────────────────────────
    // INIT — called when mode is selected
    // ─────────────────────────────────────────────────────────────

    async init(bridge, config) {
        this._bridge = bridge;
        this._config = config || {};
        this._destroyed = false;
        this._audioQueue = [];
        this._isPlaying = false;
        this._reconnectDelay = 1000;

        console.log('[HumeEVI] Initializing adapter');

        // Subscribe to UI → Agent actions
        this._unsubscribers.push(
            bridge.on(AgentActions.END_SESSION, () => this.stop()),
            bridge.on(AgentActions.CONTEXT_UPDATE, (d) => this._sendContextUpdate(d.text)),
            bridge.on(AgentActions.FORCE_MESSAGE, (d) => this._sendAssistantInput(d.text)),
        );

        console.log('[HumeEVI] Adapter initialized, call start() to connect');
    },

    // ─────────────────────────────────────────────────────────────
    // START — connect and begin conversation
    // ─────────────────────────────────────────────────────────────

    async start() {
        if (this._destroyed) return;

        try {
            // 1. Fetch access token from our server (keeps API key server-side)
            await this._fetchAccessToken();

            // 2. Initialize AudioContext (requires user gesture — call start() from click)
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }

            // 3. Connect WebSocket
            await this._connect();

        } catch (err) {
            console.error('[HumeEVI] Start failed:', err);
            this._bridge.emit(AgentEvents.ERROR, { message: err.message });
            this._bridge.emit(AgentEvents.MOOD, { mood: 'sad' });
        }
    },

    // ─────────────────────────────────────────────────────────────
    // STOP — end current session gracefully
    // ─────────────────────────────────────────────────────────────

    async stop() {
        clearTimeout(this._reconnectTimer);
        this._stopMicrophone();
        this._stopAudioPlayback();

        if (this._socket) {
            // Send session_settings with no audio to close cleanly
            try {
                if (this._socket.readyState === WebSocket.OPEN) {
                    this._socket.close(1000, 'User ended session');
                }
            } catch (_) {}
            this._socket = null;
        }

        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
        this._bridge.emit(AgentEvents.DISCONNECTED);
        this._bridge.emit(AgentEvents.MOOD, { mood: 'neutral' });
        console.log('[HumeEVI] Session stopped');
    },

    // ─────────────────────────────────────────────────────────────
    // DESTROY — full teardown on mode switch
    // ─────────────────────────────────────────────────────────────

    async destroy() {
        this._destroyed = true;
        await this.stop();

        // Unsubscribe all bridge listeners
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        // Close AudioContext
        if (this._audioContext) {
            try { await this._audioContext.close(); } catch (_) {}
            this._audioContext = null;
        }

        this._accessToken = null;
        console.log('[HumeEVI] Adapter destroyed');
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE — Token fetch
    // ─────────────────────────────────────────────────────────────

    async _fetchAccessToken() {
        const serverUrl = this._config.serverUrl || '';
        const response = await fetch(`${serverUrl}/api/hume/token`);
        if (!response.ok) {
            throw new Error(`Failed to fetch Hume token: ${response.status}`);
        }
        const data = await response.json();
        this._accessToken = data.access_token || data.token;
        if (data.config_id && !this._config.configId) {
            this._config.configId = data.config_id;
        }
        console.log('[HumeEVI] Access token fetched');
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE — WebSocket connection
    // ─────────────────────────────────────────────────────────────

    async _connect() {
        if (this._destroyed) return;

        const params = new URLSearchParams({ access_token: this._accessToken });
        if (this._config.configId) {
            params.set('config_id', this._config.configId);
        }

        const wsUrl = `wss://api.hume.ai/v0/evi/chat?${params}`;
        console.log('[HumeEVI] Connecting to EVI WebSocket...');

        this._socket = new WebSocket(wsUrl);
        this._socket.binaryType = 'arraybuffer';

        this._socket.onopen = () => this._onOpen();
        this._socket.onmessage = (evt) => this._onMessage(evt);
        this._socket.onclose = (evt) => this._onClose(evt);
        this._socket.onerror = (evt) => this._onError(evt);
    },

    _onOpen() {
        console.log('[HumeEVI] WebSocket connected');
        this._reconnectDelay = 1000;  // Reset backoff on successful connect

        this._bridge.emit(AgentEvents.CONNECTED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        this._bridge.emit(AgentEvents.MOOD, { mood: 'happy' });

        // Start capturing microphone audio
        this._startMicrophone();
    },

    _onClose(evt) {
        console.log(`[HumeEVI] WebSocket closed: ${evt.code} ${evt.reason}`);
        this._stopMicrophone();

        if (!this._destroyed && evt.code !== 1000) {
            // Abnormal close — schedule reconnect with exponential backoff
            console.log(`[HumeEVI] Reconnecting in ${this._reconnectDelay}ms...`);
            this._reconnectTimer = setTimeout(async () => {
                if (!this._destroyed) {
                    try {
                        await this._fetchAccessToken();
                        await this._connect();
                    } catch (err) {
                        console.error('[HumeEVI] Reconnect failed:', err);
                        this._bridge.emit(AgentEvents.ERROR, { message: 'Reconnect failed' });
                    }
                }
            }, this._reconnectDelay);

            // Exponential backoff capped at 30s
            this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);

            this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
            this._bridge.emit(AgentEvents.MOOD, { mood: 'sad' });
        } else if (!this._destroyed) {
            // Normal close (user stopped)
            this._bridge.emit(AgentEvents.DISCONNECTED);
            this._bridge.emit(AgentEvents.MOOD, { mood: 'neutral' });
        }
    },

    _onError(evt) {
        console.error('[HumeEVI] WebSocket error:', evt);
        this._bridge.emit(AgentEvents.ERROR, { message: 'WebSocket error' });
        this._bridge.emit(AgentEvents.MOOD, { mood: 'sad' });
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE — Message routing
    // ─────────────────────────────────────────────────────────────

    _onMessage(evt) {
        // Binary frames = audio data from Hume TTS
        if (evt.data instanceof ArrayBuffer) {
            this._queueAudio(evt.data);
            return;
        }

        let msg;
        try {
            msg = JSON.parse(evt.data);
        } catch (e) {
            console.warn('[HumeEVI] Unparseable message:', evt.data);
            return;
        }

        const type = msg.type;
        // console.debug('[HumeEVI] Message:', type);

        switch (type) {
            case 'session_settings':
                // Server acknowledges session settings
                break;

            case 'user_interruption':
                // User interrupted the agent
                this._stopAudioPlayback();
                this._bridge.emit(AgentEvents.TTS_STOPPED);
                this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
                break;

            case 'user_message':
                // User's speech transcription
                this._handleUserMessage(msg);
                break;

            case 'assistant_message':
                // Agent text + emotion scores
                this._handleAssistantMessage(msg);
                break;

            case 'audio_output':
                // Agent TTS audio chunk (base64)
                this._handleAudioOutput(msg);
                break;

            case 'assistant_end':
                // Agent finished speaking turn
                this._onAssistantEnd();
                break;

            case 'tool_call':
                // Agent called a tool
                this._handleToolCall(msg);
                break;

            case 'tool_response':
                // Server confirms tool response received
                break;

            case 'error':
                console.error('[HumeEVI] Server error:', msg);
                this._bridge.emit(AgentEvents.ERROR, {
                    message: msg.message || 'Unknown Hume error',
                    code: msg.code
                });
                break;

            default:
                // console.debug('[HumeEVI] Unhandled message type:', type);
                break;
        }
    },

    _handleUserMessage(msg) {
        const text = msg.message?.content || '';
        const isFinal = !msg.interim;

        this._bridge.emit(AgentEvents.TRANSCRIPT, { text, partial: !isFinal });

        if (isFinal && text) {
            this._bridge.emit(AgentEvents.MESSAGE, {
                role: 'user',
                text,
                final: true
            });
            this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'thinking' });
            this._bridge.emit(AgentEvents.MOOD, { mood: 'thinking' });
        }
    },

    _handleAssistantMessage(msg) {
        const text = msg.message?.content || '';

        // Extract emotion scores and derive mood
        const emotions = msg.models?.prosody?.scores;
        if (emotions) {
            const emotionList = Object.entries(emotions).map(([name, score]) => ({
                name,
                score
            }));
            const mood = dominantMood(emotionList);
            if (mood !== this._lastMood) {
                this._lastMood = mood;
                this._bridge.emit(AgentEvents.MOOD, { mood });
            }
        }

        if (text) {
            this._bridge.emit(AgentEvents.MESSAGE, {
                role: 'assistant',
                text,
                final: true
            });
        }

        // State transitions
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'speaking' });
    },

    _handleAudioOutput(msg) {
        // Hume sends audio as base64-encoded PCM or MP3
        if (!msg.data) return;

        const binary = atob(msg.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        this._queueAudio(bytes.buffer);
    },

    _onAssistantEnd() {
        // Hume signals end of agent's speaking turn
        // (Audio may still be draining from queue)
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        this._lastMood = 'listening';
        this._bridge.emit(AgentEvents.MOOD, { mood: 'listening' });
    },

    _handleToolCall(msg) {
        const toolName = msg.tool_call?.name || msg.name || '';
        const params = msg.tool_call?.parameters || msg.parameters || {};

        console.log(`[HumeEVI] Tool call: ${toolName}`, params);

        this._bridge.emit(AgentEvents.TOOL_CALLED, {
            name: toolName,
            params,
            result: null  // Will be filled when we get tool_response
        });

        // Route tool calls to bridge events
        switch (toolName) {
            case 'dj_soundboard':
            case 'play_dj_sound':
                if (params.action === 'play' && params.sound) {
                    this._bridge.emit(AgentEvents.PLAY_SOUND, {
                        sound: params.sound,
                        type: 'dj'
                    });
                }
                this._sendToolResponse(msg, `*${params.sound || 'sound'} played* 🎵`);
                break;

            case 'caller_sounds':
            case 'play_caller_sound':
                if (params.action === 'play') {
                    this._bridge.emit(AgentEvents.PLAY_SOUND, {
                        sound: params.sound || 'dial_tone',
                        type: 'caller'
                    });
                }
                this._sendToolResponse(msg, `*Phone sound played* 📞`);
                break;

            case 'play_music':
                this._handleMusicTool(msg, params);
                break;

            case 'canvas_show':
            case 'show_canvas': {
                const action = params.action || 'present';
                this._bridge.emit(AgentEvents.CANVAS_CMD, {
                    action,
                    url: params.url || params.path || ''
                });
                this._sendToolResponse(msg, `Canvas updated`);
                break;
            }

            default:
                // Unknown tool — just acknowledge
                this._sendToolResponse(msg, `Tool ${toolName} executed`);
                break;
        }
    },

    _handleMusicTool(msg, params) {
        const action = params.action || 'play';

        if (action === 'stop') {
            this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'stop' });
        } else if (action === 'pause') {
            this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'pause' });
        } else if (action === 'play') {
            if (params.track) {
                this._bridge.emit(AgentEvents.MUSIC_PLAY, {
                    action: 'play',
                    track: params.track
                });
            } else {
                this._bridge.emit(AgentEvents.MUSIC_SYNC);
            }
        } else if (action === 'skip') {
            this._bridge.emit(AgentEvents.MUSIC_SYNC);
        }

        this._sendToolResponse(msg, `Music: ${action}`);
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE — Send messages to Hume
    // ─────────────────────────────────────────────────────────────

    _sendJSON(payload) {
        if (this._socket && this._socket.readyState === WebSocket.OPEN) {
            this._socket.send(JSON.stringify(payload));
        }
    },

    _sendToolResponse(msg, content) {
        const toolCallId = msg.tool_call?.tool_call_id || msg.tool_call_id || '';
        if (!toolCallId) return;

        this._sendJSON({
            type: 'tool_response',
            tool_call_id: toolCallId,
            content: String(content)
        });
    },

    /**
     * Send a contextual update (injected silently, not spoken).
     */
    _sendContextUpdate(text) {
        this._sendJSON({
            type: 'session_settings',
            context: {
                text,
                type: 'temporary'
            }
        });
    },

    /**
     * Send a user-turn message that the agent must respond to.
     */
    _sendAssistantInput(text) {
        this._sendJSON({
            type: 'user_input',
            text
        });
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE — Microphone capture
    // ─────────────────────────────────────────────────────────────

    async _startMicrophone() {
        try {
            this._mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                }
            });

            this._mediaRecorder = new MediaRecorder(this._mediaStream, {
                mimeType: this._getSupportedMimeType(),
            });

            this._mediaRecorder.ondataavailable = (evt) => {
                if (evt.data.size > 0 && this._socket?.readyState === WebSocket.OPEN) {
                    // Send raw audio binary to Hume
                    this._socket.send(evt.data);
                }
            };

            // Collect audio in small chunks (100ms)
            this._mediaRecorder.start(100);
            console.log('[HumeEVI] Microphone started');

        } catch (err) {
            console.error('[HumeEVI] Microphone access denied:', err);
            this._bridge.emit(AgentEvents.ERROR, {
                message: 'Microphone access denied. Please allow microphone access.'
            });
        }
    },

    _stopMicrophone() {
        if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
            try { this._mediaRecorder.stop(); } catch (_) {}
        }
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(t => t.stop());
        }
        this._mediaRecorder = null;
        this._mediaStream = null;
    },

    _getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
        ];
        return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE — Audio playback (TTS from Hume)
    // ─────────────────────────────────────────────────────────────

    _queueAudio(arrayBuffer) {
        this._audioQueue.push(arrayBuffer);
        if (!this._isPlaying) {
            this._playNextChunk();
        }
    },

    async _playNextChunk() {
        if (this._audioQueue.length === 0) {
            this._isPlaying = false;
            this._bridge.emit(AgentEvents.TTS_STOPPED);
            return;
        }

        this._isPlaying = true;
        const chunk = this._audioQueue.shift();

        if (!this._audioContext) {
            this._playNextChunk();
            return;
        }

        // Signal TTS start on first chunk
        if (!this._isPlaying) {
            this._bridge.emit(AgentEvents.TTS_PLAYING);
        }
        this._bridge.emit(AgentEvents.TTS_PLAYING);

        try {
            const audioBuffer = await this._audioContext.decodeAudioData(chunk.slice(0));
            const source = this._audioContext.createBufferSource();
            this._currentSourceNode = source;
            source.buffer = audioBuffer;
            source.connect(this._audioContext.destination);
            source.onended = () => {
                this._currentSourceNode = null;
                this._playNextChunk();
            };
            source.start();
        } catch (err) {
            console.warn('[HumeEVI] Audio decode error, skipping chunk:', err);
            this._playNextChunk();
        }
    },

    _stopAudioPlayback() {
        this._audioQueue = [];
        if (this._currentSourceNode) {
            try { this._currentSourceNode.stop(); } catch (_) {}
            this._currentSourceNode = null;
        }
        this._isPlaying = false;
    },
};

export default HumeEVIAdapter;
