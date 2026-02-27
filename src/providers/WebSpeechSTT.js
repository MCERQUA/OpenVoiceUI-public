/**
 * WebSpeechSTT — Browser-native speech recognition provider (Web Speech API)
 * Free, no API keys needed.
 *
 * Usage:
 *   import { WebSpeechSTT, WakeWordDetector } from './WebSpeechSTT.js';
 *
 *   const stt = new WebSpeechSTT();
 *   stt.onResult = (text) => console.log('Heard:', text);
 *   await stt.start();
 */

// Detect iOS — affects mic stream lifetime and recognition restart timing
const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// ===== WEB SPEECH STT =====
// Browser-native speech recognition (free, no API keys needed)
class WebSpeechSTT {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.onResult = null;
        this.onError = null;

        // Silence detection for continuous listening
        this.silenceTimer = null;
        this.silenceDelayMs = 3000; // 3 seconds of silence before sending
        this.accumulatedText = '';
        this.isProcessing = false;

        // Keep mic stream alive during active listening (critical on iOS —
        // releasing and re-acquiring the stream can re-trigger permission prompts)
        this._micStream = null;

        // Check browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Web Speech API not supported in this browser');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true; // Keep listening continuously
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (event) => {
            if (this.isProcessing) return; // Ignore during AI response

            // Only process FINAL results, ignore interim spam
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }

            // Only proceed if we have a final result
            if (finalTranscript.trim()) {
                // Clear silence timer on any speech
                if (this.silenceTimer) {
                    clearTimeout(this.silenceTimer);
                    this.silenceTimer = null;
                }

                this.accumulatedText = finalTranscript;
                console.log('STT Final:', finalTranscript);

                // Set timer to detect when user stops speaking
                this.silenceTimer = setTimeout(() => {
                    if (this.accumulatedText.trim() && !this.isProcessing) {
                        console.log('Sending to AI:', this.accumulatedText);
                        this.isProcessing = true;
                        if (this.onResult) this.onResult(this.accumulatedText);
                        this.accumulatedText = '';
                    }
                }, this.silenceDelayMs);
            }
        };

        this.recognition.onerror = (event) => {
            // 'no-speech' and 'aborted' are normal during idle/transitions - don't propagate
            if (event.error === 'no-speech' || event.error === 'aborted') {
                console.log('STT:', event.error, '(normal, will auto-restart)');
                return;
            }
            // 'audio-capture' = mic hardware unavailable (iOS: another app has it, or hardware error)
            if (event.error === 'audio-capture') {
                console.error('STT: audio-capture — microphone hardware unavailable');
                if (this.onError) this.onError('audio-capture');
                return;
            }
            console.error('STT Error:', event.error);
            if (this.onError) this.onError(event.error);
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                // iOS needs more time between stop and restart — 300ms can cause silent failures
                const restartDelay = _isIOS ? 500 : 300;
                setTimeout(() => {
                    if (this.isListening) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            // Already started
                        }
                    }
                }, restartDelay);
            }
        };
    }

    isSupported() {
        return this.recognition !== null;
    }

    async start() {
        if (!this.recognition) {
            console.error('Speech recognition not supported');
            return false;
        }

        // Request mic permission and keep the stream alive.
        // On iOS, releasing the stream immediately then calling recognition.start()
        // can trigger a second permission prompt or silent failure because the OS
        // sees them as separate microphone acquisition attempts.
        try {
            if (!this._micStream) {
                this._micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
        } catch (e) {
            console.error('Mic access failed:', e.name, e.message);
            // Distinguish between no device and permission denied for better error messages
            if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
                if (this.onError) this.onError('no-device');
            } else {
                if (this.onError) this.onError('not-allowed');
            }
            return false;
        }

        try {
            this.isListening = true;
            this.recognition.start();
            console.log('STT started');
            return true;
        } catch (e) {
            console.error('Failed to start STT:', e);
            this.isListening = false;
            return false;
        }
    }

    stop() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        if (this.recognition) {
            this.isListening = false;
            this.isProcessing = false;
            this.recognition.stop();
            console.log('STT stopped');
        }
        // Release the mic stream when fully stopped
        if (this._micStream) {
            this._micStream.getTracks().forEach(t => t.stop());
            this._micStream = null;
        }
    }

    resetProcessing() {
        this.isProcessing = false;
        this.accumulatedText = '';
    }

    /**
     * Mute STT immediately — called when TTS starts speaking.
     * Sets isProcessing=true so onresult ignores all incoming audio,
     * and clears any pending silence timer so queued echo text is discarded.
     */
    mute() {
        this.isProcessing = true;
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        this.accumulatedText = '';
    }
}

// ===== WAKE WORD DETECTOR =====
// Listens for wake words in passive mode
class WakeWordDetector {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.onWakeWordDetected = null;

        // Wake words to listen for (overridden per-profile via applyProfile)
        this.wakeWords = ['wake up'];

        // Check browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Web Speech API not supported in this browser - wake word detection unavailable');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;  // Keep listening
        this.recognition.interimResults = false;  // Only final results
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            const last = event.results.length - 1;
            const transcript = event.results[last][0].transcript.toLowerCase();
            console.log('Wake word detector heard:', transcript);

            // Check if any wake word is in the transcript
            if (this.wakeWords.some(wakeWord => transcript.includes(wakeWord))) {
                console.log('Wake word detected!');
                if (this.onWakeWordDetected) {
                    this.onWakeWordDetected();
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.warn('Wake word detector error:', event.error);
            // Ignore 'no-speech' errors in passive mode
            if (event.error === 'no-speech' || event.error === 'aborted') {
                return;
            }
        };

        this.recognition.onend = () => {
            // Auto-restart if we're supposed to be listening
            if (this.isListening) {
                setTimeout(() => {
                    if (this.isListening) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            // Already started
                        }
                    }
                }, 100);
            }
        };
    }

    isSupported() {
        return this.recognition !== null;
    }

    start() {
        if (!this.recognition) {
            console.error('Speech recognition not supported');
            return false;
        }

        try {
            this.isListening = true;
            this.recognition.start();
            console.log('Wake word detector started');
            return true;
        } catch (e) {
            console.error('Failed to start wake word detector:', e);
            this.isListening = false;
            return false;
        }
    }

    stop() {
        if (this.recognition) {
            this.isListening = false;
            this.recognition.stop();
            console.log('Wake word detector stopped');
        }
    }

    toggle() {
        if (this.isListening) {
            this.stop();
            return false;
        } else {
            return this.start();
        }
    }
}

export { WebSpeechSTT, WakeWordDetector };
