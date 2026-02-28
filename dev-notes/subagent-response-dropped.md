# Subagent Results Never Delivered to Voice UI

**Date:** 2026-02-28
**Observed on:** Foamology session (research task with 5 subagents)
**Priority:** High — breaks multi-agent research workflows
**Status:** NOT RESOLVED

## What Happened (Plain English)

The user asked the AI to research Foamology's company. The AI said "I've launched 5 research agents, I'll summarize when they're done." Then... nothing. Silence. The mic stopped working and the research results never came back.

The 5 research agents actually DID launch and were doing their work inside OpenClaw (the AI brain). The problem is how the app talks to your browser. It uses a one-shot phone call, not an open line:

1. Your browser calls the server: "Hey, the user asked a question"
2. The server calls OpenClaw: "Process this"
3. OpenClaw's main agent says "I'm spawning 5 helpers" and then says "I'm done for now"
4. The server hears "I'm done" and hangs up the phone — sends the audio back to your browser and closes the connection
5. The 5 helpers are still working, but there's no phone line open anymore to send their results back

It's like calling a restaurant, ordering food, and the waiter says "the chef is making it now" — but then they hang up the phone. The food gets made but nobody calls you back to tell you it's ready.

The code actually HAS logic that says "wait, don't hang up, subagents are still working!" but the other part of the code ignores that and hangs up anyway. The two parts aren't talking to each other properly.

**The mic issue:** After the AI's "I've launched 5 agents" message played as audio, the mic never turned back on. This is because 3 empty/broken audio clips arrived before the real audio, and those broke the "I'm done playing" signal that tells the app to turn the mic back on. So the app thinks audio is still playing forever.

---

## Technical Details

### What the User Sees

1. Ask the AI to research something
2. AI says "I've launched 5 research agents, I'll summarize when they're done"
3. Audio plays that message
4. Silence. Nothing ever comes back. Mic stops working.
5. The subagents ARE running in OpenClaw — they're doing the research — but the results never reach the voice UI

## What the Logs Show

```
23:51:16  SUBAGENT SPAWN DETECTED via tool call: sessions_spawn (x5)
23:51:21  Main lifecycle.end with subagent active — NOT returning.
23:51:21  CHAT FINAL payload: "I've launched five research agents..."
23:51:21  ✓✓✓ AI RESPONSE (chat final): I've launched five research agents...
23:51:21  ### LLM inference completed in 19816ms (tools=6)
23:51:24  [METRICS] total=23173ms   ← HTTP RESPONSE CLOSED HERE
          ... silence. No more events. Subagent results never appear.
```

## Root Cause

Two systems are not coordinated:

### Gateway (openclaw.py) — KNOWS about subagents
- Line 478: Detects `subagent_active = True`
- Line 480: Logs "NOT returning" when main lifecycle ends
- Lines 518-523: Has logic to wait for "announce-back" events
- Lines 531-534: Has a waiting loop with elapsed time logging

### Conversation route (conversation.py) — IGNORES subagent state
- When it receives the chat.final event, it treats it as "we have text, generate TTS, close response"
- It calls `_fire_tts()` on the collected text, yields audio chunks, then returns
- The `[METRICS]` line at the end means the HTTP response generator has exited
- The gateway's subagent waiting logic IS running, but the HTTP pipe is already closed
- Even if subagent results arrive later, there's no HTTP connection to send them through

### The Disconnect
The gateway puts events into an `event_queue`. The conversation route reads from that queue.
But the conversation route has its OWN logic for when to stop reading — and it stops at chat.final
with text, regardless of what the gateway thinks about subagents.

## Also Broken: Mic Stays Muted

After the TTS audio finishes playing, the mic never unmutes:
- 3 TTS chunks arrived with "TTS: 0ms" at 18:51:18 (before actual audio was generated)
- These are likely empty/zero-length audio blobs
- The TTSPlayer's `onended` callback chain depends on every chunk firing its ended event
- Empty chunks may break this chain, leaving the player thinking it's still playing
- If `isPlaying` stays true, `_notifySpeaking(false)` never fires
- VoiceSession never calls `_resumeListening()` → mic stays muted forever

## What Needs to Happen (Future Fix)

### For subagent results:
1. The conversation route needs to check subagent state before closing the response
2. If subagents are active, keep the HTTP stream open and continue reading the event queue
3. When subagent results arrive (announce-back with new text), generate TTS and yield more audio
4. Only close when all subagents have reported back OR a timeout is reached

### For stuck mic:
1. TTSPlayer needs to validate audio chunks before queueing (reject 0-byte blobs)
2. Add a timeout fallback — if `isPlaying` is true for longer than expected, force reset
3. After all audio chunks are yielded, send a explicit "audio_complete" event so the frontend knows to unmute regardless

## Files to Modify (when ready)

- `routes/conversation.py` — coordinate with gateway's subagent state before closing
- `services/gateways/openclaw.py` — the waiting logic exists but isn't connected to response lifecycle
- `src/providers/TTSPlayer.js` — add empty chunk guard and timeout fallback
- `src/core/VoiceSession.js` — handle explicit "audio_complete" signal
