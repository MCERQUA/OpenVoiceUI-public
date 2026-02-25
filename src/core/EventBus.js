/**
 * EventBus — simple pub/sub event system (ADR-009: simple manager pattern)
 *
 * Usage:
 *   import { eventBus } from './EventBus.js';
 *
 *   // Subscribe
 *   const unsub = eventBus.on('tts:start', (data) => { ... });
 *
 *   // Unsubscribe
 *   unsub();
 *   // or:
 *   eventBus.off('tts:start', handler);
 *
 *   // Emit
 *   eventBus.emit('tts:start', { text: 'Hello' });
 *
 *   // One-time listener
 *   eventBus.once('app:ready', () => { ... });
 */

class EventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe function
     */
    on(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(handler);

        // Return unsubscribe function
        return () => this.off(event, handler);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
        const handlers = this._listeners.get(event);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this._listeners.delete(event);
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
     * Emit an event, calling all registered handlers.
     * @param {string} event
     * @param {*} data
     */
    emit(event, data) {
        const handlers = this._listeners.get(event);
        if (!handlers) return;

        // Snapshot to avoid mutation issues during dispatch
        for (const handler of [...handlers]) {
            try {
                handler(data);
            } catch (err) {
                console.error(`[EventBus] Error in handler for "${event}":`, err);
            }
        }
    }

    /**
     * Remove all listeners for an event, or all listeners if no event given.
     * @param {string} [event]
     */
    clear(event) {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
    }

    /**
     * List all events that have listeners (useful for debugging).
     * @returns {string[]}
     */
    events() {
        return [...this._listeners.keys()];
    }
}

// Singleton instance for the whole app
export const eventBus = new EventBus();

// Also export the class for testing / multiple instances
export { EventBus };
