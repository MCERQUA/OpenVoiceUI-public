# "Brain Glitched" — Fallback Chain Failure

**Date:** 2026-02-28
**Observed on:** Foamology session (mobile, asked AI to look at camera)
**Priority:** Medium — affects user experience on every empty gateway response

## What the User Sees

Asks the AI something (in this case "can you see me in the camera?") and gets back:
"Hmm, my brain glitched for a second there. Try that again?"

Every time. No actual answer.

## What the Logs Show

```
00:33:50  chat.final with no text (no subagent)
00:33:50  ABORT sent for run 88cfb8f4... reason=empty-response
00:33:50  LLM inference completed in 18025ms (tools=0)
00:33:50  WARNING: No text response from Gateway, falling back to Z.AI flash...
00:33:50  ERROR: Z.AI direct call failed: module 'server' has no attribute 'get_zai_direct_response'
00:33:50  WARNING: Both Gateway and Z.AI flash failed, using generic fallback
00:33:50  Cleaned TTS text: "Hmm, my brain glitched for a second there. Try that again?"
```

## Three Failures in Sequence

### 1. OpenClaw returned empty response
- The agent ran for 18 seconds, used 0 tools, then sent chat.final with NO text
- The user asked about the camera — this likely requires the vision system
- OpenClaw may not have access to the camera snapshot, or the vision tool wasn't available
- The agent couldn't do what was asked and returned nothing instead of saying "I can't do that"

### 2. Z.AI fallback is broken
- When the gateway returns empty, the code tries a direct Z.AI API call as backup
- But `server.get_zai_direct_response()` doesn't exist — it was likely removed or refactored
- This means the fallback path has been broken and nobody noticed because it's a silent error path
- **File:** `routes/conversation.py` — search for `get_zai_direct_response`

### 3. Canned "brain glitched" message
- Last resort when both gateway AND fallback fail
- Hardcoded text: "Hmm, my brain glitched for a second there. Try that again?"
- Plays as TTS so the user hears it spoken
- **Not useful** — user has no idea what went wrong or what to do differently

## Also Noticed: Clerk Auth Polling

After the response, Clerk auth requests fire every 2 seconds continuously:
```
00:33:51  Clerk auth: user_id=user_365rT7sUqN11BDW5TTlt0FAMZWo
00:33:53  Clerk auth: user_id=user_365rT7sUqN11BDW5TTlt0FAMZWo
00:33:55  Clerk auth: user_id=user_365rT7sUqN11BDW5TTlt0FAMZWo
... every 2 seconds indefinitely
```
This is probably a health check or session keep-alive, not a bug, but worth noting
because it's noisy in the logs.

## Fixes Needed (When Ready)

### Fix 1: Remove or fix the broken Z.AI fallback
- Either restore `get_zai_direct_response()` or remove the dead code path
- If we want a fallback, it should actually work

### Fix 2: Better empty response handling
- Instead of "brain glitched", tell the user something useful
- If it was a vision request and vision isn't available: "I can't access the camera right now"
- If the gateway just returned empty: "I couldn't process that — could you try rephrasing?"

### Fix 3: Investigate why OpenClaw returned empty for vision
- Does the Foamology OpenClaw session have vision tools configured?
- Is the camera snapshot being captured and sent with the request?
- Check if `identified_person: null` in the request means no camera data was sent
- The request had `tools=0` — the agent didn't even TRY to use vision tools

## Key Files

- `routes/conversation.py` — fallback chain logic, "brain glitched" message, broken Z.AI call
- `services/gateways/openclaw.py` — empty response detection, ABORT logic
