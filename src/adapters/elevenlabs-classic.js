/**
 * ElevenLabsClassicAdapter — Multi-Agent Framework adapter for ElevenLabs Conversational AI (P7-T4)
 *
 * Ports the battle-tested ElevenLabs setup from ai-eyes v1 into ai-eyes2's
 * adapter framework. When selected, this adapter:
 *
 *  - Connects to an ElevenLabs agent via the official @elevenlabs/client SDK
 *  - Registers two client tools: dj_soundboard and caller_sounds
 *  - Hooks ElevenLabs TTS audio elements via MutationObserver for the Web Audio API
 *    caller phone filter chain
 *  - Detects caller voice XML tags (<Caller 1>, <Caller 2>, <MIke-Voice>) and enables
 *    the phone filter effect automatically
 *  - Detects music keywords in agent speech and triggers server-side music sync
 *  - Handles the track-end DJ transition alert (send context update when ≤12s remaining)
 *  - Handles the commercial system (stop music, play ad, resume)
 *  - Exposes sendContextualUpdate / sendUserMessage via the EventBridge FORCE_MESSAGE /
 *    CONTEXT_UPDATE actions
 *
 * Ref: future-dev-plans/15-ELEVENLABS-CLASSIC-AGENT.md
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md
 *
 * Adapter contract:
 *   init(bridge, config)  — called when mode is selected
 *   start()               — called when user clicks call button (unlocks iOS mic first)
 *   stop()                — graceful disconnect
 *   destroy()             — full teardown on adapter switch
 *
 * Config shape:
 *   {
 *     agentId:     string,  // ElevenLabs agent ID — default: your-elevenlabs-agent-id
 *     serverUrl:   string,  // Flask server base URL for webhook endpoints
 *     musicPlayer: object,  // optional — shared MusicPlayer instance from shell
 *   }
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@latest/+esm';

const DEFAULT_AGENT_ID = 'your-elevenlabs-agent-id';

/** DJ sounds the agent can play silently in the browser */
const DJ_SOUND_LIST = [
    'air_horn', 'air_horn_long', 'siren', 'siren_woop', 'scratch', 'scratch_long',
    'rewind', 'record_stop', 'whoosh', 'riser', 'bass_drop', 'impact',
    'crowd_cheer', 'crowd_hype', 'applause', 'yeah', 'lets_go', 'laser',
    'gunshot', 'explosion', 'vinyl_crackle',
];

/** Music-keyword regex — triggers syncMusicWithServer() when agent speaks these */
const MUSIC_KEYWORDS_RE = /\b(spinning|playing|next up|coming up|dropping|fire up|switching|change it up)\b/i;

/** Commercial-keyword regex — triggers playCommercial() */
const COMMERCIAL_KEYWORDS_RE = /\b(commercial|sponsor|ad break|word from our|brought to you)\b/i;

/** Caller voice XML tag patterns → enable phone filter */
const CALLER_PATTERNS = [
    /<caller\s*1>/i,
    /<caller\s*2>/i,
    /<mike[\-\s]*voice>/i,
    /<caller\s*voice>/i,
    /<phone\s*voice>/i,
];

/** Voice tags that revert to normal (non-caller) audio */
const NON_CALLER_PATTERNS = [
    /<radio\s*voice>/i,
    /<kitt[\-\s]*voice>/i,
    /<dj[\-\s]*soul>/i,
];

// ─────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────

