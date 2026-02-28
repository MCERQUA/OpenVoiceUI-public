# Unwired TTS Config Options

**Date:** 2026-02-28
**Related:** tts-stream-cutoff-issue.md
**Priority:** Medium — directly contributes to choppy audio

## Summary

Three TTS settings exist in the profile config schema but the code doesn't use them.
They're the knobs that would fix the audio cutoff problem — they're just not connected yet.

## 1. `min_sentence_chars` — hardcoded at 40

**What it does:** Controls the minimum number of characters before a sentence gets sent
to Groq for voice generation. Prevents very short fragments from becoming their own
audio clip (which sounds choppy).

**The problem:** The profile config has this setting (default: 20 in default.json) but
the actual code in `routes/conversation.py` line 643 hardcodes `min_len=40` and ignores
the profile value entirely.

**Impact:** You can't tune this per-profile. A longer threshold (like 80) would batch
more text together = fewer audio clips = smoother playback. A shorter one (like 20)
gives faster response but more clips to manage.

**Files:**
- `routes/conversation.py` → `_extract_sentence(min_len=40)` — hardcoded
- `profiles/default.json` → `"min_sentence_chars": 20` — ignored by code
- `profiles/manager.py` → `min_sentence_chars: Optional[int] = None` — schema only

## 2. `inter_sentence_gap_ms` — not implemented

**What it does:** Adds a small pause (in milliseconds) between audio clips during
playback. Like a person taking a breath between sentences.

**The problem:** Right now sentence 2 starts playing the instant sentence 1 ends.
With no gap, fast responses sound like a machine gun of short clips. A small gap
(100-300ms) would make it sound more natural and conversational.

**Current state:** The setting exists in the profile schema and default.json
(`"inter_sentence_gap_ms": null`) but:
- Backend doesn't insert silence frames between audio chunks
- Frontend `TTSPlayer.js` doesn't add delays between queue items
- Nothing reads this value anywhere

**Files:**
- `profiles/default.json` → `"inter_sentence_gap_ms": null` — defined but unused
- `src/providers/TTSPlayer.js` → `_playNext()` — plays immediately, no gap logic

## 3. `parallel_sentences` — not implemented

**What it does:** Controls whether all sentences get sent to Groq simultaneously
(parallel = true) or one at a time (sequential = false).

**The problem:** The code always fires all TTS requests in parallel (background threads).
This is fast (all audio generates at once) but means 5 audio clips arrive at the
frontend almost simultaneously. The audio player queue has to handle rapid-fire incoming
clips, which is where the cutoff happens.

If set to `false`, it would:
- Send sentence 1 to Groq, wait for audio back
- Then send sentence 2, wait for audio back
- etc.

Slower overall, but each clip arrives one at a time = no pile-up.

**Current state:** Setting exists in profile schema (`"parallel_sentences": true`) but
the backend always runs parallel regardless of this value.

**Files:**
- `profiles/default.json` → `"parallel_sentences": true` — defined but unused
- `routes/conversation.py` → `_fire_tts()` always spawns threads, never checks config

## What Wiring These Up Would Fix

The audio cutoff issue is caused by too many short audio clips arriving too fast.
These three settings together would let us tune the behavior:

| Setting | Effect |
|---------|--------|
| `min_sentence_chars: 80` | Fewer, longer audio clips |
| `inter_sentence_gap_ms: 200` | Natural pause between sentences |
| `parallel_sentences: false` | Clips arrive one at a time, no pile-up |

The ideal fix is probably a combination: keep parallel TTS for speed, increase the
min chars to reduce clip count, and add a small inter-sentence gap in the frontend
player for natural pacing.
