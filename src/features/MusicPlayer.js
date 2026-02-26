/**
 * MusicPlayer — extracted from index.html MusicModule (P3-T6)
 *
 * Handles music playback with crossfade, ducking during speech,
 * AI text-trigger control, panel UI, timeline seek, and playlist switching.
 *
 * Usage:
 *   import { MusicPlayer } from './MusicPlayer.js';
 *   const player = new MusicPlayer({ serverUrl: 'http://localhost:5000', eventBus });
 *   await player.init();
 *   window.musicPlayer = player;
 *
 * EventBus events consumed:
 *   'tts:start'  → duck music
 *   'tts:stop'   → unduck music
 *
 * EventBus events emitted:
 *   'music:play'    { track, metadata }
 *   'music:stop'    {}
 *   'music:duck'    { ducked: bool }
 */

export class MusicPlayer {
    constructor({ serverUrl = '', eventBus = null } = {}) {
        this.serverUrl = serverUrl;

        // Dual audio elements for crossfade
        this.audio1 = document.getElementById('music-player');
        this.audio2 = document.getElementById('music-player-2');
        this.activeAudio = 1;
        this.audio = null;

        // UI elements
        this.button = document.getElementById('music-button');
        this.panel = document.getElementById('music-panel');
        this.trackName = document.getElementById('track-name');

        // State
        this.panelState = 'closed';
        this.lastOpenState = 'full';
        this._timelineRAF = null;
        this.isPlaying = false;
        this.currentTrack = null;
        this.currentMetadata = null;
        this.volume = 0.85;
        this.metadata = null;
        this.crossfadeInProgress = false;
        this.crossfadeDuration = 1500;
        this.trackHistory = [];
        this._playId = 0;
        this._skipHistoryPush = false;

        // Playlist
        this.currentPlaylist = 'sprayfoam';

        // AI text triggers
        this.playTriggers = ['spinning up', 'playing now', 'here comes', 'drop the beat', 'hit it', 'music time', 'lets play', "let's play", 'start the music', 'cue the music'];
        this.stopTriggers = ['stop the music', 'cut the music', 'kill the music', 'silence', 'music off', 'enough music'];
        this.skipTriggers = ['next track', 'skip this', 'next song', 'switch it up', 'something else', 'different song'];
        this.volumeUpTriggers = ['turn it up', 'louder', 'crank it', 'pump it up'];
        this.volumeDownTriggers = ['turn it down', 'quieter', 'lower the volume', 'too loud'];

        this.trackTriggers = {
            'mrs sprayfoam': 'Call-Me-Mrs.Sprayfoam.mp3',
            'mrs. sprayfoam': 'Call-Me-Mrs.Sprayfoam.mp3',
            'karen': 'Call-Me-Mrs.Sprayfoam.mp3',
            'augusta': 'Call-Me-Mrs.Sprayfoam.mp3',
            'foam it': 'Foam-It-we-insulate-you-right.mp3',
            'foamit': 'Foam-It-we-insulate-you-right.mp3',
            'moe': 'Foam-It-we-insulate-you-right.mp3',
            'toronto': 'Foam-It-we-insulate-you-right.mp3',
            'mississauga': 'Foam-It-we-insulate-you-right.mp3',
            'foam everything': 'Foam-Everything.mp3',
            'hey diddle': 'Hey-Diddle-Diddle.mp3',
            'diddle diddle': 'Hey-Diddle-Diddle.mp3',
            'nursery rhyme': 'Hey-Diddle-Diddle.mp3',
            'polyurethane gang': 'Polyurethane-Gang.mp3',
            'og polyurethane': 'OG-Polyurthane-gang.mp3',
            'espuma': 'Espuma-Calidez-2.mp3',
            'spanish': 'Spanish-ComfyLife.mp3',
            'comfy life': 'Spanish-ComfyLife.mp3'
        };

        // Wire up EventBus for TTS ducking
        if (eventBus) {
            eventBus.on('tts:start', () => this.duck(true));
            eventBus.on('tts:stop', () => this.duck(false));
        }

        this._eventBus = eventBus;
    }

