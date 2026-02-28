# TTS Stream Audio Cutoff Issue

**Date:** 2026-02-27
**Observed on:** Foamology session (researching company, 5 subagents launched)
**Priority:** Next sprint item

## Symptom
When LLM streams a long response, TTS audio chunks play rapidly and cut each other off instead of playing as smooth sequential speech.

## Root Cause Analysis

### Backend Flow (routes/conversation.py)
1. LLM streams token-by-token via OpenClaw gateway
2. Tokens accumulate in `_tts_buf`
3. `_extract_sentence()` splits on `.!?` with min 40 chars (hardcoded, ignores profile `min_sentence_chars`)
4. Each complete sentence fires `_fire_tts()` in a **background thread** — all TTS runs in parallel
5. Audio chunks are **yielded sequentially** to the client (waits for each thread in order)
6. Client receives NDJSON with `{"type": "audio", "audio": "<base64>", "chunk": N}`

### Frontend Flow (src/providers/TTSPlayer.js)
1. `TTSPlayer` has a queue-based player: `audioQueue[]`, `currentAudio`, `isPlaying`
2. `queue(base64Audio)` creates an `Audio` element with `onended → _playNext()`
3. `_playNext()` shifts from queue, plays next — should be sequential
4. VoiceSession.js line 326: `this.tts.queue(data.audio)` on each chunk

### The Problem
The queue implementation looks correct on paper, but audio chunks arrive very fast from backend (all TTS fired in parallel, ~130-200ms Groq latency). Possible issues:
- **Browser `onended` unreliability** on very short audio clips
- **Race condition**: chunks arrive faster than `onended` fires, new `queue()` call might interfere
- **No gap between chunks**: no silence between sentences makes it sound like cutoff even when sequential
- **Backend ordering**: parallel TTS threads may complete out of order vs yield order

## Config Options (exist in schema but NOT implemented)

| Config | Default | Status |
|--------|---------|--------|
| `parallel_sentences` | `true` | NOT IMPLEMENTED — always parallel |
| `min_sentence_chars` | `40` | HARDCODED in `_extract_sentence()`, ignores profile value |
| `inter_sentence_gap_ms` | `null` | NOT IMPLEMENTED — no silence between chunks |

## Key Files

**Backend:**
- `routes/conversation.py` lines 643-878 — sentence extraction, TTS firing, audio yielding
- `services/tts.py` lines 103-114 — sentence splitting in `generate_tts_chunked`
- `profiles/manager.py` lines 56-62 — VoiceConfig defaults (was supertonic/M1, now groq/autumn)

**Frontend:**
- `src/providers/TTSPlayer.js` — queue-based audio player (queue/playNext/stop)
- `src/core/VoiceSession.js` line 326 — queuing audio from stream

## Proposed Fix Direction (DO NOT IMPLEMENT YET)

1. **Frontend: harden the audio queue**
   - Use `AudioContext` instead of `new Audio()` for more reliable playback control
   - Add explicit gap between chunks (respect `inter_sentence_gap_ms`)
   - Add `oncanplaythrough` before attempting play
   - Consider pre-buffering: wait for N chunks before starting playback

2. **Backend: respect profile config**
   - Read `min_sentence_chars` from profile instead of hardcoded 40
   - Implement `parallel_sentences: false` option for sequential TTS
   - Consider coalescing short sentences before TTS dispatch

3. **Backend: smarter sentence batching**
   - Instead of 1 sentence = 1 TTS call, batch 2-3 short sentences together
   - Reduces number of audio chunks client needs to manage
   - Reduces Groq API calls

## Foamology Session Log Evidence

```
23:51:20 [Groq] Requesting TTS: 'Background and founder research. 2. Services...' voice=autumn
23:51:20 [Groq] Requesting TTS: 'Customer reviews and reputation. 4. Competition...' voice=autumn
23:51:21 [Groq] Requesting TTS: 'Recent news and developments. The agents will...' voice=autumn
23:51:21 [Groq] Requesting TTS: 'I'll summarize everything for you once they complete.' voice=autumn
23:51:22 TTS generated: 399430 bytes in 1332ms
23:51:22 TTS generated: 349510 bytes in 1215ms
23:51:23 TTS generated: 345670 bytes in 2329ms
23:51:24 TTS generated: 330310 bytes in 3057ms
23:51:24 TTS generated: 169030 bytes in 3357ms
```

5 TTS chunks generated in ~4 seconds, all fired in parallel. Client receives them in rapid succession.
Total response: 19816ms LLM + 3356ms TTS = 23173ms total.
