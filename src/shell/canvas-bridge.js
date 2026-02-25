/**
 * canvas-bridge.js — Connect CanvasControl to EventBridge (P6-T4)
 *
 * Only connected when the active adapter has 'canvas' capability.
 * Routes CANVAS_CMD events to the canvas display system.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire CanvasControl to the EventBridge.
 * Only call this if the active adapter has 'canvas' capability.
 *
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @param {string[]} capabilities - active adapter capabilities
 * @returns {Function[]} unsubscribe functions
 */
export function connectCanvas(bridge, capabilities) {
    if (!capabilities.includes('canvas')) return [];

    const unsubs = [
        bridge.on(AgentEvents.CANVAS_CMD, ({ action, url }) => {
            if (!window.CanvasControl) return;
            if (action === 'present') window.CanvasControl.updateDisplay('html', url);
            else if (action === 'close') window.CanvasControl.hide();
        }),
    ];

    return unsubs;
}