    async init() {
        console.log('MusicPlayer initializing...');

        this.audio = this.audio1;

        // Load track metadata from server (non-blocking)
        this.loadMetadata();

        // When a track ends, stop state — DJ decides what plays next
        this.audio1.addEventListener('ended', () => {
            if (this.activeAudio === 1) {
                console.log('Track ended on audio1 - waiting for DJ to pick next song');
                this.isPlaying = false;
                if (this.panel) this.panel.classList.remove('playing');
                this._syncPlayButtons(false);
            }
        });
        this.audio2.addEventListener('ended', () => {
            if (this.activeAudio === 2) {
                console.log('Track ended on audio2 - waiting for DJ to pick next song');
                this.isPlaying = false;
                if (this.panel) this.panel.classList.remove('playing');
                this._syncPlayButtons(false);
            }
        });

        this._initTimeline();
        console.log('MusicPlayer ready with crossfade support');
    }

    // ── Crossfade ────────────────────────────────────────────────────────────

    getInactiveAudio() {
        return this.activeAudio === 1 ? this.audio2 : this.audio1;
    }

    async crossfade(newTrackUrl, newMetadata) {
        if (this.crossfadeInProgress) {
            console.log('Crossfade already in progress, skipping');
            return;
        }

        this.crossfadeInProgress = true;
        const outgoing = this.activeAudio === 1 ? this.audio1 : this.audio2;
        const incoming = this.activeAudio === 1 ? this.audio2 : this.audio1;

        console.log('Starting crossfade:', outgoing === this.audio1 ? 'audio1->audio2' : 'audio2->audio1');

        incoming.src = newTrackUrl;
        incoming.volume = 0;

        try {
            await new Promise((resolve, reject) => {
                const onCanPlay = () => {
                    incoming.removeEventListener('canplay', onCanPlay);
                    incoming.removeEventListener('error', onError);
                    resolve();
                };
                const onError = (e) => {
                    incoming.removeEventListener('canplay', onCanPlay);
                    incoming.removeEventListener('error', onError);
                    reject(e);
                };
                incoming.addEventListener('canplay', onCanPlay);
                incoming.addEventListener('error', onError);
                incoming.load();
            });

            await incoming.play();

            const steps = 30;
            const stepDuration = this.crossfadeDuration / steps;
            const outgoingStartVolume = outgoing.volume;

            for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                outgoing.volume = outgoingStartVolume * (1 - progress);
                incoming.volume = this.volume * progress;
                await new Promise(r => setTimeout(r, stepDuration));
            }

            outgoing.pause();
            outgoing.currentTime = 0;
            outgoing.volume = this.volume;
            incoming.volume = this.volume;

            this.activeAudio = this.activeAudio === 1 ? 2 : 1;
            this.audio = incoming;

            this.currentMetadata = newMetadata;
            this.currentTrack = newMetadata.filename;
            if (this.trackName) this.trackName.textContent = newMetadata.title || newMetadata.filename;
            this.isPlaying = true;
            if (this.button) this.button.classList.add('active');
            if (this.panel) this.panel.classList.add('playing');
            this._syncPlayButtons(true);
            if (this.panelState === 'closed') this.openPanel();

            console.log('Crossfade complete, now playing:', newMetadata.title);
        } catch (error) {
            console.error('Crossfade error:', error);
            incoming.volume = this.volume;
            this.audio = incoming;
            this.activeAudio = this.activeAudio === 1 ? 2 : 1;
        } finally {
            this.crossfadeInProgress = false;
        }
    }

    // ── Metadata ─────────────────────────────────────────────────────────────

    async loadMetadata() {
        try {
            const response = await fetch(`${this.serverUrl}/api/music?action=list`);
            const data = await response.json();
            this.metadata = data.tracks || [];
            console.log('Music metadata loaded:', this.metadata.length, 'tracks');
        } catch (error) {
            console.warn('Failed to load music metadata:', error);
            this.metadata = [];
        }
    }

    // ── Panel state ───────────────────────────────────────────────────────────

    togglePanel() {
        if (this.panelState === 'closed') {
            this.openPanel();
            if (!this.isPlaying) this.play();
        } else {
            this.stop();
        }
    }

    openPanel() {
        if (!this.panel) return;
        this.panel.classList.add('open');
        if (this.button) this.button.classList.add('active');
        if (this.lastOpenState === 'mini') {
            const full = document.getElementById('mp-full');
            const mini = document.getElementById('mp-mini');
            if (full) full.style.display = 'none';
            if (mini) mini.style.display = 'flex';
            this.panel.classList.add('state-mini');
            this.panelState = 'mini';
        } else {
            const full = document.getElementById('mp-full');
            const mini = document.getElementById('mp-mini');
            if (full) full.style.display = 'flex';
            if (mini) mini.style.display = 'none';
            this.panel.classList.remove('state-mini');
            this.panelState = 'full';
        }
        this._startTimeline();
    }

    closePanel() {
        if (!this.panel) return;
        this.panel.classList.remove('open');
        this.panel.classList.remove('state-mini');
        if (!this.isPlaying && this.button) this.button.classList.remove('active');
        this.panelState = 'closed';
        this._stopTimeline();
    }

    collapsePanel() {
        const full = document.getElementById('mp-full');
        const mini = document.getElementById('mp-mini');
        if (full) full.style.display = 'none';
        if (mini) mini.style.display = 'flex';
        if (this.panel) this.panel.classList.add('state-mini');
        this.panelState = 'mini';
        this.lastOpenState = 'mini';
        this._syncMiniControls();
    }

    expandPanel() {
        const mini = document.getElementById('mp-mini');
        const full = document.getElementById('mp-full');
        if (mini) mini.style.display = 'none';
        if (full) full.style.display = 'flex';
        if (this.panel) this.panel.classList.remove('state-mini');
        this.panelState = 'full';
        this.lastOpenState = 'full';
    }

    toggle() {
        this.togglePanel();
    }

    // ── Playback ──────────────────────────────────────────────────────────────

    async play(trackName) {
        const playId = ++this._playId;
        try {
            const url = new URL(`${this.serverUrl}/api/music`);
            url.searchParams.set('action', 'play');
            url.searchParams.set('playlist', this.currentPlaylist || 'sprayfoam');
            if (trackName) url.searchParams.set('track', trackName);

            const response = await fetch(url);
            if (playId !== this._playId) return;
            const data = await response.json();

            if (data.track) {
                if (this.currentTrack && !this._skipHistoryPush) {
                    this.trackHistory.push(this.currentTrack);
                    if (this.trackHistory.length > 20) this.trackHistory.shift();
                }
                this._skipHistoryPush = false;

                const filename = data.track.filename || data.track;
                const trackUrl = data.url || `${this.serverUrl}/music/${filename}`;

                this.audio.pause();
                this.audio.src = trackUrl;
                this.audio.volume = this.volume;

                try {
                    await this.audio.play();
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    throw e;
                }

                if (playId !== this._playId) return;

                this.isPlaying = true;
                this.currentTrack = filename;
                this.currentMetadata = data.track;
                this.currentPlaylist = data.playlist || this.currentPlaylist;
                if (this.button) this.button.classList.add('active');
                if (this.panel) {
                    this.panel.classList.add('playing');
                    this.panel.classList.remove('spotify-mode');
                }
                if (this.trackName) this.trackName.textContent = data.track.title || filename;
                this._syncPlayButtons(true);
                console.log('Now playing:', data.track.title, 'from playlist:', data.playlist);

                if (this.panelState === 'closed') this.openPanel();

                if (this._eventBus) {
                    this._eventBus.emit('music:play', { track: filename, metadata: data.track });
                }
            }
        } catch (error) {
            console.error('Music play error:', error);
        }
    }

    // ── Spotify mode ──────────────────────────────────────────────────────

    /**
     * Switch the music player to Spotify display mode.
     * Called when agent emits [SPOTIFY:track|artist] tag.
     * The actual audio plays on the user's Spotify Connect device.
     */
    async playSpotify(trackName, artist) {
        console.log('MusicPlayer: Spotify mode -', trackName, artist);

        // Stop local audio cleanly
        if (!this.audio.paused) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }

        this.currentPlaylist = 'spotify';
        this.isPlaying = true;
        this.currentTrack = trackName;
        this.currentMetadata = { title: trackName, artist, source: 'spotify', playlist: 'spotify' };

        // Update track name display
        const displayName = artist ? `${trackName}  ${artist}` : trackName;
        if (this.trackName) this.trackName.textContent = displayName;

        // Update panel UI
        if (this.button) this.button.classList.add('active');
        if (this.panel) {
            this.panel.classList.add('playing');
            this.panel.classList.add('spotify-mode');
        }
        this._syncPlayButtons(true);
        if (this.panelState === 'closed') this.openPanel();

        // Notify backend so status/context reflects Spotify
        try {
            const url = new URL(`${this.serverUrl}/api/music`);
            url.searchParams.set('action', 'spotify');
            url.searchParams.set('track', trackName);
            if (artist) url.searchParams.set('artist', artist);
            await fetch(url);
        } catch (e) {
            console.warn('MusicPlayer: Spotify state sync failed:', e);
        }

        if (this._eventBus) {
            this._eventBus.emit('music:play', { track: trackName, metadata: this.currentMetadata });
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        if (this.panel) this.panel.classList.remove('playing');
        this._syncPlayButtons(false);
        this.closePanel();
        if (this._eventBus) this._eventBus.emit('music:stop', {});
    }

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.currentTrack = null;
        this.currentMetadata = null;
        if (this.button) this.button.classList.remove('active');
        if (this.panel) {
            this.panel.classList.remove('playing');
            this.panel.classList.remove('spotify-mode');
        }
        this._syncPlayButtons(false);
        this.closePanel();
        if (this._eventBus) this._eventBus.emit('music:stop', {});
    }

    togglePlay() {
        if (this.audio.paused) {
            this.audio.play();
            this.isPlaying = true;
            if (this.button) this.button.classList.add('active');
            if (this.panel) this.panel.classList.add('playing');
            this._syncPlayButtons(true);
            if (this.panelState === 'closed') this.openPanel();
        } else {
            this.audio.pause();
            this.isPlaying = false;
            if (this.panel) this.panel.classList.remove('playing');
            this._syncPlayButtons(false);
        }
    }

    next() {
        this.play();
    }

    prev() {
        if (this.trackHistory.length > 0) {
            const prevTrack = this.trackHistory.pop();
            this._skipHistoryPush = true;
            this.play(prevTrack);
        }
    }

    // ── Volume & ducking ──────────────────────────────────────────────────────

    setVolume(value) {
        this.volume = value / 100;
        this.audio.volume = this.volume;
        document.querySelectorAll('.mp-vol').forEach(s => { s.value = value; });
    }

    volumeUp() {
        this.volume = Math.min(1, this.volume + 0.15);
        this.audio.volume = this.volume;
        document.querySelectorAll('.mp-vol').forEach(s => { s.value = this.volume * 100; });
    }

    volumeDown() {
        this.volume = Math.max(0, this.volume - 0.15);
        this.audio.volume = this.volume;
        document.querySelectorAll('.mp-vol').forEach(s => { s.value = this.volume * 100; });
    }

    /**
     * Duck music volume during speech (to 40%), restore after.
     * Called by EventBus tts:start / tts:stop, or directly.
     */
    duck(shouldDuck) {
        const activeAudioEl = this.activeAudio === 1 ? this.audio1 : this.audio2;
        activeAudioEl.volume = shouldDuck ? this.volume * 0.4 : this.volume;
        if (this._eventBus) this._eventBus.emit('music:duck', { ducked: shouldDuck });
    }

    // ── AI trigger detection ──────────────────────────────────────────────────

    /**
     * Scan AI response text for music control commands.
     * Returns action string or null.
     */
    checkTriggers(text) {
        if (!text) return null;
        const lowerText = text.toLowerCase();

        for (const [trigger, trackFile] of Object.entries(this.trackTriggers)) {
            if (lowerText.includes(trigger)) {
                console.log('Music trigger: specific track', trigger, '->', trackFile);
                this.play(trackFile);
                return 'play_specific';
            }
        }

        for (const trigger of this.playTriggers) {
            if (lowerText.includes(trigger)) {
                console.log('Music trigger: play');
                if (!this.isPlaying) this.play();
                return 'play';
            }
        }

        for (const trigger of this.stopTriggers) {
            if (lowerText.includes(trigger)) {
                console.log('Music trigger: stop');
                this.stop();
                return 'stop';
            }
        }

        for (const trigger of this.skipTriggers) {
            if (lowerText.includes(trigger)) {
                console.log('Music trigger: skip');
                this.next();
                return 'skip';
            }
        }

        for (const trigger of this.volumeUpTriggers) {
            if (lowerText.includes(trigger)) {
                console.log('Music trigger: volume up');
                this.volumeUp();
                return 'volume_up';
            }
        }

        for (const trigger of this.volumeDownTriggers) {
            if (lowerText.includes(trigger)) {
                console.log('Music trigger: volume down');
                this.volumeDown();
                return 'volume_down';
            }
        }

        return null;
    }

    // ── Track info for AI context ─────────────────────────────────────────────

    getCurrentTrackInfo() {
        if (!this.currentMetadata) return null;
        return {
            title: this.currentMetadata.title,
            artist: this.currentMetadata.artist,
            description: this.currentMetadata.description,
            phone: this.currentMetadata.phone_number,
            djHints: this.currentMetadata.dj_intro_hints
        };
    }

    getTrackList() {
        if (!this.metadata) return 'No tracks loaded';
        return Object.entries(this.metadata).map(([file, info]) => {
            return `- "${info.title}" (say "${Object.entries(this.trackTriggers).find(([k, v]) => v === file)?.[0] || file}")`;
        }).join('\n');
    }

    // ── Playlist switching ────────────────────────────────────────────────────

    async switchPlaylist(playlist) {
        console.log('Switching playlist to:', playlist);
        this.currentPlaylist = playlist;
        try {
            const response = await fetch(`${this.serverUrl}/api/music?action=list&playlist=${playlist}`);
            const data = await response.json();
            this.metadata = data.tracks || [];
            console.log('Playlist switched, loaded', this.metadata.length, 'tracks');
        } catch (error) {
            console.warn('Failed to load playlist metadata:', error);
        }
        if (this.isPlaying) this.play();
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    _syncPlayButtons(playing) {
        const icon = playing ? '\u23F8' : '\u25B6';
        const btn = document.getElementById('play-pause-btn');
        const btnMini = document.getElementById('play-pause-btn-mini');
        if (btn) btn.textContent = icon;
        if (btnMini) btnMini.textContent = icon;
    }

    _syncMiniControls() {
        const miniVol = document.querySelector('.mp-mini-vol');
        if (miniVol) miniVol.value = this.volume * 100;
    }

    _formatTime(s) {
        if (!s || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    _startTimeline() {
        if (this._timelineRAF) return;
        const update = () => {
            const cur = this.audio.currentTime || 0;
            const dur = this.audio.duration || 0;
            const pct = dur > 0 ? (cur / dur) * 100 : 0;
            const curEl = document.getElementById('mp-time-cur');
            const durEl = document.getElementById('mp-time-dur');
            const timeline = document.getElementById('mp-timeline');
            const fill = document.getElementById('mp-timeline-fill');
            if (curEl) curEl.textContent = this._formatTime(cur);
            if (durEl) durEl.textContent = this._formatTime(dur);
            if (timeline && !timeline._dragging) timeline.value = pct;
            if (fill) fill.style.width = pct + '%';
            this._timelineRAF = requestAnimationFrame(update);
        };
        this._timelineRAF = requestAnimationFrame(update);
    }

    _stopTimeline() {
        if (this._timelineRAF) {
            cancelAnimationFrame(this._timelineRAF);
            this._timelineRAF = null;
        }
    }

    _initTimeline() {
        const timeline = document.getElementById('mp-timeline');
        if (!timeline) return;
        timeline.addEventListener('mousedown', () => { timeline._dragging = true; });
        timeline.addEventListener('touchstart', () => { timeline._dragging = true; }, { passive: true });
        timeline.addEventListener('input', (e) => {
            const pct = e.target.value / 100;
            if (this.audio.duration) {
                this.audio.currentTime = pct * this.audio.duration;
            }
            const fill = document.getElementById('mp-timeline-fill');
            if (fill) fill.style.width = e.target.value + '%';
        });
        timeline.addEventListener('mouseup', () => { timeline._dragging = false; });
        timeline.addEventListener('touchend', () => { timeline._dragging = false; });
    }
}
