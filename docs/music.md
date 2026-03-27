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

## YouTube Playlist Variant

When AI generation services are unavailable or unwanted, the client can use a curated YouTube-backed playlist as the music source. This variant is configured in **Music Settings** (⚙ Options → ♪ Music Settings).

### How It Works

The player maintains a **Music Library** (`music.json`, per-player, stored in localStorage and optionally synced to the player's GitHub fork). The library is a map of mood keys to saved track lists:

```json
{
  "BUREAU_NORMAL":      [{ "videoId": "abc123", "title": "...", "channel": "...", "addedAt": "2026-03-27" }],
  "PARANOID_STABILITY": [],
  ...
}
```

At playback time, the library is consulted for the current mood. Tracks play in round-robin order via the YouTube IFrame Player API (embedded in the client at 0×0 — audio only). When the active mood changes, the player crossfades to the next saved track for the new mood (or shows a "no tracks — add some" notice if that mood is empty).

### Track Discovery — Client Search

The ♫ button in the music player header opens the **Music Library modal**. It has two tabs:

**Saved Tracks tab**
- Shows all saved tracks for the selected mood
- ▶ Play: immediately plays the track in the active player
- ✕ Remove: removes from the library and syncs to storage

**Search YouTube tab**
- Requires a YouTube Data API key (configured in Music Settings)
- Search input is pre-filled with the mood's default query:

| Mood | Default search query |
|---|---|
| Bureau Normal | `bureaucratic ambient ost soundtrack institutional` |
| Paranoid Stability | `paranoia dark ambient drone soundtrack ost` |
| The Memo Arrives | `tense cinematic build orchestral ost` |
| Productive Decline | `melancholic synthwave ost soundtrack` |
| Active Unrest | `industrial glitch electronic ost soundtrack` |
| World Event | `cinematic sting dramatic orchestral ost` |
| Collapse Imminent | `dark noise atonal experimental ost` |
| The Bureau Dissolves | `minimal ambient silence piano ost` |

- Results show: thumbnail, title, channel, **+ Save** button, **↗ Open** link (opens video in new tab for preview)
- Saved tracks are persisted immediately to localStorage and queued for GitHub sync

### Auto-Save

When a track plays past the configured threshold (default: 80% of duration), it is automatically saved to the library for that mood. Tracks that are skipped before the threshold are not saved. This lets the player populate their library passively by skipping what they don't want.

The threshold is configurable in Music Settings (0–100%).

### MP3 Extraction Mode

As an alternative to YouTube IFrame playback, the client supports routing audio through a configurable **MP3 Extract Service**. This is intended for players running a local or self-hosted extraction tool (e.g. a yt-dlp HTTP wrapper or compatible API).

Configuration: provide the service endpoint URL in Music Settings. The client calls:

```
GET {endpoint}?url=https://www.youtube.com/watch?v={videoId}
```

Expected response:
```json
{ "url": "https://..." }
```

The returned URL is played via the existing HTML5 `Audio` element with crossfade. If the service fails, the client falls back to direct YouTube IFrame playback for that track.

### Configuration (Music Settings)

All options are stored in `Config` (localStorage) alongside the GitHub token:

| Key | Type | Description |
|---|---|---|
| `music_mode` | `"procedural"` / `"youtube"` / `"mp3"` | Active music source |
| `youtube_api_key` | string | YouTube Data API v3 key (for search only) |
| `mp3_service_url` | string | MP3 extract service endpoint (MP3 mode only) |
| `music_autosave` | boolean | Auto-save tracks beyond threshold |
| `music_autosave_pct` | number 0–100 | Auto-save threshold (default: 80) |

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
