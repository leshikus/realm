# Music System — Conspiracy

*"The soundtrack is procedurally generated, like all our best lies."*

---

## Overview

*Conspiracy* uses adaptive AI-generated music that responds to the state of the player's dominion. There is no fixed playlist. Music shifts with trust levels, unrest, active factions, and turn phase — composing an auditory record of the player's failure or fragile success.

The system operates entirely in the browser. No backend. Audio is generated on demand via AI music services and managed through the Web Audio API.

---

## Design Goals

- Music should feel *institutional* — procedural, slightly hollow, periodically interrupted by bureaucratic noise
- Tone shifts with game state: low trust sounds paranoid; high unrest sounds like a workplace right before HR dissolves
- Turn resolution moments should land differently from the quiet of the Orders phase
- No track should repeat within a session without the player noticing; repetition is a signal, not laziness

---

## Adaptive Music Model

### State Parameters

The music engine reads world state each time a new track is needed:

| Parameter | Effect |
|---|---|
| `economy.trust` | Low trust → dark ambient, droning bass; high trust → structured, minor-key bureaucratic march |
| `region.unrest` (max across regions) | High unrest → dissonant glitch, distorted industrial; low → distant hum of productivity |
| Active world event | Global events trigger a distinct one-shot cue, then return to ambient layer |
| Turn phase | Orders → quiet composing music; Resolution → tense procedural pulse; Debrief → slower retrospective |
| Entropy level | High entropy → degraded audio artifacts, missed beats, corrupted loops |

### Mood Categories

| Mood | Prompt tags | When |
|---|---|---|
| **Bureau Normal** | ambient, institutional, minor key, slow pulse | Default; trust 40–70, unrest < 30 |
| **Paranoid Stability** | dark ambient, drone, clock ticks, muted synths | Trust < 40, no active crisis |
| **The Memo Arrives** | tense, cinematic build, orchestral bureaucracy | Turn resolution phase |
| **Productive Decline** | synthwave, low tempo, melancholic progression | Trust > 70; things are fine; they won't be |
| **Active Unrest** | industrial, glitch beats, distorted percussion | Region unrest > 60 |
| **World Event** | cinematic sting, sudden, 30–60 seconds | Global event fires |
| **Collapse Imminent** | noise, atonal, broken rhythm, entropy artifacts | Trust < 20 or unrest > 80 |
| **The Bureau Dissolves** | silence punctuated by single notes | Terminal state |

---

## Architecture

### Components

```
WorldState → MoodResolver → PromptBuilder → AIService → AudioPlayer
                                                ↓
                                         StreamingBuffer (preload next)
```

**MoodResolver** — reads current world state and returns the active mood category. Re-evaluated at turn phase transitions and after world reload.

**PromptBuilder** — constructs the generation prompt from mood tags, adding variation seeds to avoid identical tracks. Example:

```
"dark ambient, institutional drone, minor key, slow tempo, muted brass, clock ticks, dystopian office, 90 seconds"
```

**AIService** — calls the configured music generation API. Abstracts provider so the underlying service can be swapped.

**StreamingBuffer** — preloads the next track while the current one plays. Crossfade duration: 3 seconds by default. Entropy level above 70 disables crossfade (hard cut).

**AudioPlayer** — Web Audio API wrapper. Handles volume, crossfade, and the `Next Track` action.

### Player Controls

Minimal UI — music should be felt, not managed:

```
[ ♪ Now Playing: Bureau Normal ]   [ ▶▶ Skip ]   [Volume ▁▃▅]
```

`Skip` generates a new prompt with a variation seed offset and crossfades immediately. The skipped mood is preserved — skipping does not change the mood category, only the track.

---

## AI Music Services

### Recommended for Conspiracy

| Service | Why | Use case |
|---|---|---|
| **Mubert API** | Real-time adaptive streams, no generation wait time, royalty-free | Primary ambient layer; best for continuous playback |
| **Suno** | Full song quality, handles complex prompts well | World event stings, turn resolution cues |
| **MusicGen (Meta, self-hosted)** | No API cost, deterministic with seed, runs locally or on CI | Offline mode, reproducible per-turn tracks |

### Fallback Stack

1. Call primary configured service
2. On failure or timeout (>8s), fall back to secondary
3. If all services fail, loop a locally bundled minimal track (silence with periodic institutional tones)

The fallback track is not a placeholder — it is an intentional aesthetic choice. When the music system fails, the silence should feel like a budget cut.

---

## Integration with Game Events

### Turn Resolution Cue

When the player submits orders and the PR is opened, the client transitions to the `The Memo Arrives` mood and plays a one-shot generation before returning to ambient.

### World Event Interruption

When `loadEventLog()` returns a new world event since the last session, a 30–60 second event sting plays before the ambient layer resumes. World events are marked in the event log with a `[WORLD]` prefix.

### Entropy Audio Degradation

When the world's entropy index exceeds 70, the audio player applies a light distortion filter (Web Audio API `WaveShaperNode`). Above 90, occasional dropouts are introduced — half-second silences, as if the system is losing interest in maintaining itself.

This is not a bug message. It is a musical statement.

---

## Client Implementation Notes

The music player lives in `client/js/musicplayer.js`. It is initialized in `app.js` after world load and subscribes to world state changes.

```js
// Called after loadWorld() resolves
musicPlayer.update(world);  // re-evaluates mood, crossfades if changed
```

The player does not re-evaluate on every world reload if the mood category has not changed — identical mood means continuation, not restart.

### No Auth Required for Fallback

The locally bundled fallback requires no API key. External service API keys are stored in `Config` alongside the GitHub token, configurable via the Settings panel.

---

## Tone Reference

*Conspiracy*'s music should not try to be epic. Epics are for people who believe they will win.

The reference tone is:

- **Ennio Morricone** writing for a government procurement office
- **Burial** if his label required quarterly reports
- The hold music for a bank that has been insolvent for six years but is managing expectations

Tracks should make the player feel that their civilization is significant, highly organized, and approximately fourteen months from dissolution.

---

## Future Directions

- **Per-region themes**: regions with distinct faction control generate prompts incorporating faction identity
- **Hero leitmotifs**: short recurring phrases generated for heroes above level 5, woven into ambient tracks when that hero is active
- **Chronicle mode**: on the Statistics tab, historical turns play their original mood category as a silent documentary background
- **Session replay**: the full mood arc of a session is logged as metadata, reviewable as a "musical chronicle" of the player's dominion
