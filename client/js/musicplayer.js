/**
 * musicplayer.js — Adaptive music system.
 * Architecture: WorldState → MoodResolver → PromptBuilder → AIService → StreamingBuffer → AudioPlayer
 * See docs/music.md for design intent.
 */

// ── Mood catalogue ───────────────────────────────────────────────────────────

export const MOODS = {
  BUREAU_NORMAL:      { key: 'BUREAU_NORMAL',      name: 'Bureau Normal',      tags: 'ambient, institutional, minor key, slow pulse, 90 seconds' },
  PARANOID_STABILITY: { key: 'PARANOID_STABILITY',  name: 'Paranoid Stability', tags: 'dark ambient, drone, clock ticks, muted synths, 90 seconds' },
  THE_MEMO_ARRIVES:   { key: 'THE_MEMO_ARRIVES',    name: 'The Memo Arrives',   tags: 'tense, cinematic build, orchestral bureaucracy, 90 seconds' },
  PRODUCTIVE_DECLINE: { key: 'PRODUCTIVE_DECLINE',  name: 'Productive Decline', tags: 'synthwave, low tempo, melancholic progression, 90 seconds' },
  ACTIVE_UNREST:      { key: 'ACTIVE_UNREST',       name: 'Active Unrest',      tags: 'industrial, glitch beats, distorted percussion, 90 seconds' },
  WORLD_EVENT:        { key: 'WORLD_EVENT',          name: 'World Event',        tags: 'cinematic sting, sudden, 45 seconds' },
  COLLAPSE_IMMINENT:  { key: 'COLLAPSE_IMMINENT',   name: 'Collapse Imminent',  tags: 'noise, atonal, broken rhythm, entropy artifacts, 90 seconds' },
  BUREAU_DISSOLVES:   { key: 'BUREAU_DISSOLVES',    name: 'The Bureau Dissolves', tags: 'silence punctuated by single notes, 120 seconds' },
};

// ── Mood resolver ────────────────────────────────────────────────────────────

export function resolveMood(world) {
  if (!world) return MOODS.BUREAU_NORMAL;

  const trust     = world.economy?.trust ?? 50;
  const maxUnrest = Math.max(0, ...(world.regions?.map(r => r.unrest ?? 0) ?? [0]));
  const entropy   = world.economy?.entropy ?? 0;

  if (entropy >= 90 || (trust < 20 && maxUnrest > 80)) return MOODS.BUREAU_DISSOLVES;
  if (trust < 20 || maxUnrest > 80)  return MOODS.COLLAPSE_IMMINENT;
  if (maxUnrest > 60)                return MOODS.ACTIVE_UNREST;
  if (trust < 40)                    return MOODS.PARANOID_STABILITY;
  if (trust > 70)                    return MOODS.PRODUCTIVE_DECLINE;
  return MOODS.BUREAU_NORMAL;
}

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(mood, variationSeed = 0) {
  return `${mood.tags}, variation ${variationSeed}`;
}

// ── AI service abstraction ───────────────────────────────────────────────────

/**
 * MubertService — real-time adaptive streams via Mubert API.
 * Requires a Mubert API key stored in Config as `mubert_api_key`.
 * See: https://mubert.com/render/api
 */
class MubertService {
  constructor(apiKey) { this.apiKey = apiKey; }

  async generate(prompt) {
    const res = await fetch('https://api-b2b.mubert.com/v2/TTMRecordTrack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'TTMRecordTrack',
        params: {
          pat: this.apiKey,
          prompt,
          format: 'mp3',
          intensity: 'medium',
          duration: 90,
        },
      }),
    });
    const data = await res.json();
    if (!data?.data?.tasks?.[0]?.download_link) throw new Error('Mubert: no download link');
    return data.data.tasks[0].download_link;
  }
}

/**
 * FallbackService — procedural Web Audio generation. No API key required.
 * Returns a special sentinel so AudioPlayer knows to use the Web Audio engine.
 */
class FallbackService {
  async generate(mood) {
    return { fallback: true, mood };
  }
}

