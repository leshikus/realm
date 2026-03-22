# AI Portrait, Voice Acting & Lip-Sync

Hero characters in Conspiracy speak during events, faction proclamations, and turn summaries. This document covers how portraits are generated, how voices are synthesised, and how the browser client animates them in sync.

---

## Overview

```
Hero definition (traits, faction, name)
    │
    ▼
[1] Portrait generation — Stable Diffusion + LoRA
    │   outputs: neutral.png, talking.png, surprised.png, angry.png
    │
    ▼
[2] Dialogue text — LLM (see llm.md)
    │   outputs: "The audit is complete. Three contradictions were found."
    │
    ▼
[3] Voice synthesis — TTS (Kokoro / ElevenLabs)
    │   outputs: voice.mp3 + timing.json (word/phoneme timestamps)
    │
    ▼
[4] Lip-sync data — Rhubarb or Web Speech API
    │   outputs: visemes.json [{time, shape}, ...]
    │
    ▼
[5] Browser client — Canvas animation
        switches portrait sprite to match viseme at each frame
```

---

## 1. Portrait Generation

Each hero has a small set of expression sprites generated offline during hero creation. They are stored in the player's fork and served as static assets.

### Tool

Stable Diffusion (SDXL) with a game-specific LoRA trained on the visual style. Alternatively FLUX.1 with a style prompt.

### Prompt template

```
{style_prefix}, close-up portrait of {name},
{trait_descriptors},
expression: {expression},
dark bureaucratic fantasy, ink lines, muted palette,
high contrast, isolated face, no background clutter
```

Example expansion for a hero with traits `["paranoid", "efficient", "scarred"]`:

```
Dark bureaucratic fantasy comic portrait, close-up of Inquisitor Voss,
sharp eyes, thin scar across jaw, hollow cheeks, neat uniform collar,
expression: neutral,
ink lines, muted palette with gold accents, high contrast, isolated face
```

### Expression variants

Each hero needs four sprites. Generate all four from the same seed + ControlNet face reference to keep the face consistent:

| Sprite | Expression modifier | Used when |
|---|---|---|
| `neutral.png` | expression: neutral, mouth closed | idle, listening |
| `talking.png` | expression: mid-speech, mouth open | speaking |
| `surprised.png` | expression: wide eyes, raised brow | dramatic event |
| `angry.png` | expression: scowl, clenched jaw | hostile event |

### Consistency across variants

- Use the same `seed` for all four variants
- Use ControlNet with `neutral.png` as the reference image for the other three — this keeps the face structure identical
- Store the seed and ControlNet reference in `metadata.json` so the set can be regenerated

### Asset layout

```
/{userid}/assets/heroes/{hero_id}/
    neutral.png
    talking.png
    surprised.png
    angry.png
    metadata.json
```

```json
// metadata.json
{
  "hero_id": "agent_77",
  "name": "Inquisitor Voss",
  "style": "dark_bureaucratic_fantasy",
  "sd_model": "sdxl-1.0",
  "lora": "conspiracy-style-v2",
  "seed": 1138472,
  "traits": ["paranoid", "efficient", "scarred"],
  "voice_profile": "cold_official_male"
}
```

---

## 2. Voice Synthesis

Dialogue text (produced by the LLM — see `llm.md`) is converted to audio per character. Each hero has a voice profile that produces a consistent voice across all their lines.

### Tool options

| Tool | How to run | Quality | Notes |
|---|---|---|---|
| **Kokoro** | Local (Python) | High | Open weights; runs on CPU; good for CI |
| **Coqui TTS** | Local (Python) | Good | XTTS model supports voice cloning from a 3s sample |
| **ElevenLabs** | API | Excellent | Best expressiveness; per-character voice; costs per character |
| **Web Speech API** | Browser (built-in) | Acceptable | Zero setup; no audio file generated; limited expressiveness |

For the private beta, Kokoro running locally alongside the Python engine is the right default — no API cost, deterministic output, runs in CI.

### Voice profile

A voice profile is a short reference audio clip (3–10 seconds) plus synthesis parameters. Stored per hero:

```
/{userid}/assets/heroes/{hero_id}/voice_reference.wav   ← 3-10s sample
```

Synthesis call (Kokoro):

```python
# engine/voice.py

import subprocess, json, base64
from pathlib import Path

def synthesise(text: str, hero_id: str, out_path: Path) -> dict:
    """
    Generate audio for `text` using the hero's voice profile.
    Returns timing metadata (word timestamps).
    """
    profile_path = Path(f"assets/heroes/{hero_id}/voice_reference.wav")
    result = subprocess.run(
        [
            "python", "-m", "kokoro",
            "--text", text,
            "--voice", str(profile_path),
            "--output", str(out_path),
            "--timestamps",          # emit word-level timing JSON to stdout
        ],
        capture_output=True, text=True
    )
    timing = json.loads(result.stdout)   # [{word, start, end}, ...]
    return timing
```

Output: `voice.mp3` + a list of `{word, start_ms, end_ms}` entries.

---

## 3. Lip-Sync Data

Lip-sync maps audio timing to mouth shape identifiers (visemes). The browser client uses this to switch portrait sprites frame by frame.

### Viseme set

Five shapes are enough for a comic-style portrait:

