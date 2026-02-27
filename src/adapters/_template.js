/**
 * Agent Adapter Template
 *
 * Copy this file to create a new agent adapter.
 * Replace all TODO placeholders with your implementation.
 *
 * Rules:
 *  1. Communicate with the outside world ONLY through the bridge
 *  2. Manage your own audio, WebSocket, and SDK internally
 *  3. Release ALL resources in destroy()
 *  4. Never import from other adapters
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';

export const TemplateAdapter = {
    /** Human-readable name shown in UI */
    name: 'My Agent System',

    /**
     * What this adapter can do.
     * UI shows/hides features based on this list.
     *
     * Available capabilities:
     *   'canvas'           - Agent can show HTML pages on the canvas display
     *   'dj_soundboard'    - Agent can play DJ sound effects
     *   'caller_effects'   - Agent can toggle phone filter audio effect
     *   'music_sync'       - Agent can control music playback
     *   'multi_voice'      - Agent uses multiple voices/personas
     *   'emotion_detection' - Agent sends emotion scores per utterance
     *   'commercials'      - Agent can trigger commercial breaks
     *   'vps_control'      - Agent can run commands on VPS
     *   'wake_word'        - Agent supports wake word activation
     */
    capabilities: [
        // TODO: add capabilities your adapter supports
    ],

    // ── Private state (prefix _ to mark as internal) ──────────────
    _bridge:        null,
    _config:        null,
    _unsubscribers: [],  // Store bridge.on() return values for cleanup

    // ─────────────────────────────────────────────────────────────
    // INIT — called when user selects this adapter mode
    //
    // Load SDKs, set up connections, subscribe to UI actions.
    // DO NOT start mic or begin conversation here — that's start().
    // ─────────────────────────────────────────────────────────────
    async init(bridge, config) {
        this._bridge = bridge;
        this._config = config || {};

        // TODO: load your SDK, set up audio chain, preload assets

        // Subscribe to UI → Agent actions
        this._unsubscribers.push(
            bridge.on(AgentActions.END_SESSION, () => this.stop()),
            // bridge.on(AgentActions.SEND_MESSAGE, (d) => this._handleSendMessage(d.text)),
            // bridge.on(AgentActions.CONTEXT_UPDATE, (d) => this._sendContext(d.text)),
            // bridge.on(AgentActions.FORCE_MESSAGE, (d) => this._forceMessage(d.text)),
        );
    },

    // ─────────────────────────────────────────────────────────────
    // START — begin conversation (called from user click)
    //
    // Start mic, connect to agent backend, etc.
    // ─────────────────────────────────────────────────────────────
    async start() {
        // TODO: unlock iOS AudioContext if needed
        // const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // stream.getTracks().forEach(t => t.stop());

        // TODO: connect to your agent

        // Emit connected event when ready
        this._bridge.emit(AgentEvents.CONNECTED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
        this._bridge.emit(AgentEvents.MOOD, { mood: 'happy' });
    },

    // ─────────────────────────────────────────────────────────────
    // STOP — end conversation gracefully (user clicks stop)
    // ─────────────────────────────────────────────────────────────
    async stop() {
        // TODO: end session, release mic

        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'idle' });
        this._bridge.emit(AgentEvents.DISCONNECTED);
        this._bridge.emit(AgentEvents.MOOD, { mood: 'neutral' });
    },

    // ─────────────────────────────────────────────────────────────
    // DESTROY — full teardown on adapter switch
    //
    // MUST release: mic, AudioContext, WebSocket, SDK instances.
    // MUST unsubscribe all bridge.on() subscriptions.
    // ─────────────────────────────────────────────────────────────
    async destroy() {
        await this.stop();

        // Unsubscribe all bridge listeners
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        // TODO: disconnect SDK, close AudioContext, etc.
    },

    // ─────────────────────────────────────────────────────────────
    // PRIVATE methods (prefix _ to mark as internal)
    // ─────────────────────────────────────────────────────────────

    // Example: emit bridge events when things happen
    _onAgentSpeaking(text) {
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'speaking' });
        this._bridge.emit(AgentEvents.TTS_PLAYING);
        this._bridge.emit(AgentEvents.MESSAGE, { role: 'assistant', text, final: true });
    },

    _onAgentListening() {
        this._bridge.emit(AgentEvents.TTS_STOPPED);
        this._bridge.emit(AgentEvents.STATE_CHANGED, { state: 'listening' });
    },

    _onToolCall(name, params, result) {
        this._bridge.emit(AgentEvents.TOOL_CALLED, { name, params, result });
    },
};

export default TemplateAdapter;
