/**
 * EmotionEngine — infers emotional state from LLM responses and drives face mood.
 *
 * Connects LLM response content to the FaceManager's mood system (P3-T8).
 *
 * Two signal sources (in priority order):
 *   1. Explicit emotion_state from server (emitted as 'session:emotion' event)
 *   2. Text-based keyword inference from LLM response text
 *
 * Usage:
 *   import { emotionEngine } from './EmotionEngine.js';
 *   emotionEngine.start();   // call once at app boot
 *   emotionEngine.stop();    // call on teardown
 *
 * Events consumed from eventBus:
 *   'session:message'   { role: 'assistant', text: string }  — infer mood from text
 *   'session:emotion'   { mood, intensity, confidence }       — explicit override
 *   'session:thinking'  {}                                    — face to 'thinking'
 *   'tts:stop'          {}                                    — reset to neutral after speech
 *
 * Events emitted on eventBus:
 *   'emotion:change'    { mood, intensity, source }           — mood was updated
 *
 * ADR-004: emotion_state schema — mood + intensity + confidence
 * ADR-009: simple manager pattern (no framework)
 */

import { eventBus } from './EventBus.js';
import { faceManager, VALID_MOODS } from '../face/BaseFace.js';

// ── Keyword tables ─────────────────────────────────────────────────────────

/**
 * Mood inference rules.
 * Each entry has a mood and an array of regex patterns.
 * Rules are tested in order; first match wins.
 * @type {Array<{mood: string, patterns: RegExp[]}>}
 */
const MOOD_RULES = [
    {
        mood: 'surprised',
        patterns: [
            /\bwh?oa+\b/i,
            /\bwow\b/i,
            /\bno way\b/i,
            /\bholly?\s*sh+it\b/i,
            /\bwhat the\b/i,
            /\bseriously\?/i,
            /\breally\?\b/i,
            /\boh\s+sh+it\b/i,
            /\bunbelievable\b/i,
            /\bi can't believe\b/i
        ]
    },
    {
        mood: 'happy',
        patterns: [
            /\bha(ha)+\b/i,
            /\blol\b/i,
            /\blmao\b/i,
            /\bexcellent\b/i,
            /\bawesome\b/i,
            /\bfantastic\b/i,
            /\bperfect\b/i,
            /\bcongrat(ulation)?s?\b/i,
            /\bbrilliant\b/i,
            /\blove it\b/i,
            /\bthat's great\b/i,
            /\bnice\b/i,
            /\bsweet\b/i,
            /\bwoo+\b/i,
            /\blet'?s go\b/i
        ]
    },
    {
        mood: 'thinking',
        patterns: [
            /\bhmm+\b/i,
            /\blet me think\b/i,
            /\binteresting\b/i,
            /\bcalculat/i,
            /\banalyz/i,
            /\bprocessing\b/i,
            /\bconsidering\b/i,
            /\bactually\b/i,
            /\bwell,?\s+technically\b/i,
            /\bto be (fair|honest)\b/i
        ]
    },
    {
        mood: 'sad',
        patterns: [
            /\bsorry\b/i,
            /\bunfortunately\b/i,
            /\bi (can't|cannot|couldn't)\b/i,
            /\bfailed\b/i,
            /\berror\b/i,
            /\bmy bad\b/i,
            /\bapolog/i,
            /\bdisappoint/i,
            /\bregret\b/i
        ]
    },
    {
        mood: 'angry',
        patterns: [
            /\bannoying\b/i,
            /\bfrustrat/i,
            /\bstupid\b/i,
            /\bidiot/i,
            /\bwhy would you\b/i,
            /\bthat's wrong\b/i,
            /\bfor f+uck'?s sake\b/i,
            /\bfor (the love|crying out loud)\b/i
        ]
    }
];

// Minimum confidence to override neutral (0–1)
const INFERENCE_THRESHOLD = 0.4;

// ── EmotionEngine class ────────────────────────────────────────────────────

