# "Brain Glitched" — What Happened and Why

**Date:** 2026-02-28
**Observed on:** Foamology session (mobile, asked AI to look at camera)
**Priority:** Medium

## What Happened (Plain English)

The user asked the AI "can you see me in the camera?" on their phone. Instead of answering, the AI kept saying "Hmm, my brain glitched for a second there. Try that again?"

**"Brain glitched" is NOT the AI talking.** It's a canned emergency message the app plays when everything goes wrong. The AI never actually said anything — it returned a completely blank response.

Here's what happened step by step:

1. The user's question went to OpenClaw (the AI brain). OpenClaw spent 18 seconds thinking about it, then came back with **literally nothing**. No text at all. It didn't even try to use any tools. It's like the agent received the question and just froze — returned a blank answer.

2. The app noticed the blank response and tried a backup AI (Z.AI) to answer instead. But that backup code is **broken** — someone removed or renamed the function it needs. So the backup crashed too.

3. With both the main AI and the backup AI failing, the only thing left was a hardcoded emergency message: "Hmm, my brain glitched for a second there. Try that again?" The app speaks this as if the AI said it, but the AI never actually said anything. It's the app covering for a silent failure.

**Why the camera specifically didn't work:** Most likely the vision tools aren't configured in that OpenClaw session, or the camera snapshot from the phone wasn't being sent with the request. The agent had no way to "see" anything, so it returned blank instead of saying "I can't do that."

---

## Technical Details

### Server Logs

```
00:33:50  chat.final with no text (no subagent)
00:33:50  ABORT sent for run 88cfb8f4... reason=empty-response
00:33:50  LLM inference completed in 18025ms (tools=0)
00:33:50  WARNING: No text response from Gateway, falling back to Z.AI flash...
00:33:50  ERROR: Z.AI direct call failed: module 'server' has no attribute 'get_zai_direct_response'
00:33:50  WARNING: Both Gateway and Z.AI flash failed, using generic fallback
00:33:50  Cleaned TTS text: "Hmm, my brain glitched for a second there. Try that again?"
```

### Three Failures in Sequence

**1. OpenClaw returned empty response**
- Agent ran for 18 seconds, used 0 tools, sent chat.final with NO text
- The user asked about the camera — this requires the vision system
- OpenClaw may not have access to the camera snapshot, or the vision tool wasn't available
- The agent couldn't do what was asked and returned nothing instead of saying "I can't do that"

**2. Z.AI fallback is broken**
- When the gateway returns empty, the code tries a direct Z.AI API call as backup
- But `server.get_zai_direct_response()` doesn't exist — it was removed or refactored
- This means the fallback path has been broken and nobody noticed (it's a silent error path)
- **File:** `routes/conversation.py` — search for `get_zai_direct_response`

**3. Canned "brain glitched" message**
- Last resort when both gateway AND fallback fail
- Hardcoded text: "Hmm, my brain glitched for a second there. Try that again?"
- Plays as TTS so the user hears it spoken
- Not useful — user has no idea what went wrong or what to do differently

### Also Noticed: Clerk Auth Polling

After the response, Clerk auth requests fire every 2 seconds continuously. Probably a health check or session keep-alive, not a bug, but noisy in the logs.

---

## What Needs to Be Fixed (When Ready)

**Fix 1: Remove or fix the broken Z.AI fallback**
- Either restore `get_zai_direct_response()` or remove the dead code path
- If we want a fallback, it should actually work

**Fix 2: Better empty response handling**
- Instead of "brain glitched", tell the user something useful
- If it was a vision request and vision isn't available: "I can't access the camera right now"
- If the gateway just returned empty: "I couldn't process that — could you try rephrasing?"

**Fix 3: Investigate why OpenClaw returned empty for vision**
- Does the Foamology OpenClaw session have vision tools configured?
- Is the camera snapshot being captured and sent with the request?
- The request had `identified_person: null` — possibly no camera data was sent
- The agent used `tools=0` — it didn't even TRY to use vision tools

## Key Files

- `routes/conversation.py` — fallback chain logic, "brain glitched" message, broken Z.AI call
- `services/gateways/openclaw.py` — empty response detection, ABORT logic
