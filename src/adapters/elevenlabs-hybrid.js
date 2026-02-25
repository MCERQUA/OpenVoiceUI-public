/**
 * ElevenLabsHybridAdapter — Multi-Agent Framework adapter (P7-T5)
 *
 * Combines ElevenLabs voice quality with OpenClaw's full VPS control:
 *
 *   ElevenLabs handles:  STT (cloud), TTS (multi-voice), dj_soundboard,
 *                        caller_sounds, caller phone effects, music sync,
 *                        turn management.
 *
 *   OpenClaw handles:    LLM reasoning (GLM-4.7 via Clawdbot Gateway),
 *                        canvas creation, file ops, code execution,
 *                        memory, web search, VPS control — everything.
 *
 * The bridge: ElevenLabs is configured with a custom LLM endpoint
 * (POST /api/elevenlabs-llm on our Flask server) instead of its built-in
 * model.  Our server receives the conversation context, forwards the last
 * user message to OpenClaw via the persistent Gateway WebSocket, streams
 * the response back to ElevenLabs in OpenAI-compatible SSE format.
 *
 * Canvas side-channel: OpenClaw embeds {canvas:present,url:...} markers in
 * its responses.  The server strips them from the spoken text before
 * returning to ElevenLabs (so Pi-Guy doesn't read HTML aloud) and stores
 * them in a queue.  This adapter polls /api/canvas-pending every second and
 * emits CANVAS_CMD events so the shell loads the iframe.
 *
 * Ref: future-dev-plans/16-ELEVENLABS-OPENCLAW-HYBRID.md
 * Ref: future-dev-plans/15-ELEVENLABS-CLASSIC-AGENT.md  (classic base)
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md
 *
 * Adapter contract (same as all adapters):
 *   init(bridge, config)  — called when mode is selected
 *   start()               — called when user clicks call button
 *   stop()                — graceful disconnect
 *   destroy()             — full teardown on adapter switch
 *
 * Config shape:
 *   {
 *     agentId:      string,   // Hybrid ElevenLabs agent ID (custom LLM configured)
 *     serverUrl:    string,   // Flask server base URL
 *     musicPlayer:  object,   // optional — shared MusicPlayer instance
 *     pollInterval: number,   // ms between canvas polls (default 1000)
 *   }
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@latest/+esm';

/** DJ sound names the agent can play silently */
const DJ_SOUND_LIST = [
    'air_horn', 'air_horn_long', 'siren', 'siren_woop', 'scratch', 'scratch_long',
    'rewind', 'record_stop', 'whoosh', 'riser', 'bass_drop', 'impact',
    'crowd_cheer', 'crowd_hype', 'applause', 'yeah', 'lets_go', 'laser',
    'gunshot', 'explosion', 'vinyl_crackle',
];

/** Music keywords that trigger server-side music sync */
const MUSIC_KEYWORDS_RE = /\b(spinning|playing|next up|coming up|dropping|fire up|switching|change it up)\b/i;

/** Commercial keywords that trigger the ad break system */
const COMMERCIAL_KEYWORDS_RE = /\b(commercial|sponsor|ad break|word from our|brought to you)\b/i;

/** XML tags that indicate a caller persona (enable phone filter) */
const CALLER_PATTERNS = [
    /<caller\s*1>/i,
    /<caller\s*2>/i,
    /<mike[\-\s]*voice>/i,
    /<caller\s*voice>/i,
    /<phone\s*voice>/i,
];

/** XML tags that indicate a non-caller persona (disable phone filter) */
const NON_CALLER_PATTERNS = [
    /<radio\s*voice>/i,
    /<kitt[\-\s]*voice>/i,
    /<dj[\-\s]*soul>/i,
];

const DEFAULT_POLL_INTERVAL_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────

