/**
 * Supertonic TTS Provider
 * Handles text-to-speech via the Supertonic backend
 */
import { BaseTTSProvider } from './BaseTTSProvider.js';

export class SupertonicProvider extends BaseTTSProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'supertonic';
        this.serverUrl = config.serverUrl || '';
        this.voices = ['M1', 'M2', 'F1', 'F2'];  // Available Supertonic voices
        this.currentVoice = config.voice || 'M1';
        this.audioQueue = [];
        this.currentAudio = null;
        this.audioContext = null;
    }

    async init() {
        console.log('[Supertonic] Initializing...');
        // Pre-warm audio context on user gesture
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Supertonic] Ready with voices:', this.voices);
        return true;
    }

    getVoices() {
        return this.voices;
    }

    setVoice(voiceName) {
        if (this.voices.includes(voiceName)) {
            this.currentVoice = voiceName;
            console.log('[Supertonic] Voice set to:', voiceName);
        }
    }

    /**
     * Synthesize speech by calling the backend API
     * @param {string} text - Text to speak
     * @param {object} options - Optional parameters (speed, lang)
     * @returns {Promise<boolean>} Success
     */
    async speak(text, options = {}) {
        if (!text || !text.trim()) {
            console.warn('[Supertonic] Empty text, skipping');
            return false;
        }

        const payload = {
            text: text.trim(),
            provider: 'supertonic',
            voice: this.currentVoice,
            speed: options.speed || 1.05,
            lang: options.lang || 'en'
        };

        try {
            console.log('[Supertonic] Requesting TTS for:', text.substring(0, 50) + '...');

            const response = await fetch(`${this.serverUrl}/api/tts/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `TTS request failed: ${response.status}`);
            }

            // Response is WAV audio directly, not JSON
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            this.queueAudioUrl(audioUrl);
            return true;

        } catch (error) {
            console.error('[Supertonic] TTS error:', error);
            return false;
        }
    }

    /**
     * Queue audio URL for playback
     * @param {string} audioUrl - Blob URL for audio
     */
    queueAudioUrl(audioUrl) {
        this.audioQueue.push(audioUrl);

        if (!this.isPlaying) {
            this.playNextAudio();
        }
    }

    /**
     * Play next audio in queue
     */
    async playNextAudio() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            this.currentAudio = null;
            return;
        }

        this.isPlaying = true;
        const audioUrl = this.audioQueue.shift();

        try {
            const audio = new Audio(audioUrl);

            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                this.playNextAudio();
            };

            audio.onerror = (e) => {
                console.error('[Supertonic] Audio playback error:', e);
                URL.revokeObjectURL(audioUrl);
                this.playNextAudio();
            };

            this.currentAudio = audio;
            await audio.play();
        } catch (error) {
            console.error('[Supertonic] Failed to play audio:', error);
            URL.revokeObjectURL(audioUrl);
            this.playNextAudio();
        }
    }

    /**
     * Convert base64 to Blob
     */
    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    /**
     * Stop all audio playback
     */
    stop() {
        this.audioQueue = [];
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        this.isPlaying = false;
    }

    isReady() {
        return true;
    }

    getCostPerMinute() {
        return 0;  // Free
    }

    destroy() {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
        }
    }
}

export default SupertonicProvider;
