/**
 * camera-bridge.js — Connect CameraModule to EventBridge (P6-T4)
 *
 * Only connected when the active adapter has 'camera' capability.
 * Currently a placeholder — camera captures are driven by the
 * CameraModule internally. This bridge handles future vision events.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire CameraModule to the EventBridge.
 * Only call this if the active adapter has 'camera' capability.
 *
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @param {string[]} capabilities - active adapter capabilities
 * @returns {Function[]} unsubscribe functions
 */
export function connectCamera(bridge, capabilities) {
    if (!capabilities.includes('camera')) return [];

    // Camera button visibility is handled by _updateFeatureUI in orchestrator.
    // Future: subscribe to VISION_RESULT events here if adapters emit them.

    return [];
}
