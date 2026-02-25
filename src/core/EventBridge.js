/**
 * EventBridge — Multi-Agent Framework event bus (P6-T1)
 *
 * The ONLY coupling point between the app shell and agent adapters.
 * Shell modules and adapters communicate exclusively through this bridge.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md
 *
 * Usage:
 *   import { bridge, AgentEvents, AgentActions } from './EventBridge.js';
 *
 *   // Adapter emits:
 *   bridge.emit(AgentEvents.CONNECTED);
 *   bridge.emit(AgentEvents.STATE_CHANGED, { state: 'speaking' });
 *
 *   // Shell subscribes:
 *   const unsub = bridge.on(AgentEvents.MOOD, ({ mood }) => FaceModule.setMood(mood));
 *
 *   // UI triggers agent action:
 *   bridge.emit(AgentActions.SEND_MESSAGE, { text: 'Hello' });
 */

// ─────────────────────────────────────────────
// Agent → UI Events (things the agent tells the UI)
// ─────────────────────────────────────────────

export const AgentEvents = {
    // Connection lifecycle
    CONNECTED:      'agent:connected',       // Agent is ready
    DISCONNECTED:   'agent:disconnected',    // Agent disconnected
    ERROR:          'agent:error',           // { message, code }

    // Conversation state
    STATE_CHANGED:  'agent:state',           // { state: 'speaking'|'listening'|'idle'|'thinking' }

    // Content
    MESSAGE:        'agent:message',         // { role: 'user'|'assistant', text, final: bool }
    TRANSCRIPT:     'agent:transcript',      // { text, partial: bool } — live STT

    // Audio signals (NOT the audio itself — each adapter handles its own audio)
    TTS_PLAYING:    'agent:tts_playing',     // TTS audio started (for mouth animation)
    TTS_STOPPED:    'agent:tts_stopped',     // TTS audio ended
    AUDIO_LEVEL:    'agent:audio_level',     // { level: 0-1 } for waveform mouth

    // Capabilities
    MOOD:           'agent:mood',            // { mood: 'happy'|'thinking'|'sad'|'neutral'|'listening' }
    CANVAS_CMD:     'agent:canvas',          // { action: 'present'|'close', url }
    TOOL_CALLED:    'agent:tool',            // { name, params, result } for ActionConsole

    // Music integration
    MUSIC_PLAY:     'agent:music_play',      // { track?, action: 'play'|'skip'|'stop'|'pause' }
    MUSIC_SYNC:     'agent:music_sync',      // Trigger syncMusicWithServer()

    // Sound effects
    PLAY_SOUND:     'agent:play_sound',      // { sound: 'air_horn', type: 'dj'|'caller' }

    // Caller effect
    CALLER_EFFECT:  'agent:caller_effect',   // { enabled: bool }

    // Commercial
    COMMERCIAL:     'agent:commercial',      // { action: 'play' }
};

// ─────────────────────────────────────────────
// UI → Agent Actions (things the UI tells the agent)
// ─────────────────────────────────────────────

export const AgentActions = {
    SEND_MESSAGE:   'ui:send_message',       // { text }
    END_SESSION:    'ui:end_session',
    CONTEXT_UPDATE: 'ui:context_update',     // { text } — background info injected silently
    FORCE_MESSAGE:  'ui:force_message',      // { text } — SYSTEM messages agent must act on
    MODE_SWITCH:    'ui:mode_switch',        // { mode } — switching agent mode
};

// ─────────────────────────────────────────────
// EventBridge class
// ─────────────────────────────────────────────

class EventBridge {
    constructor() {
        /** @type {Object.<string, Function[]>} */
        this._handlers = {};
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe function
     */
    on(event, handler) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
        // Return unsubscribe function
        return () => this.off(event, handler);
    }

    /**
     * Unsubscribe a specific handler from an event.
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
        if (this._handlers[event]) {
            this._handlers[event] = this._handlers[event].filter(h => h !== handler);
            if (this._handlers[event].length === 0) {
                delete this._handlers[event];
            }
        }
    }

    /**
     * Subscribe to an event for one invocation only.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe function
     */
    once(event, handler) {
        const wrapper = (data) => {
            handler(data);
            this.off(event, wrapper);
        };
        return this.on(event, wrapper);
    }

    /**
     * Emit an event to all registered handlers.
     * Handler errors are caught and logged so one bad handler can't break others.
     * @param {string} event
     * @param {*} [data={}]
     */
    emit(event, data = {}) {
        const handlers = this._handlers[event];
        if (!handlers || handlers.length === 0) return;
        // Snapshot array in case a handler modifies the list during dispatch
        [...handlers].forEach(h => {
            try {
                h(data);
            } catch (e) {
                console.error(`[EventBridge] Error in "${event}" handler:`, e);
            }
        });
    }

    /**
     * Clear all handlers for a specific event.
     * Used during targeted cleanup (e.g. removing canvas listeners only).
     * @param {string} event
     */
    clearEvent(event) {
        delete this._handlers[event];
    }

    /**
     * Clear ALL handlers — nuclear option for mode switching.
     * Called by AgentOrchestrator when switching adapters to guarantee
     * no stale handlers from the previous adapter survive.
     */
    clearAll() {
        this._handlers = {};
    }

    /**
     * Return list of events that currently have listeners (for debugging).
     * @returns {string[]}
     */
    events() {
        return Object.keys(this._handlers);
    }
}

// ─────────────────────────────────────────────
// Singleton — one bridge for the whole app
// ─────────────────────────────────────────────

export const bridge = new EventBridge();

// Also export the class for testing / multiple instances
export { EventBridge };