class EmotionEngine {
    constructor() {
        /** @type {string} */
        this._currentMood = 'neutral';
        /** @type {number} */
        this._currentIntensity = 0.5;
        /** @type {boolean} */
        this._active = false;
        /** @type {Function[]} unsubscribe functions */
        this._unsubs = [];
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._resetTimer = null;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Wire up EventBus subscriptions.  Call once at app boot.
     */
    start() {
        if (this._active) return;
        this._active = true;

        this._unsubs = [
            // Explicit server-provided emotion (highest priority)
            eventBus.on('session:emotion', (data) => this._onExplicitEmotion(data)),

            // Text-based inference on completed assistant message
            eventBus.on('session:message', (data) => {
                if (data?.role === 'assistant') {
                    this._inferFromText(data.text);
                }
            }),

            // When TTS finishes speaking, return to neutral after a short delay
            eventBus.on('tts:stop', () => this._scheduleReset()),
        ];

        console.log('[EmotionEngine] Started');
    }

    /**
     * Remove all EventBus subscriptions.
     */
    stop() {
        if (!this._active) return;
        this._active = false;

        this._unsubs.forEach(unsub => unsub());
        this._unsubs = [];

        if (this._resetTimer) {
            clearTimeout(this._resetTimer);
            this._resetTimer = null;
        }

        console.log('[EmotionEngine] Stopped');
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Manually set a mood (useful for testing or external overrides).
     * @param {string} mood  one of VALID_MOODS
     * @param {number} [intensity=0.6]  0–1
     */
    setMood(mood, intensity = 0.6) {
        this._applyMood(mood, intensity, 'manual');
    }

    /** @returns {string} current mood */
    get currentMood() {
        return this._currentMood;
    }

    /** @returns {number} current intensity (0–1) */
    get currentIntensity() {
        return this._currentIntensity;
    }

    // ── Private handlers ─────────────────────────────────────────────────────

    /**
     * Handle explicit emotion_state from server (ADR-004 schema).
     * @param {{ mood?: string, intensity?: number, confidence?: number }} data
     */
    _onExplicitEmotion(data) {
        if (!data?.mood) return;

        const mood = VALID_MOODS.includes(data.mood) ? data.mood : 'neutral';
        const intensity = typeof data.intensity === 'number'
            ? Math.max(0, Math.min(1, data.intensity))
            : 0.7;

        this._applyMood(mood, intensity, 'server');
    }

    /**
     * Infer a mood from the LLM's response text using keyword rules.
     * Falls back to 'neutral' if no rule matches above threshold.
     * @param {string} text
     */
    _inferFromText(text) {
        if (!text || typeof text !== 'string') return;

        // Cancel any pending reset — we're about to speak
        if (this._resetTimer) {
            clearTimeout(this._resetTimer);
            this._resetTimer = null;
        }

        const result = this._classify(text);

        if (result.confidence >= INFERENCE_THRESHOLD) {
            this._applyMood(result.mood, result.intensity, 'inference');
        }
        // If no signal, leave face as-is (VoiceSession already set 'neutral' on first delta)
    }

    /**
     * Classify text against MOOD_RULES.
     * @param {string} text
     * @returns {{ mood: string, intensity: number, confidence: number }}
     */
    _classify(text) {
        let bestMood = 'neutral';
        let bestScore = 0;

        for (const rule of MOOD_RULES) {
            let matchCount = 0;
            for (const pattern of rule.patterns) {
                if (pattern.test(text)) {
                    matchCount++;
                }
            }
            if (matchCount > 0) {
                // Score = matchCount / total patterns (normalised 0–1)
                const score = matchCount / rule.patterns.length;
                if (score > bestScore) {
                    bestScore = score;
                    bestMood = rule.mood;
                }
            }
        }

        // Intensity scales with how many signals fired
        const intensity = 0.4 + bestScore * 0.6;
        return { mood: bestMood, intensity, confidence: bestScore };
    }

    /**
     * Apply a mood to the FaceManager and emit 'emotion:change'.
     * @param {string} mood
     * @param {number} intensity
     * @param {string} source  'server' | 'inference' | 'manual'
     */
    _applyMood(mood, intensity, source) {
        mood = VALID_MOODS.includes(mood) ? mood : 'neutral';

        this._currentMood = mood;
        this._currentIntensity = intensity;

        faceManager.setMood(mood);

        eventBus.emit('emotion:change', { mood, intensity, source });

        console.log(`[EmotionEngine] Mood → ${mood} (intensity=${intensity.toFixed(2)}, src=${source})`);
    }

    /**
     * Schedule a return to neutral after TTS ends.
     * Cancelled if a new emotion comes in first.
     */
    _scheduleReset() {
        if (this._resetTimer) clearTimeout(this._resetTimer);
        this._resetTimer = setTimeout(() => {
            this._resetTimer = null;
            this._applyMood('neutral', 0.5, 'reset');
        }, 1500);
    }
}

// Singleton
export const emotionEngine = new EmotionEngine();
