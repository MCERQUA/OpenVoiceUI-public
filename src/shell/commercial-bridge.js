/**
 * commercial-bridge.js — Connect commercial system to EventBridge (P6-T4)
 *
 * Only connected when the active adapter has 'commercials' capability.
 * Handles commercial playback: stops music, plays commercial,
 * then prompts agent to resume.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';

/**
 * Wire commercial system to the EventBridge.
 * Only call this if the active adapter has 'commercials' capability.
 *
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @param {string[]} capabilities - active adapter capabilities
 * @returns {Function[]} unsubscribe functions
 */
export function connectCommercial(bridge, capabilities) {
    if (!capabilities.includes('commercials')) return [];

    const unsubs = [
        bridge.on(AgentEvents.COMMERCIAL, async ({ action }) => {
            if (action !== 'play') return;

            // Stop music for commercial break
            window.musicPlayer?.stop?.();

            // Play commercial (global function from legacy code)
            if (window.playCommercial) {
                await window.playCommercial();
            }

            // Tell agent commercial is over
            bridge.emit(AgentActions.FORCE_MESSAGE, {
                text: "[SYSTEM: Commercial over! Say we're back and play the next track!]",
            });
        }),
    ];

    return unsubs;
}