const ElevenLabsHybridAdapter = {

    // ── Identity & capabilities ───────────────────────────────────────────────

    name: 'ElevenLabs + OpenClaw Hybrid',

    /**
     * Feature flags: the shell shows/hides UI elements based on this array.
     *
     * Union of ElevenLabs Classic capabilities (voice/audio) + ClawdBot
     * capabilities (VPS/canvas/files) — the best of both worlds.
     */
    capabilities: [
        // Voice (from ElevenLabs)
        'multi_voice',
        'dj_soundboard',
        'caller_effects',
        'caller_sounds',
        'music_sync',
        'commercials',
        // Brain (from OpenClaw via custom LLM)
        'canvas',
        'vps_control',
        'file_ops',
        'code_execution',
    ],

    // ── Private state ─────────────────────────────────────────────────────────

    _bridge:             null,
    _config:             null,
    _conversation:       null,   // ElevenLabs Conversation session
    _sdk:                null,   // { Conversation } from @elevenlabs/client

    // Web Audio API caller phone effect chain
    _audioContext:       null,
    _elevenLabsSource:   null,
    _callerNodes:        null,
    _callerEffectActive: false,
    _audioObserver:      null,

    // Music sync debounce
    _lastSyncTime:       0,
    _syncClearTimer:     null,

    // DJ transition tracking
    _djTransitionTriggered: false,

    // Caller sounds cooldown
    _callerSoundCooldown: false,

    // Preloaded DJ sound blob URLs
    _djSoundCache:       {},

    // Commercial state
    _commercialPlaying:  false,
    _commercialPlayer:   null,

    // Canvas command polling (the hybrid side-channel)
    _canvasPoller:       null,

    // Bridge / bus unsubscribe cleanup
    _unsubscribers:      [],

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Initialize the adapter.
     *
     * Loads the ElevenLabs SDK, sets up the Web Audio API caller effect
     * chain, starts canvas command polling, and subscribes to bridge actions.
     *
     * @param {import('../core/EventBridge.js').EventBridge} bridge
     * @param {object} config
     */
    async init(bridge, config) {
        this._bridge = bridge;
        this._config = config || {};

        // Load ElevenLabs SDK from CDN
        if (!this._sdk) {
            try {
                this._sdk = await import(SDK_URL);
            } catch (err) {
                console.error('[ElevenLabsHybrid] Failed to load SDK:', err);
                bridge.emit(AgentEvents.ERROR, { message: 'Failed to load ElevenLabs SDK' });
                return;
            }
        }

        // Build caller phone effect audio chain (identical to Classic adapter)
        this._initAudioPipeline();

        // Watch for unnamed <audio> elements that ElevenLabs creates for TTS
        this._initAudioObserver();

        // Preload frequently used DJ sounds as blob URLs (non-fatal if it fails)
        this._preloadDJSounds();

        // Start polling /api/canvas-pending for OpenClaw canvas side-channel
        this._startCanvasPolling();

        // Subscribe to UI→Agent bridge actions
        this._unsubscribers.push(
            bridge.on(AgentActions.END_SESSION,    ()  => this.stop()),
            bridge.on(AgentActions.CONTEXT_UPDATE, (d) => this._sendContextUpdate(d.text)),
            bridge.on(AgentActions.FORCE_MESSAGE,  (d) => this._sendForceMessage(d.text)),
        );
    },

    /**
     * Start the conversation.
     * Unlocks iOS AudioContext → requests+releases mic → starts ElevenLabs session.
     */
    async start() {
        if (!this._sdk) {
            console.error('[ElevenLabsHybrid] SDK not loaded — cannot start');
            return;
        }
        if (this._conversation) {
            console.warn('[ElevenLabsHybrid] Already connected');
            return;
        }

        // iOS: request mic then immediately release before startSession()
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
        } catch (err) {
            console.warn('[ElevenLabsHybrid] Mic pre-unlock failed:', err);
        }

        // Resume AudioContext (must be triggered by a user gesture)
        if (this._audioContext && this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
        }

        const agentId = this._config.agentId;
        if (!agentId) {
            this._bridge.emit(AgentEvents.ERROR, {
                message: 'ElevenLabsHybrid: agentId not configured — set ELEVENLABS_HYBRID_AGENT_ID in .env',
            });
            return;
        }

        try {
            this._conversation = await this._sdk.Conversation.startSession({
                agentId,
                overrides: {},
                // Only two client tools — OpenClaw handles everything else via custom LLM
                clientTools: {
                    dj_soundboard: (params) => this._clientToolDJSoundboard(params),
                    caller_sounds:  (params) => this._clientToolCallerSounds(params),
                },
                onConnect:    ()     => this._onConnect(),
                onDisconnect: ()     => this._onDisconnect(),
                onError:      (err)  => this._onError(err),
                onModeChange: (mode) => this._onModeChange(mode),
                onMessage:    (msg)  => this._onMessage(msg),
            });
        } catch (err) {
            console.error('[ElevenLabsHybrid] startSession failed:', err);
            this._bridge.emit(AgentEvents.ERROR, { message: String(err) });
            this._bridge.emit(AgentEvents.MOOD, { mood: 'sad' });
        }
    },

    /** Stop conversation gracefully. */
    async stop() {
        if (this._conversation) {
            try { await this._conversation.endSession(); } catch (_) { /* ignore */ }
            this._conversation = null;
        }
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
        this._bridge.emit(AgentEvents.DISCONNECTED);
        this._bridge.emit(AgentEvents.MOOD, { mood: 'neutral' });
    },

    /** Full teardown on adapter switch — MUST release all resources. */
    async destroy() {
        // Stop ElevenLabs session
        if (this._conversation) {
            try { await this._conversation.endSession(); } catch (_) { /* ignore */ }
            this._conversation = null;
        }

        // Stop canvas polling
        this._stopCanvasPolling();

        // Stop MutationObserver
        if (this._audioObserver) {
            this._audioObserver.disconnect();
            this._audioObserver = null;
        }

        // Close AudioContext
        if (this._audioContext && this._audioContext.state !== 'closed') {
            try { await this._audioContext.close(); } catch (_) { /* ignore */ }
        }
        this._audioContext       = null;
        this._elevenLabsSource   = null;
        this._callerNodes        = null;
        this._callerEffectActive = false;

        // Revoke preloaded blob URLs
        Object.values(this._djSoundCache).forEach(url => {
            try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
        });
        this._djSoundCache = {};

        // Stop commercial player
        if (this._commercialPlayer) {
            this._commercialPlayer.pause();
            this._commercialPlayer.src = '';
            this._commercialPlayer = null;
        }
        this._commercialPlaying = false;

        // Clear timers
        clearTimeout(this._syncClearTimer);

        // Unsubscribe bridge listeners
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];

        this._bridge = null;
        this._config = null;
    },

    // ── ElevenLabs SDK callbacks ──────────────────────────────────────────────

    _onConnect() {
        console.log('[ElevenLabsHybrid] Connected (ElevenLabs SDK → custom LLM → OpenClaw)');
        this._bridge.emit(AgentEvents.CONNECTED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        this._bridge.emit(AgentEvents.MOOD, { mood: 'happy' });
    },

    _onDisconnect() {
        console.log('[ElevenLabsHybrid] Disconnected');
        this._conversation = null;
        this._bridge.emit(AgentEvents.DISCONNECTED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
        this._bridge.emit(AgentEvents.MOOD, { mood: 'neutral' });
        if (this._config.musicPlayer) {
            this._config.musicPlayer.duck(false);
        }
    },

    _onError(error) {
        console.error('[ElevenLabsHybrid] Error:', error);
        this._bridge.emit(AgentEvents.ERROR, { message: String(error) });
        this._bridge.emit(AgentEvents.MOOD, { mood: 'sad' });
    },

    /** onModeChange fires when ElevenLabs switches speaking ↔ listening. */
    _onModeChange({ mode }) {
        if (mode === 'speaking') {
            this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'speaking' });
            this._bridge.emit(AgentEvents.TTS_PLAYING);
            if (this._config.musicPlayer) {
                this._config.musicPlayer.duck(true);
            }
        } else {
            // listening
            this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
            this._bridge.emit(AgentEvents.TTS_STOPPED);
            this._bridge.emit(AgentEvents.MOOD, { mood: 'listening' });
            if (this._config.musicPlayer) {
                this._config.musicPlayer.duck(false);
            }
        }
    },

    /**
     * onMessage handles ALL ElevenLabs agent messages and tool responses.
     * Routing order mirrors ElevenLabsClassicAdapter._onMessage (APPENDIX A.2).
     *
     * Note: canvas commands are handled by the polling side-channel
     * (_startCanvasPolling), NOT by text detection here — the server strips
     * {canvas:...} markers from the spoken text before ElevenLabs sees it.
     */
    _onMessage(message) {
        // ── 1. Tool response detection ────────────────────────────────────────
        let toolName   = null;
        let toolResult = null;

        if (message.source === 'ai' && message.message?.toolResult) {
            toolName   = message.message.toolResult.toolName;
            toolResult = message.message.toolResult.result;
        }

        if (toolName) {
            // dj_soundboard
            if (toolName === 'dj_soundboard') {
                try {
                    const parsed = JSON.parse(toolResult);
                    if (parsed.sound) this._playDJSound(parsed.sound);
                } catch (_) { /* not JSON */ }
                this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
                return;
            }

            // play_music
            if (toolName === 'play_music') {
                try {
                    const parsed = JSON.parse(toolResult);
                    const action = parsed.action || 'play';
                    if (action === 'stop') {
                        this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'stop' });
                    } else if (action === 'pause') {
                        this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'pause' });
                    } else {
                        this._syncMusicWithServer();
                    }
                } catch (_) {
                    this._syncMusicWithServer();
                }
                this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
                return;
            }

            // play_commercial
            if (toolName === 'play_commercial') {
                this._playCommercial();
                this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
                return;
            }

            // generate_song
            if (toolName === 'generate_song') {
                try {
                    const parsed = JSON.parse(toolResult);
                    if (parsed.song_id) {
                        this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'generated', songId: parsed.song_id });
                    }
                } catch (_) { /* ignore */ }
                this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
                return;
            }

            // Generic tool — show in ActionConsole
            this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
            return;
        }

        // ── 2. Display in transcript ──────────────────────────────────────────
        const text = message.message?.text || '';
        if (text) {
            const role = message.source === 'user' ? 'user' : 'assistant';
            this._bridge.emit(AgentEvents.MESSAGE, { role, text, final: true });
        }

        if (message.source !== 'ai' || !text) return;

        // ── 3. Caller voice detection ─────────────────────────────────────────
        const isCallerVoice = CALLER_PATTERNS.some(re => re.test(text));
        const isNormalVoice = NON_CALLER_PATTERNS.some(re => re.test(text));

        if (isCallerVoice) {
            this._setCallerEffect(true);
        } else if (isNormalVoice) {
            this._setCallerEffect(false);
        }

        // ── 4. Music keyword detection ────────────────────────────────────────
        if (MUSIC_KEYWORDS_RE.test(text) && !this._callerEffectActive) {
            this._syncMusicWithServer();
        }

        // ── 5. Commercial keyword detection ──────────────────────────────────
        if (COMMERCIAL_KEYWORDS_RE.test(text) && !this._commercialPlaying) {
            this._playCommercial();
        }
    },

    // ── Canvas Side-Channel Polling ───────────────────────────────────────────

    /**
     * Poll /api/canvas-pending every second for canvas commands from OpenClaw.
     *
     * OpenClaw embeds {canvas:present,url:...} markers in responses.  The
     * custom LLM endpoint strips them from the spoken text and queues them
     * server-side.  We fetch and consume the queue here, emitting CANVAS_CMD
     * events for the shell.
     *
     * Ref: doc 16 — "Canvas Integration in Hybrid Mode"
     */
    _startCanvasPolling() {
        if (this._canvasPoller) return;

        const intervalMs = this._config.pollInterval || DEFAULT_POLL_INTERVAL_MS;
        const serverUrl  = this._config.serverUrl || '';

        this._canvasPoller = setInterval(async () => {
            try {
                const resp = await fetch(`${serverUrl}/api/canvas-pending`);
                if (!resp.ok) return;
                const data = await resp.json();
                const commands = data.commands || [];
                for (const cmd of commands) {
                    if (cmd.action === 'present' && cmd.url) {
                        this._bridge.emit(AgentEvents.CANVAS_CMD, {
                            action: 'present',
                            url:    cmd.url,
                        });
                    } else if (cmd.action === 'close') {
                        this._bridge.emit(AgentEvents.CANVAS_CMD, { action: 'close' });
                    }
                }
            } catch (_) {
                // Non-fatal — server may not be running /api/canvas-pending yet
            }
        }, intervalMs);
    },

    _stopCanvasPolling() {
        if (this._canvasPoller) {
            clearInterval(this._canvasPoller);
            this._canvasPoller = null;
        }
    },

    // ── Client Tools ──────────────────────────────────────────────────────────

    /** Client tool: dj_soundboard — plays sounds silently in browser. */
    async _clientToolDJSoundboard(parameters) {
        const action = parameters.action || 'list';
        const sound  = parameters.sound  || '';

        if (action === 'play' && sound) {
            await this._playDJSound(sound);
            return `*${sound.replace(/_/g, ' ')}* 🎵`;
        }
        if (action === 'list') {
            return JSON.stringify(DJ_SOUND_LIST);
        }
        return 'Unknown action';
    },

    /**
     * Client tool: caller_sounds — plays dial tone before caller voice switch.
     * dial_tone = double beep with 400ms gap.  5s cooldown prevents spam.
     */
    async _clientToolCallerSounds(parameters) {
        const action = parameters.action || 'play';
        const sound  = parameters.sound  || 'dial_tone';

        if (action === 'list') {
            return JSON.stringify(['dial_tone', 'ring', 'pickup', 'hangup']);
        }
        if (action === 'play') {
            await this._playCallerSound(sound);
            return `*Phone sound: ${sound}* 📞`;
        }
        return 'Unknown action';
    },

    // ── Audio Pipeline ────────────────────────────────────────────────────────

    /**
     * Build the Web Audio API context and caller phone effect filter chain.
     *
     * HighPass(500Hz) → LowPass(2200Hz) → PeakingEQ(1200Hz, +6dB)
     *   → Compressor(-30dB, 16:1) → WaveShaper(25) → Gain(0.7) → Destination
     *
     * Identical to ElevenLabsClassicAdapter — shared audio system design.
     */
    _initAudioPipeline() {
        if (this._audioContext) return;

        try {
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this._audioContext;

            const highPass = ctx.createBiquadFilter();
            highPass.type             = 'highpass';
            highPass.frequency.value  = 500;
            highPass.Q.value          = 1.5;

            const lowPass = ctx.createBiquadFilter();
            lowPass.type              = 'lowpass';
            lowPass.frequency.value   = 2200;
            lowPass.Q.value           = 1.5;

            const midBoost = ctx.createBiquadFilter();
            midBoost.type             = 'peaking';
            midBoost.frequency.value  = 1200;
            midBoost.gain.value       = 6;

            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -30;
            compressor.ratio.value     = 16;
            compressor.attack.value    = 0.002;
            compressor.release.value   = 0.2;

            const distortion = ctx.createWaveShaper();
            distortion.curve = this._makeDistortionCurve(25);

            const outputGain = ctx.createGain();
            outputGain.gain.value = 0.7;

            // Chain: highPass → lowPass → midBoost → compressor → distortion → outputGain → dest
            highPass.connect(lowPass);
            lowPass.connect(midBoost);
            midBoost.connect(compressor);
            compressor.connect(distortion);
            distortion.connect(outputGain);
            outputGain.connect(ctx.destination);

            const bypassGain = ctx.createGain();
            bypassGain.gain.value = 1;
            bypassGain.connect(ctx.destination);

            this._callerNodes = { input: highPass, output: outputGain, bypassGain, effectOutput: outputGain };
        } catch (err) {
            console.warn('[ElevenLabsHybrid] AudioContext init failed:', err);
        }
    },

    /** MutationObserver — hooks unnamed <audio> elements ElevenLabs creates for TTS. */
    _initAudioObserver() {
        if (this._audioObserver) return;

        this._audioObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.tagName === 'AUDIO' && !node.id && !node.dataset.hybridHooked) {
                        this._hookElevenLabsAudio(node);
                    }
                });
            });
        });

        this._audioObserver.observe(document.body, { childList: true, subtree: true });
    },

    /** Hook a single ElevenLabs TTS <audio> element into the Web Audio API chain. */
    _hookElevenLabsAudio(audioElement) {
        if (!this._audioContext || !this._callerNodes) return;
        try {
            audioElement.dataset.hybridHooked = 'true';
            this._elevenLabsSource = this._audioContext.createMediaElementSource(audioElement);
            this._elevenLabsSource.connect(this._callerNodes.bypassGain);

            if (this._callerEffectActive) {
                this._elevenLabsSource.disconnect();
                this._elevenLabsSource.connect(this._callerNodes.input);
            }
        } catch (err) {
            console.warn('[ElevenLabsHybrid] hookElevenLabsAudio failed:', err);
        }
    },

    /** Enable or disable the caller phone filter effect. */
    _setCallerEffect(enabled) {
        this._callerEffectActive = enabled;
        this._bridge.emit(AgentEvents.CALLER_EFFECT, { enabled });

        if (!this._elevenLabsSource || !this._callerNodes) return;
        try {
            this._elevenLabsSource.disconnect();
            if (enabled) {
                this._elevenLabsSource.connect(this._callerNodes.input);
            } else {
                this._elevenLabsSource.connect(this._callerNodes.bypassGain);
            }
        } catch (err) {
            console.warn('[ElevenLabsHybrid] setCallerEffect failed:', err);
        }
    },

    _makeDistortionCurve(amount) {
        const n_samples = 256;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    },

    // ── DJ Sounds ─────────────────────────────────────────────────────────────

    async _preloadDJSounds() {
        const serverUrl = this._config.serverUrl || '';
        const toPreload = [
            'air_horn', 'scratch_long', 'crowd_cheer', 'crowd_hype',
            'rewind', 'yeah', 'laser', 'lets_go', 'impact', 'record_stop',
        ];
        await Promise.allSettled(
            toPreload.map(async (name) => {
                try {
                    const res = await fetch(`${serverUrl}/sounds/dj/${name}.mp3`);
                    if (res.ok) {
                        const blob = await res.blob();
                        this._djSoundCache[name] = URL.createObjectURL(blob);
                    }
                } catch (_) { /* non-fatal */ }
            })
        );
    },

    async _playDJSound(soundName) {
        const serverUrl = this._config.serverUrl || '';
        const src = this._djSoundCache[soundName] || `${serverUrl}/sounds/dj/${soundName}.mp3`;
        const audio = new Audio(src);
        audio.volume = 1.0;
        try { await audio.play(); } catch (err) {
            console.warn(`[ElevenLabsHybrid] playDJSound(${soundName}) failed:`, err);
        }
        this._bridge.emit(AgentEvents.PLAY_SOUND, { sound: soundName, type: 'dj' });
    },

    async _playCallerSound(sound) {
        if (this._callerSoundCooldown) return;
        this._callerSoundCooldown = true;
        setTimeout(() => { this._callerSoundCooldown = false; }, 5000);

        const serverUrl = this._config.serverUrl || '';
        const src = `${serverUrl}/sounds/caller/${sound}.mp3`;
        this._bridge.emit(AgentEvents.PLAY_SOUND, { sound, type: 'caller' });

        if (sound === 'dial_tone') {
            for (let i = 0; i < 2; i++) {
                if (i > 0) await this._sleep(400);
                const audio = new Audio(src);
                try { await audio.play(); } catch (_) { /* ignore */ }
                await this._sleep(800);
            }
        } else {
            const audio = new Audio(src);
            try { await audio.play(); } catch (_) { /* ignore */ }
        }
    },

    // ── Music Sync ────────────────────────────────────────────────────────────

    /** Sync music with server state (2s debounce, blocked during caller/commercial). */
    _syncMusicWithServer() {
        const now = Date.now();
        if (now - this._lastSyncTime < 2000) return;
        if (this._callerEffectActive) return;
        if (this._commercialPlaying) return;

        this._lastSyncTime = now;
        this._bridge.emit(AgentEvents.MUSIC_SYNC);

        clearTimeout(this._syncClearTimer);
        this._syncClearTimer = setTimeout(() => {}, 30000);
    },

    // ── DJ Transition Alert ───────────────────────────────────────────────────

    /** Called by shell's MusicPlayer when a track has ≤12 seconds remaining. */
    onTrackEndingSoon() {
        if (this._djTransitionTriggered || !this._conversation) return;
        this._djTransitionTriggered = true;
        this._sendContextUpdate('[DJ INFO: track ending in 10s]');
        this._sendForceMessage('[SYSTEM: Song ending! Announce next and call play_music action=skip!]');
    },

    onTrackEnded() {
        this._djTransitionTriggered = false;
    },

    // ── Commercial System ─────────────────────────────────────────────────────

    async _playCommercial() {
        if (this._commercialPlaying) return;
        this._commercialPlaying = true;

        const serverUrl = this._config.serverUrl || '';
        this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'stop' });

        try {
            const res  = await fetch(`${serverUrl}/api/commercials?action=play`);
            const data = await res.json();

            if (data.url) {
                this._commercialPlayer = new Audio(data.url);
                this._sendContextUpdate('[DJ INFO: Commercial playing, stay quiet]');
                await fetch(`${serverUrl}/api/commercials?action=confirm_started`);

                this._commercialPlayer.addEventListener('ended', async () => {
                    this._commercialPlaying = false;
                    await fetch(`${serverUrl}/api/commercials?action=ended`);
                    this._sendForceMessage("[SYSTEM: Commercial over! Say we're back and play next!");
                });

                await this._commercialPlayer.play();
            } else {
                this._commercialPlaying = false;
            }
        } catch (err) {
            console.warn('[ElevenLabsHybrid] playCommercial failed:', err);
            this._commercialPlaying = false;
        }
    },

    // ── ElevenLabs context injection ──────────────────────────────────────────

    _sendContextUpdate(text) {
        if (!this._conversation) return;
        try { this._conversation.sendContextualUpdate(text); }
        catch (err) { console.warn('[ElevenLabsHybrid] sendContextualUpdate failed:', err); }
    },

    _sendForceMessage(text) {
        if (!this._conversation) return;
        try { this._conversation.sendUserMessage(text); }
        catch (err) { console.warn('[ElevenLabsHybrid] sendForceMessage failed:', err); }
    },

    // ── Utilities ─────────────────────────────────────────────────────────────

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};

export default ElevenLabsHybridAdapter;
export { ElevenLabsHybridAdapter };
