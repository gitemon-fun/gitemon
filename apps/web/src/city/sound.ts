import type { ClimateId } from '@gitemon/shared';

/**
 * The soundscape (GRANDPLAN v8 §0 V8-D10, build file 07). Off until the player turns it on (G7); the
 * AudioContext is only created by that tap.
 *
 *   sea: waves (noise breathing in and out) · wind for the open lands · birds, frogs, rumble and
 *   chimes by region · soft footsteps while walking · a small arpeggio for a catch
 *
 * v14.1 (V14-D13, reverses V8-D10's "no audio files"): real CC0 recordings (listed on /credits) take
 * over the waves, wind, birds and frogs once they have loaded, and a catch plays a recorded sound. They
 * are fetched only after the player turns sound on (~0.5 MB). The synth stays underneath as the
 * fallback: a file that fails to load or decode (older Safari cannot read Ogg Opus) changes nothing.
 */

/** the recorded beds, loaded after sound is turned on */
const RECORDED = ['waves', 'wind', 'birds', 'jungle', 'frogs'] as const;
type Recorded = (typeof RECORDED)[number];

type Place = ClimateId | 'town' | 'sea';

interface Bed {
  gain: GainNode;
  stop: () => void;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds = new Map<string, Bed>();
  private place: Place = 'town';
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** v14.1: the recordings playing now, and every decoded file (kept for the next time sound is on) */
  private recorded = new Map<Recorded, Bed>();
  private buffers = new Map<string, AudioBuffer>();
  on = false;

  enable() {
    if (this.on) return;
    this.on = true;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx ??= new Ctx();
    void this.ctx.resume();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(c.destination);
    // two seconds of pink-ish noise, reused by every bed
    const n = c.sampleRate * 2;
    this.noise = c.createBuffer(1, n, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < n; i++) {
      b0 = 0.97 * b0 + 0.03 * (Math.random() * 2 - 1);
      d[i] = b0 * 3.2;
    }
    this.bed('waves', () => this.waves());
    this.bed('wind', () => this.wind());
    this.bed('rumble', () => this.rumble());
    this.mix(true);
    this.loop();
    void this.loadRecordings();
  }

  /** v14.1: fetch and start the recordings, the one for where you are first */
  private async loadRecordings() {
    const c = this.ctx;
    if (!c) return;
    const order = [...RECORDED].sort((a, b) => this.level(b) - this.level(a));
    for (const k of order) {
      const buf = await this.file(`/audio/${k}.ogg`);
      if (!buf || !this.on || this.ctx !== c || !this.master || this.recorded.has(k)) continue;
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(g).connect(this.master);
      s.start(0, Math.random() * buf.duration);
      this.recorded.set(k, { gain: g, stop: () => s.stop() });
      this.mix(false);
    }
    void this.file('/audio/catch.ogg');
    void this.file('/audio/paper.ogg');
  }
  private async file(url: string): Promise<AudioBuffer | null> {
    const had = this.buffers.get(url);
    if (had) return had;
    try {
      const res = await fetch(url);
      if (!res.ok || !this.ctx) return null;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(url, buf);
      return buf;
    } catch {
      return null; // cannot load or decode here: the synth carries on
    }
  }

  /** a catch: the recorded one when it has loaded, else the synth arpeggio */
  caught() {
    if (!this.on || !this.ctx || !this.master) return;
    const buf = this.buffers.get('/audio/catch.ogg');
    if (!buf) return this.chime();
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.9;
    s.connect(g).connect(this.master);
    s.start();
  }

  /** v15 (V15-D9): a panel opens — a soft page turn; silent until the recording has loaded */
  paper() {
    if (!this.on || !this.ctx || !this.master) return;
    const buf = this.buffers.get('/audio/paper.ogg');
    if (!buf) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.7;
    s.connect(g).connect(this.master);
    s.start();
  }

