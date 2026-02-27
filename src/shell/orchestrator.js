/**
 * orchestrator.js — AgentOrchestrator: capability-driven mode switching (P6-T4)
 *
 * The AgentOrchestrator manages registered agent adapters and handles
 * mode switching with full cleanup + capability-driven UI updates.
 *
 * Key responsibilities:
 *  - Register adapters with their configs
 *  - Switch modes: destroy old adapter, clear bridge, init new adapter
 *  - Connect shell bridge modules based on adapter capabilities
 *  - Show/hide UI elements based on what the active adapter supports
 *  - Persist selected mode in localStorage
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (Mode Switching section)
 *
 * Usage:
 *   import { orchestrator } from './shell/orchestrator.js';
 *   import { MyAdapter } from './adapters/my-adapter.js';
 *
 *   orchestrator.register('my-adapter', MyAdapter, { serverUrl: '...' });
 *   await orchestrator.switchMode('my-adapter');
 *   await orchestrator.startConversation();
 */

import { bridge } from '../core/EventBridge.js';
import { connectFace }            from './face-bridge.js';
import { connectMusic }           from './music-bridge.js';
import { connectSounds }          from './sounds-bridge.js';
import { connectCallerEffect }    from './caller-bridge.js';
import { connectCanvas }          from './canvas-bridge.js';
import { connectTranscript, connectActionConsole } from './transcript-bridge.js';
import { connectWaveform }        from './waveform-bridge.js';
import { connectCommercial }      from './commercial-bridge.js';
import { connectCamera }          from './camera-bridge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Capability → UI element map
// Maps capability string → array of DOM element IDs to show when present.
// Elements NOT in any capability's list are hidden by default.
// ─────────────────────────────────────────────────────────────────────────────

const CAPABILITY_UI_MAP = {
    canvas:         ['canvas-button'],
    music:          ['music-button'],
    wake_word:      ['wake-button'],
    camera:         ['camera-button'],
    caller_effects: ['caller-effect-toggle'],
    dj_soundboard:  [],   // no dedicated button, soundboard is always-present
    face_panel:     ['face-button'],
};

// All capability-controlled element IDs (used to hide everything first)
const ALL_CAPABILITY_ELEMENTS = [
    ...new Set(Object.values(CAPABILITY_UI_MAP).flat()),
];

// ─────────────────────────────────────────────────────────────────────────────
// AgentOrchestrator
// ─────────────────────────────────────────────────────────────────────────────

class AgentOrchestrator {
    constructor() {
        /** @type {Object.<string, {adapter: object, config: object}>} */
        this._adapters = {};

        /** @type {object|null} */
        this._activeAdapter = null;

        /** @type {string|null} */
        this._activeMode = null;

        /** @type {Function[]} shell bridge unsubscribe functions */
        this._shellConnections = [];
    }

    /**
     * Register an adapter with its default config.
     * Must be called before switchMode() can select this adapter.
     *
     * @param {string} mode - Unique mode key (e.g. 'clawdbot', 'elevenlabs-classic')
     * @param {object} adapter - Adapter object with init/start/stop/destroy methods
     * @param {object} config  - Adapter-specific configuration
     */
    register(mode, adapter, config = {}) {
        this._adapters[mode] = { adapter, config };
        console.log(`[Orchestrator] Registered adapter: ${mode}`);
    }

    /**
     * Switch the active agent adapter.
     * Performs full teardown of the current adapter, clears all bridge
     * handlers, initialises the new adapter, reconnects shell bridges,
     * and updates UI visibility based on the new adapter's capabilities.
     *
     * @param {string} newMode - Mode key to switch to
     * @param {object} [configOverride] - Optional config overrides for this switch
     */
    async switchMode(newMode, configOverride = {}) {
        const entry = this._adapters[newMode];
        if (!entry) {
            console.error(`[Orchestrator] Unknown mode: ${newMode}`);
            throw new Error(`Unknown agent mode: ${newMode}`);
        }

        // 1. Tear down current adapter completely
        if (this._activeAdapter) {
            console.log(`[Orchestrator] Destroying ${this._activeMode}`);
            try {
                await this._activeAdapter.destroy();
            } catch (e) {
                console.warn('[Orchestrator] Error during adapter destroy:', e);
            }
        }

        // 2. Disconnect all shell bridge subscriptions (prevent stale handlers)
        this._shellConnections.forEach(unsub => {
            try { unsub(); } catch (e) { /* ignore */ }
        });
        this._shellConnections = [];

        // 3. Clear ALL bridge handlers (nuclear clear — guarantees no leaks)
        bridge.clearAll();

        // 4. Initialise new adapter
        console.log(`[Orchestrator] Initialising ${newMode}`);
        this._activeAdapter = entry.adapter;
        this._activeMode = newMode;

        const config = { ...entry.config, ...configOverride };
        await entry.adapter.init(bridge, config);

        // 5. Reconnect shell modules (always-on bridges)
        const caps = entry.adapter.capabilities || [];

        this._shellConnections.push(
            ...connectFace(bridge),
            ...connectWaveform(bridge),
            ...connectTranscript(bridge),
            ...connectActionConsole(bridge),
            ...connectMusic(bridge),
            ...connectSounds(bridge),
        );

        // 6. Conditional bridges — only connect when adapter has the capability
        this._shellConnections.push(
            ...connectCallerEffect(bridge, caps),
            ...connectCanvas(bridge, caps),
            ...connectCommercial(bridge, caps),
            ...connectCamera(bridge, caps),
        );

        // 7. Update UI visibility based on capabilities
        this._updateFeatureUI(caps);

        // 8. Persist selection
        try { localStorage.setItem('agent_mode', newMode); } catch (e) { /* ignore */ }

        console.log(`[Orchestrator] Mode switched to: ${newMode} (caps: [${caps.join(', ')}])`);
    }

    /**
     * Start a conversation with the active adapter.
     */
    async startConversation() {
        if (!this._activeAdapter) {
            console.warn('[Orchestrator] No active adapter — call switchMode() first');
            return;
        }
        await this._activeAdapter.start();
    }

    /**
     * Stop the active conversation (but keep adapter alive).
     */
    async stopConversation() {
        if (this._activeAdapter) {
            await this._activeAdapter.stop();
        }
    }

    /**
     * Return the active adapter's capability list.
     * @returns {string[]}
     */
    get capabilities() {
        return this._activeAdapter?.capabilities ?? [];
    }

    /**
     * Return the active mode key.
     * @returns {string|null}
     */
    get activeMode() {
        return this._activeMode;
    }

    /**
     * Show/hide UI elements based on what the active adapter supports.
     * Capability-controlled elements are hidden first, then shown for
     * each capability the adapter declares.
     *
     * @param {string[]} capabilities - Capabilities of the active adapter
     * @private
     */
    _updateFeatureUI(capabilities) {
        // Hide all capability-controlled elements first
        ALL_CAPABILITY_ELEMENTS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Show elements for each declared capability
        capabilities.forEach(cap => {
            const ids = CAPABILITY_UI_MAP[cap] ?? [];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = '';
            });
        });

        // Emit capability list for any shell components that inspect it
        console.log(`[Orchestrator] UI updated for capabilities: [${capabilities.join(', ')}]`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton — one orchestrator for the whole app
// ─────────────────────────────────────────────────────────────────────────────

export const orchestrator = new AgentOrchestrator();

// Also export class for testing
export { AgentOrchestrator };
