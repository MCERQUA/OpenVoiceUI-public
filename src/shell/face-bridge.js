/**
 * face-bridge.js — Connect FaceModule to EventBridge (P6-T4)
 *
 * Subscribes to agent events and drives face state changes.
 * Returns an array of unsubscribe functions for clean teardown.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire FaceModule to the EventBridge.
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @returns {Function[]} unsubscribe functions
 */
export function connectFace(bridge) {
    // FaceModule is a global loaded by index.html (legacy pattern)
    const face = () => window.FaceModule;

    const unsubs = [
        bridge.on(AgentEvents.STATE_CHANGED, ({ state }) => {
            if (!face()) return;
            if (state === 'speaking')  face().setMood('neutral');
            if (state === 'listening') face().setMood('listening');
            if (state === 'thinking')  face().setMood('thinking');
            if (state === 'idle')      face().setMood('neutral');
        }),
        bridge.on(AgentEvents.MOOD, ({ mood }) => {
            face()?.setMood(mood);
        }),
        bridge.on(AgentEvents.CONNECTED, () => {
            face()?.setMood('happy');
        }),
        bridge.on(AgentEvents.DISCONNECTED, () => {
            face()?.setMood('neutral');
        }),
        bridge.on(AgentEvents.ERROR, () => {
            face()?.setMood('sad');
        }),
    ];

    return unsubs;
}