| ID | Description | Example phonemes |
|---|---|---|
| `X` | mouth closed | silence, M, B, P |
| `A` | open, wide | A, AH |
| `B` | open, mid | E, EH |
| `C` | round, small | O, OO |
| `D` | teeth, slight | S, T, D, N |

### Generating viseme data

**Option A — Rhubarb Lip Sync (offline, recommended)**

Rhubarb takes an audio file and transcript and outputs per-frame viseme data:

```bash
rhubarb voice.mp3 --dialogFile dialogue.txt --output visemes.json --exportFormat json
```

Output format:

```json
{
  "metadata": { "duration": 3.42 },
  "mouthCues": [
    { "start": 0.00, "end": 0.18, "value": "X" },
    { "start": 0.18, "end": 0.35, "value": "A" },
    { "start": 0.35, "end": 0.52, "value": "B" },
    ...
  ]
}
```

**Option B — Web Speech API (browser, zero setup)**

If voice audio is generated in the browser via the Web Speech API, word boundary events provide approximate timing without needing Rhubarb:

```js
const utterance = new SpeechSynthesisUtterance(text);
utterance.onboundary = (e) => {
  if (e.name === "word") switchToViseme("A");  // crude: open mouth on each word
};
utterance.onend = () => switchToViseme("X");
speechSynthesis.speak(utterance);
```

This gives a coarse open/closed cycle rather than proper viseme shapes, but it requires no assets and no preprocessing.

---

## 4. Browser Animation

The client switches portrait sprites based on the viseme schedule while audio plays.

```js
// client/js/portrait.js

export class PortraitPlayer {
  constructor(heroId, canvasEl) {
    this.heroId  = heroId;
    this.canvas  = canvasEl;
    this.ctx     = canvasEl.getContext("2d");
    this.sprites = {};   // loaded lazily
  }

  async preload(expressions = ["neutral", "talking", "surprised", "angry"]) {
    for (const expr of expressions) {
      const img = new Image();
      img.src = `assets/heroes/${this.heroId}/${expr}.png`;
      await img.decode();
      this.sprites[expr] = img;
    }
  }

  show(expression) {
    const img = this.sprites[expression] ?? this.sprites["neutral"];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
  }

  // Map Rhubarb viseme IDs to portrait expressions
  static visemeToExpression(viseme) {
    if (viseme === "X") return "neutral";
    if (viseme === "A" || viseme === "B") return "talking";
    return "talking";
  }

  async playSpeech(audioSrc, visemes) {
    const audio = new Audio(audioSrc);

    // Schedule sprite switches from visemes.json mouthCues
    const cues = visemes.mouthCues;
    let cueIndex = 0;

    const tick = () => {
      const t = audio.currentTime * 1000; // ms
      while (cueIndex < cues.length && t >= cues[cueIndex].start * 1000) {
        this.show(PortraitPlayer.visemeToExpression(cues[cueIndex].value));
        cueIndex++;
      }
      if (!audio.ended) requestAnimationFrame(tick);
      else this.show("neutral");
    };

    audio.onplay = () => requestAnimationFrame(tick);
    await audio.play();
  }
}
```

Usage during an event:

```js
const player = new PortraitPlayer("agent_77", document.getElementById("heroCanvas"));
await player.preload();

const visemes = await fetch(`assets/heroes/agent_77/event_042_visemes.json`).then(r => r.json());
await player.playSpeech(`assets/heroes/agent_77/event_042_voice.mp3`, visemes);
```

---

## 5. Asset Generation Pipeline

Run once per hero creation and once per voiced event. The Python engine handles this in CI after the turn resolves:

```python
# engine/assets.py

def generate_hero_voice_assets(hero: dict, dialogue: str, turn: int):
    hero_id  = hero["id"]
    out_dir  = Path(f"assets/heroes/{hero_id}")
    out_dir.mkdir(parents=True, exist_ok=True)

    audio_path  = out_dir / f"event_{turn:03d}_voice.mp3"
    script_path = out_dir / f"event_{turn:03d}_dialogue.txt"
    viseme_path = out_dir / f"event_{turn:03d}_visemes.json"

    # 1. TTS
    timing = synthesise(dialogue, hero_id, audio_path)

    # 2. Write transcript for Rhubarb
    script_path.write_text(dialogue)

    # 3. Lip-sync
    subprocess.run([
        "rhubarb", str(audio_path),
        "--dialogFile", str(script_path),
        "--output", str(viseme_path),
        "--exportFormat", "json",
    ], check=True)
```

These asset files are committed to the player's fork alongside the world state update. The browser client fetches them via the raw content API.

---

## 6. Fallback (No Audio)

When TTS is unavailable (CI without Kokoro, or browser without audio support):

- Portrait stays on `neutral` sprite throughout
- Dialogue text is displayed as a text box below the portrait
- No viseme file is generated; the client checks for its presence before attempting animation

```js
async function playEventDialogue(heroId, turn, text) {
  const visemeUrl = `assets/heroes/${heroId}/event_${turn}_visemes.json`;
  const audioUrl  = `assets/heroes/${heroId}/event_${turn}_voice.mp3`;

  const hasAudio = await fetch(audioUrl, { method: "HEAD" }).then(r => r.ok).catch(() => false);

  if (hasAudio) {
    const visemes = await fetch(visemeUrl).then(r => r.json());
    await portrait.playSpeech(audioUrl, visemes);
  } else {
    portrait.show("neutral");
    showDialogueText(text);   // render text box instead
  }
}
```