const ElevenLabsClassicAdapter = {

    // ── Identity & capabilities ───────────────────────────────────────────────

    name: 'ElevenLabs Classic (Pi-Guy)',

    /** Feature flags: shell shows/hides UI elements based on this array */
    capabilities: [
        'multi_voice',       // 7 ElevenLabs voices / personas
        'dj_soundboard',     // client tool: dj_soundboard
        'caller_effects',    // phone filter audio chain
        'caller_sounds',     // client tool: caller_sounds (dial tone)
        'music_sync',        // music keyword detection + server sync
        'commercials',       // commercial keyword detection
        'wake_word',         // Web Speech wake word + SSE Pi trigger
    ],

    // ── Private state ─────────────────────────────────────────────────────────

    _bridge:             null,   // EventBridge singleton
    _config:             null,
    _conversation:       null,   // ElevenLabs Conversation session object
    _sdk:                null,   // { Conversation } from @elevenlabs/client

    // Audio chain
    _audioContext:       null,
    _elevenLabsSource:   null,   // MediaElementSource for current TTS audio element
    _callerNodes:        null,   // { input, output, bypassGain, effectOutput }
    _callerEffectActive: false,
    _audioObserver:      null,   // MutationObserver for unnamed <audio> elements

    // Music sync debounce
    _lastSyncTime:       0,
    _lastSyncedTrack:    null,
    _syncClearTimer:     null,

    // DJ transition
    _djTransitionTriggered: false,

    // Caller sounds cooldown
    _callerSoundCooldown: false,

    // Preloaded DJ sound blob URLs
    _djSoundCache:       {},     // { soundName: blobUrl }

    // Commercial state
    _commercialPlaying:  false,
    _commercialPlayer:   null,

    // Bridge unsub functions
    _unsubscribers:      [],

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Initialize the adapter.
     * Loads the SDK, builds the audio pipeline, preloads DJ sounds.
     *
     * @param {import('../core/EventBridge.js').EventBridge} bridge
     * @param {object} config
     */
    async init(bridge, config) {
        this._bridge = bridge;
        this._config = config || {};

        // Load ElevenLabs SDK (dynamic import from CDN)
        if (!this._sdk) {
            try {
                this._sdk = await import(SDK_URL);
            } catch (err) {
                console.error('[ElevenLabsClassic] Failed to load SDK:', err);
                bridge.emit(AgentEvents.ERROR, { message: 'Failed to load ElevenLabs SDK' });
                return;
            }
        }

        // Build Web Audio API caller phone effect chain
        this._initAudioPipeline();

        // Set up MutationObserver to hook unnamed <audio> elements ElevenLabs creates
        this._initAudioObserver();

        // Preload DJ sounds (fire-and-forget — failures are non-fatal)
        this._preloadDJSounds();

        // Subscribe to UI → Agent actions
        this._unsubscribers.push(
            bridge.on(AgentActions.END_SESSION,    () => this.stop()),
            bridge.on(AgentActions.CONTEXT_UPDATE, (d) => this._sendContextUpdate(d.text)),
            bridge.on(AgentActions.FORCE_MESSAGE,  (d) => this._sendForceMessage(d.text)),
        );
    },

    /**
     * Start conversation.
     * Unlocks iOS AudioContext → requests+releases mic → calls Conversation.startSession().
     */
    async start() {
        if (!this._sdk) {
            console.error('[ElevenLabsClassic] SDK not loaded');
            return;
        }
        if (this._conversation) {
            console.warn('[ElevenLabsClassic] Already connected');
            return;
        }

        // iOS: must request mic then release it BEFORE startSession() (exclusive access)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
        } catch (err) {
            console.warn('[ElevenLabsClassic] Mic pre-unlock failed (may be fine on desktop):', err);
        }

        // Resume AudioContext (must be triggered by user gesture)
        if (this._audioContext && this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
        }

        const agentId = this._config.agentId || DEFAULT_AGENT_ID;

        try {
            this._conversation = await this._sdk.Conversation.startSession({
                agentId,
                overrides: {},
                clientTools: {
                    dj_soundboard:  (params) => this._clientToolDJSoundboard(params),
                    caller_sounds:  (params) => this._clientToolCallerSounds(params),
                },
                onConnect:    ()      => this._onConnect(),
                onDisconnect: ()      => this._onDisconnect(),
                onError:      (err)   => this._onError(err),
                onModeChange: (mode)  => this._onModeChange(mode),
                onMessage:    (msg)   => this._onMessage(msg),
            });
        } catch (err) {
            console.error('[ElevenLabsClassic] startSession failed:', err);
            this._bridge.emit(AgentEvents.ERROR, { message: String(err) });
            this._bridge.emit(AgentEvents.MOOD, { mood: 'sad' });
        }
    },

    /**
     * Stop conversation gracefully.
     */
    async stop() {
        if (this._conversation) {
            try {
                await this._conversation.endSession();
            } catch (_) { /* ignore */ }
            this._conversation = null;
        }
        // onDisconnect callback fires and emits events, but ensure state even if it doesn't
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
        this._bridge.emit(AgentEvents.DISCONNECTED);
        this._bridge.emit(AgentEvents.MOOD,         { mood: 'neutral' });
    },

    /**
     * Full teardown on adapter switch. MUST release all resources.
     */
    async destroy() {
        // Stop conversation
        if (this._conversation) {
            try { await this._conversation.endSession(); } catch (_) { /* ignore */ }
            this._conversation = null;
        }

        // Stop MutationObserver
        if (this._audioObserver) {
            this._audioObserver.disconnect();
            this._audioObserver = null;
        }

        // Close AudioContext
        if (this._audioContext && this._audioContext.state !== 'closed') {
            try { await this._audioContext.close(); } catch (_) { /* ignore */ }
        }
        this._audioContext        = null;
        this._elevenLabsSource    = null;
        this._callerNodes         = null;
        this._callerEffectActive  = false;

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
        console.log('[ElevenLabsClassic] Connected');
        this._bridge.emit(AgentEvents.CONNECTED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        this._bridge.emit(AgentEvents.MOOD,          { mood: 'happy' });
    },

    _onDisconnect() {
        console.log('[ElevenLabsClassic] Disconnected');
        this._conversation = null;
        this._bridge.emit(AgentEvents.DISCONNECTED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
        this._bridge.emit(AgentEvents.MOOD,          { mood: 'neutral' });
        // Stop music ducking when agent disconnects
        if (this._config.musicPlayer) {
            this._config.musicPlayer.duck(false);
        }
    },

    _onError(error) {
        console.error('[ElevenLabsClassic] Error:', error);
        this._bridge.emit(AgentEvents.ERROR, { message: String(error) });
        this._bridge.emit(AgentEvents.MOOD,  { mood: 'sad' });
    },

    /**
     * onModeChange fires when ElevenLabs switches between speaking and listening.
     * @param {{ mode: 'speaking'|'listening' }} modeObj
     */
    _onModeChange({ mode }) {
        if (mode === 'speaking') {
            this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'speaking' });
            this._bridge.emit(AgentEvents.TTS_PLAYING);
            // Duck music while agent speaks
            if (this._config.musicPlayer) {
                this._config.musicPlayer.duck(true);
            }
        } else {
            // listening
            this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
            this._bridge.emit(AgentEvents.TTS_STOPPED);
            this._bridge.emit(AgentEvents.MOOD,          { mood: 'listening' });
            if (this._config.musicPlayer) {
                this._config.musicPlayer.duck(false);
            }
        }
    },

    /**
     * onMessage handles ALL agent messages, tool responses, and text.
     * Routing order mirrors ai-eyes (APPENDIX A.2).
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
            // ── 2. dj_soundboard tool ─────────────────────────────────────────
            if (toolName === 'dj_soundboard') {
                try {
                    const parsed = JSON.parse(toolResult);
                    if (parsed.sound) this._playDJSound(parsed.sound);
                } catch (_) { /* not JSON — ignore */ }
                this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
                return;
            }

            // ── 3. play_music tool ────────────────────────────────────────────
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

            // ── 4. play_commercial tool ───────────────────────────────────────
            if (toolName === 'play_commercial') {
                this._playCommercial();
                this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
                return;
            }

            // ── 5. generate_song tool ─────────────────────────────────────────
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

            // Generic tool — emit for ActionConsole
            this._bridge.emit(AgentEvents.TOOL_CALLED, { name: toolName, params: {}, result: toolResult });
            return;
        }

        // ── 6. Display in transcript ──────────────────────────────────────────
        const text = message.message?.text || '';
        if (text) {
            const role = message.source === 'user' ? 'user' : 'assistant';
            this._bridge.emit(AgentEvents.MESSAGE, { role, text, final: true });
        }

        // Only process outgoing agent speech for the following detection
        if (message.source !== 'ai' || !text) return;

        // ── 7. Caller voice detection ─────────────────────────────────────────
        const isCallerVoice = CALLER_PATTERNS.some(re => re.test(text));
        const isNormalVoice = NON_CALLER_PATTERNS.some(re => re.test(text));

        if (isCallerVoice) {
            this._setCallerEffect(true);
        } else if (isNormalVoice) {
            this._setCallerEffect(false);
        }

        // ── 8. Music keyword detection ────────────────────────────────────────
        if (MUSIC_KEYWORDS_RE.test(text) && !this._callerEffectActive) {
            this._syncMusicWithServer();
        }

        // ── 9. Commercial keyword detection ───────────────────────────────────
        if (COMMERCIAL_KEYWORDS_RE.test(text) && !this._commercialPlaying) {
            this._playCommercial();
        }
    },

    // ── Client Tools ──────────────────────────────────────────────────────────

    /**
     * Client tool: dj_soundboard
     * Plays sound effects in the browser silently (no spoken words).
     */
    async _clientToolDJSoundboard(parameters) {
        const action = parameters.action || 'list';
        const sound  = parameters.sound  || '';

        if (action === 'play' && sound) {
            await this._playDJSound(sound);
            const desc = sound.replace(/_/g, ' ');
            return `*${desc}* 🎵`;
        }
        if (action === 'list') {
            return JSON.stringify(DJ_SOUND_LIST);
        }
        return 'Unknown action';
    },

    /**
     * Client tool: caller_sounds
     * Plays dial tone (double beep) before voice switch to caller persona.
     * Critical timing: must fire BEFORE the caller XML voice tag.
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
     * Create the Web Audio API context and caller phone effect filter chain.
     *
     * Chain: HighPass(500Hz) → LowPass(2200Hz) → PeakingEQ(1200Hz, +6dB)
     *        → Compressor(-30dB, 16:1) → WaveShaper(25) → Gain(0.7) → Destination
     *
     * Source: ai-eyes/index.html lines 5456-5629
     */
    _initAudioPipeline() {
        if (this._audioContext) return;

        try {
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this._audioContext;

            // ── Effect chain nodes ──────────────────────────────────────────────
            const highPass = ctx.createBiquadFilter();
            highPass.type  = 'highpass';
            highPass.frequency.value = 500;
            highPass.Q.value         = 1.5;

            const lowPass = ctx.createBiquadFilter();
            lowPass.type  = 'lowpass';
            lowPass.frequency.value = 2200;
            lowPass.Q.value         = 1.5;

            const midBoost = ctx.createBiquadFilter();
            midBoost.type  = 'peaking';
            midBoost.frequency.value = 1200;
            midBoost.gain.value      = 6;

            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -30;
            compressor.ratio.value     = 16;
            compressor.attack.value    = 0.002;
            compressor.release.value   = 0.2;

            // WaveShaper distortion
            const distortion = ctx.createWaveShaper();
            distortion.curve = this._makeDistortionCurve(25);

            const outputGain = ctx.createGain();
            outputGain.gain.value = 0.7;

            // Chain: highPass → lowPass → midBoost → compressor → distortion → outputGain
            highPass.connect(lowPass);
            lowPass.connect(midBoost);
            midBoost.connect(compressor);
            compressor.connect(distortion);
            distortion.connect(outputGain);
            outputGain.connect(ctx.destination);

            // Bypass gain (direct path — used when caller effect is off)
            const bypassGain = ctx.createGain();
            bypassGain.gain.value = 1;
            bypassGain.connect(ctx.destination);

            this._callerNodes = {
                input:       highPass,
                output:      outputGain,
                bypassGain,
                effectOutput: outputGain,
            };
        } catch (err) {
            console.warn('[ElevenLabsClassic] AudioContext init failed:', err);
        }
    },

    /**
     * MutationObserver — hooks unnamed <audio> elements ElevenLabs creates for TTS.
     * ElevenLabs creates a new <audio> element per TTS chunk; we intercept each one.
     */
    _initAudioObserver() {
        if (this._audioObserver) return;

        this._audioObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.tagName === 'AUDIO' && !node.id && !node.dataset.callerHooked) {
                        this._hookElevenLabsAudio(node);
                    }
                });
            });
        });

        this._audioObserver.observe(document.body, { childList: true, subtree: true });
    },

    /**
     * Hook a single ElevenLabs TTS <audio> element into the Web Audio API chain.
     * Source: ai-eyes/index.html lines 5548-5583
     */
    _hookElevenLabsAudio(audioElement) {
        if (!this._audioContext || !this._callerNodes) return;

        try {
            audioElement.dataset.callerHooked = 'true';
            this._elevenLabsSource = this._audioContext.createMediaElementSource(audioElement);

            // Default route: through bypass (direct to destination)
            this._elevenLabsSource.connect(this._callerNodes.bypassGain);

            // If caller effect is already active when a new chunk arrives, re-route immediately
            if (this._callerEffectActive) {
                this._elevenLabsSource.disconnect();
                this._elevenLabsSource.connect(this._callerNodes.input);
            }
        } catch (err) {
            // AudioContext limit: one createMediaElementSource per element
            // ElevenLabs sometimes reuses elements; log and skip
            console.warn('[ElevenLabsClassic] hookElevenLabsAudio failed:', err);
        }
    },

    /**
     * Enable or disable the caller phone filter effect.
     * Source: ai-eyes/index.html lines 5584-5610
     */
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
            console.warn('[ElevenLabsClassic] setCallerEffect failed:', err);
        }
    },

    /**
     * Build a WaveShaper distortion curve.
     * @param {number} amount — 0 (clean) to 400 (heavy)
     */
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

    /**
     * Preload frequently used DJ sounds as blob URLs so they can play instantly.
     * Source: ai-eyes/index.html (sounds preloaded on page load).
     */
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
                } catch (_) { /* non-fatal: will fall back to direct URL */ }
            })
        );
    },

    /**
     * Play a DJ sound silently (no spoken words from agent).
     * Uses preloaded blob URL if available, otherwise falls back to server URL.
     */
    async _playDJSound(soundName) {
        const serverUrl = this._config.serverUrl || '';
        const src = this._djSoundCache[soundName]
            || `${serverUrl}/sounds/dj/${soundName}.mp3`;

        const audio = new Audio(src);
        audio.volume = 1.0;
        try {
            await audio.play();
        } catch (err) {
            console.warn(`[ElevenLabsClassic] playDJSound(${soundName}) failed:`, err);
        }

        this._bridge.emit(AgentEvents.PLAY_SOUND, { sound: soundName, type: 'dj' });
    },

    /**
     * Play a caller phone sound (dial tone = double beep with 400ms gap).
     * 5-second cooldown prevents spam.
     */
    async _playCallerSound(sound) {
        if (this._callerSoundCooldown) return;

        this._callerSoundCooldown = true;
        setTimeout(() => { this._callerSoundCooldown = false; }, 5000);

        const serverUrl = this._config.serverUrl || '';
        const src = `${serverUrl}/sounds/caller/${sound}.mp3`;

        this._bridge.emit(AgentEvents.PLAY_SOUND, { sound, type: 'caller' });

        if (sound === 'dial_tone') {
            // Double-beep with 400ms gap
            for (let i = 0; i < 2; i++) {
                if (i > 0) await this._sleep(400);
                const audio = new Audio(src);
                try { await audio.play(); } catch (_) { /* ignore */ }
                await this._sleep(800); // wait for beep to finish
            }
        } else {
            const audio = new Audio(src);
            try { await audio.play(); } catch (_) { /* ignore */ }
        }
    },

    // ── Music Sync ────────────────────────────────────────────────────────────

    /**
     * Sync music with server state (2-second debounce).
     * Sends a MUSIC_SYNC event for the shell's MusicPlayer to handle via /api/music?action=sync.
     *
     * Source: ai-eyes/index.html lines 5087-5165
     */
    _syncMusicWithServer() {
        const now = Date.now();
        if (now - this._lastSyncTime < 2000) return;  // 2s debounce
        if (this._callerEffectActive) return;          // Block sync during caller skits
        if (this._commercialPlaying) return;           // Block sync during commercials

        this._lastSyncTime = now;
        this._bridge.emit(AgentEvents.MUSIC_SYNC);

        // Auto-clear lastSyncedTrack every 30 seconds
        clearTimeout(this._syncClearTimer);
        this._syncClearTimer = setTimeout(() => {
            this._lastSyncedTrack = null;
        }, 30000);
    },

    // ── DJ Transition Alert ───────────────────────────────────────────────────

    /**
     * Called by the shell's MusicPlayer when a track has ≤12 seconds remaining.
     * Sends a context update so the agent can announce the next track.
     *
     * Wire up: shell should call adapter.onTrackEndingSoon() via bridge or direct call.
     * Source: ai-eyes/index.html lines 3918-3941
     */
    onTrackEndingSoon() {
        if (this._djTransitionTriggered || !this._conversation) return;
        this._djTransitionTriggered = true;

        this._sendContextUpdate('[DJ INFO: track ending in 10s]');
        this._sendForceMessage('[SYSTEM: Song ending! Announce next and call play_music action=skip!]');
    },

    /**
     * Called by shell when a track ends completely.
     * Resets the DJ transition flag.
     */
    onTrackEnded() {
        this._djTransitionTriggered = false;
    },

    // ── Commercial System ─────────────────────────────────────────────────────

    /**
     * Play a commercial break:
     *   1. Stop music
     *   2. Fetch /api/commercials?action=play
     *   3. Play the returned audio
     *   4. On end, notify agent to resume
     *
     * Source: ai-eyes/index.html lines 2318-2400
     */
    async _playCommercial() {
        if (this._commercialPlaying) return;
        this._commercialPlaying = true;

        const serverUrl = this._config.serverUrl || '';

        // Stop music first
        this._bridge.emit(AgentEvents.MUSIC_PLAY, { action: 'stop' });

        try {
            const res = await fetch(`${serverUrl}/api/commercials?action=play`);
            const data = await res.json();

            if (data.url) {
                this._commercialPlayer = new Audio(data.url);

                // Tell agent to stay quiet during ad
                this._sendContextUpdate('[DJ INFO: Commercial playing, stay quiet]');

                // Confirm started on server
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
            console.warn('[ElevenLabsClassic] playCommercial failed:', err);
            this._commercialPlaying = false;
        }
    },

    // ── ElevenLabs context injection ──────────────────────────────────────────

    /**
     * Send a contextual update to the ElevenLabs agent (silent background info).
     * @param {string} text
     */
    _sendContextUpdate(text) {
        if (!this._conversation) return;
        try {
            this._conversation.sendContextualUpdate(text);
        } catch (err) {
            console.warn('[ElevenLabsClassic] sendContextualUpdate failed:', err);
        }
    },

    /**
     * Send a forced SYSTEM message the agent must act on.
     * @param {string} text
     */
    _sendForceMessage(text) {
        if (!this._conversation) return;
        try {
            this._conversation.sendUserMessage(text);
        } catch (err) {
            console.warn('[ElevenLabsClassic] sendForceMessage failed:', err);
        }
    },

    // ── Utilities ─────────────────────────────────────────────────────────────

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};

export default ElevenLabsClassicAdapter;
export { ElevenLabsClassicAdapter };