// ── Streaming buffer ─────────────────────────────────────────────────────────

class StreamingBuffer {
  constructor(service) {
    this.service = service;
    this.current = null;  // { url, mood }
    this.next    = null;  // prefetch promise
  }

  async prefetch(mood, seed) {
    this.next = this.service.generate(buildPrompt(mood, seed)).then(url => ({ url, mood }));
  }

  async advance(mood, seed) {
    if (this.next) {
      this.current = await this.next;
    } else {
      this.current = { url: await this.service.generate(buildPrompt(mood, seed)), mood };
    }
    // Prefetch the next variation in the background
    this.next = this.service.generate(buildPrompt(mood, seed + 1)).then(url => ({ url, mood }));
    return this.current;
  }
}

// ── Fallback procedural audio ────────────────────────────────────────────────

function createFallbackNode(ctx, mood, entropy = 0) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // Low institutional drone
  const drone = ctx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = mood.key === 'PARANOID_STABILITY' ? 48 :
                          mood.key === 'COLLAPSE_IMMINENT'  ? 36 :
                          mood.key === 'BUREAU_DISSOLVES'   ? 28 : 55;

  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.12;
  drone.connect(droneGain);
  droneGain.connect(master);
  drone.start();

  // Slow AM modulation — "institutional hollow"
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain);
  lfoGain.connect(droneGain.gain);
  lfo.start();

  // Clock ticks for paranoid/collapse moods
  if (['PARANOID_STABILITY', 'THE_MEMO_ARRIVES', 'COLLAPSE_IMMINENT'].includes(mood.key)) {
    const tickInterval = setInterval(() => {
      if (ctx.state === 'closed') { clearInterval(tickInterval); return; }
      const tick = ctx.createOscillator();
      tick.type = 'square';
      tick.frequency.value = 1200 + Math.random() * 400;
      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0.06, ctx.currentTime);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
      tick.connect(tickGain);
      tickGain.connect(master);
      tick.start();
      tick.stop(ctx.currentTime + 0.06);
    }, mood.key === 'COLLAPSE_IMMINENT' ? 800 : 1500);
    master._tickInterval = tickInterval;
  }

  // Entropy distortion
  if (entropy > 70) {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    const amount = (entropy - 70) / 30;
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = ((Math.PI + 300 * amount) * x) / (Math.PI + 300 * amount * Math.abs(x));
    }
    shaper.curve = curve;
    droneGain.disconnect();
    droneGain.connect(shaper);
    shaper.connect(master);
  }

  return master;
}

// ── Audio player ─────────────────────────────────────────────────────────────

const CROSSFADE_DURATION = 3; // seconds

class AudioPlayer {
  constructor() {
    this.ctx         = null;
    this.current     = null;  // { element | node, gainNode }
    this.entropy     = 0;
  }

  _ensureCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async play(track, mood, entropy = 0) {
    this._ensureCtx();
    this.entropy = entropy;

    const useCrossfade = entropy <= 70;
    const fadeOut = useCrossfade ? CROSSFADE_DURATION : 0.05;

    // Fade out current
    if (this.current) {
      const g = this.current.gainNode;
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut);
      const prev = this.current;
      setTimeout(() => {
        if (prev.element) { prev.element.pause(); prev.element.src = ''; }
        if (prev.node)    {
          try { prev.node.disconnect(); } catch {}
          if (prev.node._tickInterval) clearInterval(prev.node._tickInterval);
        }
      }, fadeOut * 1000 + 100);
    }