  disable() {
    this.on = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const b of this.beds.values()) b.stop();
    this.beds.clear();
    for (const b of this.recorded.values()) b.stop();
    this.recorded.clear();
    this.master?.disconnect();
    this.master = null;
    void this.ctx?.suspend();
  }

  /** where the camera is: the beds cross-fade to it */
  at(place: Place) {
    if (place === this.place) return;
    this.place = place;
    this.mix(false);
  }

  /** a soft footstep (the walker calls this about twice a second) */
  step() {
    if (!this.on || !this.ctx || !this.master || !this.noise) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.place === 'frost' ? 2400 : 900;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.14);
  }

  /** a small rising arpeggio: a catch, a sighting, a blessing */
  chime() {
    if (!this.on || !this.ctx || !this.master) return;
    [0, 4, 7, 12].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), 0.12, i * 0.08, 0.5));
  }

  // ---- beds: continuous layers whose gain follows the place ----

  private bed(name: string, make: () => Bed) {
    this.beds.set(name, make());
  }

  /** v14.1: how loud each recording plays where you are */
  private level(k: Recorded): number {
    const p = this.place;
    if (k === 'waves') return p === 'sea' || p === 'tide' ? 0.9 : p === 'bloom' ? 0.35 : 0.12;
    if (k === 'wind')
      return p === 'frost'
        ? 0.75
        : p === 'canyon' || p === 'savanna' || p === 'crystal'
          ? 0.4
          : 0.08;
    if (k === 'birds') return p === 'bloom' || p === 'savanna' ? 0.7 : p === 'town' ? 0.18 : 0;
    if (k === 'jungle') return p === 'jungle' ? 0.8 : 0;
    return p === 'marsh' ? 0.8 : 0; // frogs
  }

  private mix(now: boolean) {
    if (!this.ctx) return;
    const p = this.place;
    const rec = (k: Recorded) => this.recorded.has(k);
    // a synth bed gives way to its recording once that has loaded
    const want: Record<string, number> = {
      waves: rec('waves') ? 0 : p === 'sea' || p === 'tide' ? 0.9 : p === 'bloom' ? 0.45 : 0.18,
      wind: rec('wind')
        ? 0
        : p === 'frost'
          ? 0.8
          : p === 'canyon' || p === 'savanna' || p === 'crystal'
            ? 0.5
            : 0.12,
      rumble: p === 'volcano' ? 0.9 : 0,
    };
    const t = this.ctx.currentTime;
    const fade = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(v, t, now ? 0.01 : 1.2);
    };
    for (const [k, b] of this.beds) fade(b.gain, want[k] ?? 0);
    for (const [k, b] of this.recorded) fade(b.gain, this.level(k));
  }

  private src(filter: BiquadFilterType, freq: number, q = 0.7) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master!);
    s.start();
    return { s, f, g };
  }

  /** the sea: low noise that swells every ~7 s */
  private waves(): Bed {
    const c = this.ctx!;
    const { s, g } = this.src('lowpass', 520);
    const swell = c.createGain();
    swell.gain.value = 0.5;
    g.disconnect();
    g.connect(swell).connect(this.master!);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.14;
    const depth = c.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(swell.gain);
    lfo.start();
    return { gain: g, stop: () => (s.stop(), lfo.stop()) };
  }

  /** wind: a band of noise whose pitch wanders */
  private wind(): Bed {
    const c = this.ctx!;
    const { s, f, g } = this.src('bandpass', 700, 1.4);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = c.createGain();
    depth.gain.value = 320;
    lfo.connect(depth).connect(f.frequency);
    lfo.start();
    return { gain: g, stop: () => (s.stop(), lfo.stop()) };
  }

  /** the volcano: a deep rumble */
  private rumble(): Bed {
    const { s, g } = this.src('lowpass', 90, 1);
    return { gain: g, stop: () => s.stop() };
  }

  // ---- events: birds, frogs, chimes, crackles — scheduled at random by region ----

  private loop() {
    if (!this.on) return;
    const p = this.place;
    // (the synth birds and frogs step aside once their recordings play)
    if (p === 'bloom' || p === 'savanna') {
      if (!this.recorded.has('birds')) this.bird(false);
    } else if (p === 'jungle') {
      if (!this.recorded.has('jungle')) this.bird(true);
    } else if (p === 'marsh') {
      if (!this.recorded.has('frogs')) this.frog();
    } else if (p === 'crystal' || p === 'frost')
      this.tone(1568 * 2 ** ((Math.floor(Math.random() * 5) * 2) / 12), 1.6, 0, 0.12);
    else if (p === 'volcano') this.crackle();
    else if (p === 'town' && Math.random() < 0.15) this.tone(392, 2.2, 0, 0.1);
    this.timers.push(setTimeout(() => this.loop(), 900 + Math.random() * 2200));
  }

  private tone(freq: number, dur: number, delay: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = c.createGain();
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bird(tropical: boolean) {
    const c = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const t = c.currentTime + i * 0.13;
      const f0 = (tropical ? 1800 : 2600) + Math.random() * 900;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  private frog() {
    const c = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = 'triangle';
      const g = c.createGain();
      const t = c.currentTime + i * 0.16;
      o.frequency.setValueAtTime(180, t);
      o.frequency.linearRampToValueAtTime(120, t + 0.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.14);
    }
  }

  private crackle() {
    for (let i = 0; i < 6; i++) setTimeout(() => this.step(), Math.random() * 600);
  }
}
