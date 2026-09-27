import type { ClimateId } from '@gitemon/shared';

/**
 * The soundscape (GRANDPLAN v8 §0 V8-D10, build file 07). Every sound is made in the browser with
 * Web Audio — no audio files to download, no licences to track. Off until the player turns it on
 * (G7); the AudioContext is only created by that tap.
 *
 *   sea: waves (noise breathing in and out) · wind for the open lands · birds, frogs, rumble and
 *   chimes by region · soft footsteps while walking · a small arpeggio for a catch
 */

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
  }

  disable() {
    this.on = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const b of this.beds.values()) b.stop();
    this.beds.clear();
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

  private mix(now: boolean) {
    if (!this.ctx) return;
    const p = this.place;
    const want: Record<string, number> = {
      waves: p === 'sea' || p === 'tide' ? 0.9 : p === 'bloom' ? 0.45 : 0.18,
      wind: p === 'frost' ? 0.8 : p === 'canyon' || p === 'savanna' || p === 'crystal' ? 0.5 : 0.12,
      rumble: p === 'volcano' ? 0.9 : 0,
    };
    const t = this.ctx.currentTime;
    for (const [k, b] of this.beds) {
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setTargetAtTime(want[k] ?? 0, t, now ? 0.01 : 1.2);
    }
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
    if (p === 'bloom' || p === 'jungle' || p === 'savanna') this.bird(p === 'jungle');
    else if (p === 'marsh') this.frog();
    else if (p === 'crystal' || p === 'frost')
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