    if (track.fallback) {
      // Procedural Web Audio fallback
      const masterGain = createFallbackNode(this.ctx, mood, entropy);
      masterGain.gain.setValueAtTime(0, this.ctx.currentTime + fadeOut);
      masterGain.gain.linearRampToValueAtTime(0.8, this.ctx.currentTime + fadeOut + CROSSFADE_DURATION);
      this.current = { node: masterGain, gainNode: masterGain };
    } else {
      // Real audio track
      const el    = new Audio(track.url);
      el.crossOrigin = 'anonymous';
      const src   = this.ctx.createMediaElementSource(el);
      const gain  = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime + fadeOut);
      gain.gain.linearRampToValueAtTime(0.8, this.ctx.currentTime + fadeOut + CROSSFADE_DURATION);
      src.connect(gain);
      gain.connect(this.ctx.destination);
      el.play().catch(() => {});
      this.current = { element: el, gainNode: gain };
    }
  }

  setVolume(v) {
    if (this.current) this.current.gainNode.gain.value = v;
  }

  get paused() {
    if (!this.current) return true;
    if (this.current.element) return this.current.element.paused;
    return this.ctx?.state === 'suspended';
  }

  pause() {
    if (this.current?.element) this.current.element.pause();
    else this.ctx?.suspend();
  }

  resume() {
    if (this.current?.element) this.current.element.play().catch(() => {});
    else this.ctx?.resume();
  }
}

// ── MusicPlayer — public API ─────────────────────────────────────────────────

export class MusicPlayer {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.playBtn
   * @param {HTMLElement} opts.skipBtn
   * @param {HTMLElement} opts.titleEl
   * @param {HTMLInputElement} opts.volumeEl
   * @param {string|null} opts.mubertApiKey  — from Config; null → fallback only
   */
  constructor({ playBtn, skipBtn, titleEl, volumeEl, mubertApiKey }) {
    this.playBtn  = playBtn;
    this.skipBtn  = skipBtn;
    this.titleEl  = titleEl;
    this.volumeEl = volumeEl;

    this.mood     = MOODS.BUREAU_NORMAL;
    this.seed     = 0;
    this.world    = null;

    const svc = mubertApiKey ? new MubertService(mubertApiKey) : new FallbackService();
    this.buffer = new StreamingBuffer(svc);
    this.player = new AudioPlayer();

    playBtn.addEventListener('click', () => this._togglePlay());
    skipBtn.addEventListener('click', () => this.skip());
    volumeEl.addEventListener('input', () => this.player.setVolume(+volumeEl.value));

    this._updateUI();
  }

  /** Call after loadWorld() resolves. Re-evaluates mood; crossfades if changed. */
  update(world) {
    this.world        = world;
    const newMood     = resolveMood(world);
    const moodChanged = newMood.key !== this.mood.key;
    this.mood         = newMood;

    if (moodChanged) {
      this.seed = 0;
      this._playNext();
    }

    // Entropy distortion
    const entropy = world?.economy?.entropy ?? 0;
    this.player.entropy = entropy;
  }

  /** Generate a new track in the same mood (skip). */
  async skip() {
    this.seed++;
    await this._playNext();
  }

  /** Trigger the one-shot "The Memo Arrives" cue, then return to ambient. */
  async triggerResolution() {
    const prev = this.mood;
    this.mood  = MOODS.THE_MEMO_ARRIVES;
    await this._playNext();
    // Return to previous mood after the cue (approx 90s)
    setTimeout(() => { this.mood = prev; this._playNext(); }, 90_000);
  }

  /** Trigger a world-event sting, then return to ambient. */
  async triggerWorldEvent() {
    const prev = this.mood;
    this.mood  = MOODS.WORLD_EVENT;
    await this._playNext();
    setTimeout(() => { this.mood = prev; this._playNext(); }, 45_000);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async _playNext() {
    this._updateUI();
    const entropy = this.world?.economy?.entropy ?? 0;
    try {
      const track = await this.buffer.advance(this.mood, this.seed);
      await this.player.play(track.url !== undefined ? track : { fallback: true }, this.mood, entropy);
    } catch {
      await this.player.play({ fallback: true }, this.mood, entropy);
    }
    this._updateUI();
  }

  _togglePlay() {
    if (this.player.paused) {
      if (!this.player.current) {
        this._playNext();
      } else {
        this.player.resume();
      }
    } else {
      this.player.pause();
    }
    this._updateUI();
  }

  _updateUI() {
    this.titleEl.textContent  = `♪ ${this.mood.name}`;
    this.playBtn.textContent  = this.player.paused ? '▶' : '⏸';
  }
}
