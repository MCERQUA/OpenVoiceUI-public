/**
 * ClawdBotAdapter — Multi-Agent Framework adapter for ClawdBot / OpenClaw (P6-T2)
 *
 * Wraps the existing VoiceSession (P3-T7) and exposes it through the EventBridge
 * contract so the app shell can treat ClawdBot as a swappable agent adapter.
 *
 * Internally:
 *   - VoiceSession handles STT (Web Speech API), HTTP streaming to /api/conversation,
 *     TTS playback (TTSPlayer), and canvas/music command parsing.
 *   - This adapter translates between EventBus events (VoiceSession's internal bus)
 *     and EventBridge AgentEvents (the shell's canonical event vocabulary).
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md — "ClawdBot Adapter" section
 *
 * Adapter contract:
 *   init(bridge, config)  — called when this mode is selected
 *   start()               — called when user clicks the call button
 *   stop()                — called when user clicks stop
 *   destroy()             — called when switching to a different adapter
 *
 * Config shape:
 *   {
 *     serverUrl:  string,   // e.g. 'http://localhost:5001'
 *     sessionKey: string,   // e.g. 'voice-main-3'  (passed to VoiceSession)
 *     musicPlayer: object,  // optional — MusicPlayer instance from shell
 *   }
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';
import { eventBus } from '../core/EventBus.js';
import { VoiceSession } from '../core/VoiceSession.js';

const ClawdBotAdapter = {
    // ── Identity & capabilities ───────────────────────────────────────────────

    name: 'ClawdBot (OpenClaw)',

    /**
     * Feature flags: app shell shows/hides UI elements based on this array.
     * Ref: doc 17 — "capability-driven UI shell"
     */
    capabilities: [
        'canvas',           // [CANVAS:...] commands parsed and emitted
        'vps_control',      // agent can run server-side tools
        'file_ops',         // agent can read/write files on VPS
        'code_execution',   // agent can execute code on VPS
        'dj_soundboard',    // future: soundboard integration
        'music_sync',       // [MUSIC_PLAY/STOP/NEXT] commands parsed and emitted
        'camera',           // webcam + Gemini vision + face recognition
    ],

    // ── Private state ─────────────────────────────────────────────────────────

    _bridge:       null,   // EventBridge singleton
    _session:      null,   // VoiceSession instance
    _config:       null,   // adapter config passed to init()
    _eventUnsubs:  [],     // eventBus.on() cleanup functions
    _bridgeUnsubs: [],     // bridge.on() cleanup functions (belt-and-suspenders)

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Initialize the adapter.
     * Called by AgentOrchestrator when this mode is selected.
     *
     * @param {import('../core/EventBridge.js').EventBridge} bridge
     * @param {object} config
     */
    async init(bridge, config) {
        this._bridge = bridge;
        this._config = config;

        // Create VoiceSession — the existing ClawdBot conversation engine
        this._session = new VoiceSession({
            serverUrl:   config.serverUrl  || '',
            musicPlayer: config.musicPlayer || null,
        });

        // Translate VoiceSession's internal EventBus events → EventBridge AgentEvents
        this._wireSessionEvents();

        // Listen for UI→Agent actions emitted on the bridge
        this._bridgeUnsubs.push(
            bridge.on(AgentActions.SEND_MESSAGE,   (d) => this._session.sendMessage(d.text))
        );
        this._bridgeUnsubs.push(
            bridge.on(AgentActions.FORCE_MESSAGE,  (d) => this._session.sendMessage(d.text))
        );
        this._bridgeUnsubs.push(
            bridge.on(AgentActions.END_SESSION,    ()  => this.stop())
        );
        // CONTEXT_UPDATE: inject background context as a silent system message
        this._bridgeUnsubs.push(
            bridge.on(AgentActions.CONTEXT_UPDATE, (d) => this._session.sendMessage(`[CONTEXT: ${d.text}]`))
        );
    },

    /**
     * Start the conversation.
     * Called when the user clicks the call button.
     */
    async start() {
        if (!this._session) return;
        // VoiceSession.start() emits session:start on success, which we forward as CONNECTED
        await this._session.start();
    },

    /**
     * Stop the conversation.
     * Called when the user clicks stop.
     */
    async stop() {
        if (!this._session) return;
        this._session.stop();
        // session:stop handler emits DISCONNECTED via the wired event
    },

    /**
     * Full teardown — called when switching to a different adapter.
     * MUST release all resources.
     */
    async destroy() {
        // Stop conversation first
        this._session?.stop();

        // Destroy VoiceSession's AudioContext
        this._session?.destroy();
        this._session = null;

        // Clean up EventBus subscriptions (prevents stale handlers from a dead session)
        this._eventUnsubs.forEach(fn => fn());
        this._eventUnsubs = [];

        // Bridge unsubs: AgentOrchestrator calls bridge.clearAll() anyway,
        // but we clean up explicitly for correctness.
        this._bridgeUnsubs.forEach(fn => fn());
        this._bridgeUnsubs = [];

        this._bridge = null;
        this._config = null;
    },

    // ── Private: VoiceSession → EventBridge wiring ───────────────────────────

    /**
     * Subscribe to all EventBus events emitted by VoiceSession and translate
     * them into EventBridge AgentEvents for the app shell.
     */
    _wireSessionEvents() {
        const b = this._bridge;
        const push = (unsub) => this._eventUnsubs.push(unsub);

        // ── Connection lifecycle ──────────────────────────────────────────────

        push(eventBus.on('session:start', () => {
            b.emit(AgentEvents.CONNECTED);
            b.emit(AgentEvents.MOOD, { mood: 'happy' });
        }));

        push(eventBus.on('session:stop', () => {
            b.emit(AgentEvents.DISCONNECTED);
            b.emit(AgentEvents.MOOD, { mood: 'neutral' });
        }));

        push(eventBus.on('session:reset', (d) => {
            // Server-side session was reset (e.g. context overflow)
            console.info('[ClawdBotAdapter] Session reset:', d.old, '→', d.new);
        }));

        // ── Conversation state ────────────────────────────────────────────────

        push(eventBus.on('session:thinking', () => {
            b.emit(AgentEvents.STATE_CHANGED, { state: 'thinking' });
            b.emit(AgentEvents.MOOD,          { mood: 'thinking' });
        }));

        push(eventBus.on('session:listening', () => {
            b.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        }));

        // ── Content ───────────────────────────────────────────────────────────

        // Final messages (user speech → text, assistant response)
        push(eventBus.on('session:message', (d) => {
            b.emit(AgentEvents.MESSAGE, {
                role:  d.role,
                text:  d.text,
                final: true,
            });
        }));

        // Streaming text deltas (assistant thinking → partial transcript display)
        push(eventBus.on('session:streaming', (d) => {
            b.emit(AgentEvents.TRANSCRIPT, { text: d.text, partial: true });
        }));

        // ── Audio / TTS ───────────────────────────────────────────────────────

        push(eventBus.on('tts:start', () => {
            b.emit(AgentEvents.TTS_PLAYING);
            b.emit(AgentEvents.STATE_CHANGED, { state: 'speaking' });
        }));

        push(eventBus.on('tts:stop', () => {
            b.emit(AgentEvents.TTS_STOPPED);
            b.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        }));

        // ── Errors ────────────────────────────────────────────────────────────

        push(eventBus.on('session:error', (d) => {
            b.emit(AgentEvents.ERROR, { message: d.message });
            b.emit(AgentEvents.MOOD,  { mood: 'sad' });
        }));

        // ── Tool calls ────────────────────────────────────────────────────────

        push(eventBus.on('session:tool', (d) => {
            b.emit(AgentEvents.TOOL_CALLED, { name: d.name, params: {}, result: null });
        }));

        // ── Emotion / mood ────────────────────────────────────────────────────

        // Server-provided emotion state (ADR-004: mood + intensity + directives)
        push(eventBus.on('session:emotion', (d) => {
            if (d.mood) b.emit(AgentEvents.MOOD, { mood: d.mood });
        }));

        // ── Canvas commands ───────────────────────────────────────────────────

        // [CANVAS_MENU] → open canvas page picker
        push(eventBus.on('cmd:canvas_menu', () => {
            b.emit(AgentEvents.CANVAS_CMD, { action: 'menu' });
        }));

        // [CANVAS:pagename] → present a specific canvas page
        push(eventBus.on('cmd:canvas_page', (d) => {
            b.emit(AgentEvents.CANVAS_CMD, { action: 'present', url: d.page });
        }));

        // ── Music commands ────────────────────────────────────────────────────

        // [MUSIC_PLAY] or [MUSIC_PLAY:trackname]
        push(eventBus.on('cmd:music_play', (d) => {
            b.emit(AgentEvents.MUSIC_PLAY, {
                action: 'play',
                track:  d.track || null,
            });
        }));

        // [MUSIC_STOP]
        push(eventBus.on('cmd:music_stop', () => {
            b.emit(AgentEvents.MUSIC_PLAY, { action: 'stop' });
        }));

        // [MUSIC_NEXT]
        push(eventBus.on('cmd:music_next', () => {
            b.emit(AgentEvents.MUSIC_PLAY, { action: 'skip' });
        }));
    },
};

export default ClawdBotAdapter;
export { ClawdBotAdapter };
