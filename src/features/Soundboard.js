/**
 * Soundboard — extracted from index.html DJSoundboard (P3-T6)
 *
 * Manages a library of DJ sound effects with preloading, debounce,
 * and AI text-trigger detection.
 *
 * Usage:
 *   import { Soundboard } from './Soundboard.js';
 *   const board = new Soundboard({ serverUrl: 'http://localhost:5000' });
 *   board.init();
 *   window.djSoundboard = board;
 *
 * EventBus events emitted (optional):
 *   'soundboard:play'  { soundName }
 */

export class Soundboard {
    constructor({ serverUrl = '', eventBus = null } = {}) {
        this.serverUrl = serverUrl;
        this._eventBus = eventBus;

        this.sounds = {
            'air_horn':          { file: 'air_horn.mp3',         triggers: ['air horn', 'airhorn', 'horn', 'bwaaah', 'bwaaa', 'bwah'] },
            'scratch_long':      { file: 'scratch_long.mp3',     triggers: ['scratch', 'scratching', 'wicka', 'wikka'] },
            'rewind':            { file: 'rewind.mp3',           triggers: ['rewind', 'pull up', 'pull it back', 'hold up', 'bring it back'] },
            'record_stop':       { file: 'record_stop.mp3',      triggers: ['record stop', 'stop the record'] },
            'crowd_cheer':       { file: 'crowd_cheer.mp3',      triggers: ['crowd cheer', 'applause', 'crowd goes wild', 'give it up', 'make some noise'] },
            'crowd_hype':        { file: 'crowd_hype.mp3',       triggers: ['crowd hype', 'hype them up', 'get hype'] },
            'yeah':              { file: 'yeah.mp3',             triggers: ['yeah!', 'yeahhh', 'oh yeah', 'yeeah'] },
            'lets_go':           { file: 'lets_go.mp3',          triggers: ["let's go!", 'lets go!', "let's goooo", 'here we go'] },
            'gunshot':           { file: 'gunshot.mp3',          triggers: ['gunshot', 'gun shot', 'bang bang', 'shots fired', 'pow pow', 'blat blat'] },
            'bruh':              { file: 'bruh.mp3',             triggers: ['bruh', 'bruhhh'] },
            'sad_trombone':      { file: 'sad_trombone.mp3',     triggers: ['sad trombone', 'womp womp', 'fail', 'wah wah'] }
        };

        /** @type {Object.<string, HTMLAudioElement>} */
        this.audioCache = {};

        /** @type {Object.<string, number>} */
        this.lastPlayTime = {};
    }

    /**
     * Preload common sounds so they play instantly on first trigger.
     */
    init() {
        ['air_horn', 'scratch_long', 'crowd_cheer', 'rewind', 'yeah', 'lets_go'].forEach(name => {
            this.preload(name);
        });
        console.log('Soundboard initialized with', Object.keys(this.sounds).length, 'sounds');
    }

    /**
     * Preload a sound into the audio cache.
     * @param {string} soundName
     */
    preload(soundName) {
        if (!this.sounds[soundName]) return;
        const audio = new Audio(`${this.serverUrl}/sounds/${this.sounds[soundName].file}`);
        audio.preload = 'auto';
        this.audioCache[soundName] = audio;
    }

    /**
     * Play a sound by name. Debounced (500ms) to avoid duplicate fires.
     * @param {string} soundName
     */
    play(soundName) {
        if (!this.sounds[soundName]) {
            console.warn('Unknown sound:', soundName);
            return;
        }

        // Debounce — don't play same sound within 500ms
        const now = Date.now();
        if (this.lastPlayTime[soundName] && now - this.lastPlayTime[soundName] < 500) {
            return;
        }
        this.lastPlayTime[soundName] = now;

        // Use cached audio or create a fresh element if cached is still playing
        let audio = this.audioCache[soundName];
        if (!audio || !audio.paused) {
            audio = new Audio(`${this.serverUrl}/sounds/${this.sounds[soundName].file}`);
        }

        audio.currentTime = 0;
        audio.volume = 0.4;  // Lower than music so voice stays audible
        audio.play().catch(e => console.error('Sound play error:', e));
        console.log('🎧 DJ Sound:', soundName);

        if (this._eventBus) {
            this._eventBus.emit('soundboard:play', { soundName });
        }
    }

    /**
     * Scan text for trigger words and play the first matching sound.
     * Only one sound fires per call (first match wins).
     * @param {string} text
     * @returns {string|null} soundName that was played, or null
     */
    checkTriggers(text) {
        if (!text) return null;
        const lowerText = text.toLowerCase();

        for (const [soundName, config] of Object.entries(this.sounds)) {
            for (const trigger of config.triggers) {
                if (lowerText.includes(trigger)) {
                    this.play(soundName);
                    return soundName;
                }
            }
        }

        return null;
    }

    /**
     * Add or update a sound definition at runtime.
     * @param {string} name
     * @param {string} file  filename (relative to /sounds/)
     * @param {string[]} triggers  trigger phrases
     */
    addSound(name, file, triggers = []) {
        this.sounds[name] = { file, triggers };
    }
}
