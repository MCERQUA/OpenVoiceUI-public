/**
 * EyeFace — animated eye face extracted from index.html FaceModule
 *
 * Renders two eyes with:
 *   - Mood-based eyelid animations (happy, sad, angry, thinking, surprised, listening)
 *   - Mouse-tracking pupil movement
 *   - Random autonomous blinking and looking behavior
 *
 * Usage (via FaceManager):
 *   import { faceManager } from './BaseFace.js';
 *   import { EyeFace } from './EyeFace.js';
 *
 *   faceManager.register('eyes', () => new EyeFace());
 *   await faceManager.loadSaved('eyes');
 *
 * Or standalone:
 *   import { EyeFace } from './EyeFace.js';
 *   const face = new EyeFace();
 *   face.init(document.querySelector('.face-box'));
 *   face.setMood('happy');
 */

import { BaseFace, VALID_MOODS } from './BaseFace.js';
import { eventBus } from '../core/EventBus.js';

export class EyeFace extends BaseFace {
    constructor() {
        super('eyes');

        /** @type {HTMLElement|null} */
        this._leftEye = null;
        /** @type {HTMLElement|null} */
        this._rightEye = null;
        /** @type {HTMLElement|null} */
        this._leftPupil = null;
        /** @type {HTMLElement|null} */
        this._rightPupil = null;

        /** @private timer IDs for cleanup */
        this._blinkTimer = null;
        this._lookTimer = null;
        this._lastMouseMove = Date.now();

        /** @private bound handlers for removeEventListener */
        this._onMouseMove = this._handleMouseMove.bind(this);

        /** @private eventBus unsub functions */
        this._unsubs = [];
    }

    /**
     * @param {HTMLElement} container  .face-box element
     * @override
     */
    init(container) {
        this.container = container;

        // Grab existing DOM elements (created by index.html shell)
        this._leftEye = document.getElementById('left-eye');
        this._rightEye = document.getElementById('right-eye');
        this._leftPupil = document.getElementById('left-pupil-container');
        this._rightPupil = document.getElementById('right-pupil-container');

        if (!this._leftEye || !this._rightEye) {
            console.warn('[EyeFace] Eye elements not found in DOM');
            return;
        }

        // Show eyes in case another face had hidden them
        const eyesContainer = container.querySelector('.eyes-container');
        if (eyesContainer) eyesContainer.style.display = 'flex';

        // Subscribe to EventBus mood changes
        this._unsubs.push(
            eventBus.on('tts:start', () => this.setMood('listening')),
            eventBus.on('tts:stop', () => this.setMood('neutral')),
            eventBus.on('stt:start', () => this.setMood('listening')),
            eventBus.on('stt:stop', () => this.setMood('neutral')),
        );

        this._startRandomBehavior();
        this._emitReady();
    }

    /**
     * Set the eye mood by toggling CSS mood classes on the eye elements.
     * @param {string} mood
     * @override
     */
    setMood(mood) {
        if (!this._leftEye || !this._rightEye) return;

        mood = this._normalizeMood(mood);

        // Remove all mood classes
        VALID_MOODS.forEach(m => {
            this._leftEye.classList.remove(m);
            this._rightEye.classList.remove(m);
        });

        // Add new mood class (neutral has no class)
        if (mood !== 'neutral') {
            this._leftEye.classList.add(mood);
            this._rightEye.classList.add(mood);
        }

        this._emitMood(mood);
    }

    /**
     * Trigger a quick blink animation (~150ms).
     * @override
     */
    blink() {
        if (!this._leftEye || !this._rightEye) return;

        this._leftEye.classList.add('blinking');
        this._rightEye.classList.add('blinking');

        setTimeout(() => {
            this._leftEye.classList.remove('blinking');
            this._rightEye.classList.remove('blinking');
        }, 150);
    }

    /**
     * Move pupils toward a screen coordinate.
     * @param {number} x  client X
     * @param {number} y  client Y
     */
    updateEyePosition(x, y) {
        if (!this._leftPupil || !this._rightPupil) return;

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const maxOffset = 15;

        const offsetX = ((x - centerX) / centerX) * maxOffset;
        const offsetY = ((y - centerY) / centerY) * maxOffset;

        const transform = `translate(${offsetX}px, ${offsetY}px)`;
        this._leftPupil.style.transform = transform;
        this._rightPupil.style.transform = transform;
    }

    /**
     * Remove all event listeners, timers, and DOM mutations.
     * @override
     */
    destroy() {
        // Clear timers
        if (this._blinkTimer) { clearTimeout(this._blinkTimer); this._blinkTimer = null; }
        if (this._lookTimer) { clearTimeout(this._lookTimer); this._lookTimer = null; }

        // Remove mouse listener
        document.removeEventListener('mousemove', this._onMouseMove);

        // Unsubscribe from eventBus
        this._unsubs.forEach(unsub => unsub());
        this._unsubs = [];

        // Clear all mood classes
        if (this._leftEye && this._rightEye) {
            VALID_MOODS.forEach(m => {
                this._leftEye.classList.remove(m);
                this._rightEye.classList.remove(m);
            });
        }

        this._initialized = false;
    }

    // ── private ───────────────────────────────────────────────────────────────

    /** Start autonomous random blinking and looking timers. */
    _startRandomBehavior() {
        // Random blinking: every 2-6 seconds
        const scheduleBlink = () => {
            this._blinkTimer = setTimeout(() => {
                this.blink();
                scheduleBlink();
            }, 2000 + Math.random() * 4000);
        };
        scheduleBlink();

        // Mouse tracking
        document.addEventListener('mousemove', this._onMouseMove);

        // Random looking when mouse is idle
        const scheduleRandomLook = () => {
            this._lookTimer = setTimeout(() => {
                if (Date.now() - this._lastMouseMove > 2000) {
                    const x = window.innerWidth * (0.2 + Math.random() * 0.6);
                    const y = window.innerHeight * (0.15 + Math.random() * 0.5);
                    this.updateEyePosition(x, y);
                }
                scheduleRandomLook();
            }, 1500 + Math.random() * 2500);
        };
        scheduleRandomLook();
    }

    /** @private */
    _handleMouseMove(e) {
        this._lastMouseMove = Date.now();
        this.updateEyePosition(e.clientX, e.clientY);
    }
}
