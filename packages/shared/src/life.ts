/**
 * v18 build 08 (V18-D13): the brain of a 3D Gitemon — what its head, tail, ears, eyes and body do from one
 * frame to the next, so it feels alive standing and walking. Pure and seeded: the same seed and the same
 * inputs give the same motion (tests, and the viewer's clips). The client feeds the outputs to the shader
 * (apps/web/src/city/toys.ts) and to the body's pose (blocky.ts).
 *
 * Angles are radians. Head yaw is relative to the body (positive turns the face toward +X of the model,
 * i.e. to its right); pitch positive nods down. Tail yaw positive swings the tail to the model's right.
 */

export type Action = 'none' | 'sit' | 'bow' | 'hop' | 'evolve';

export interface Life {
  /** random state (mulberry32) */
  rng: number;
  /** body yaw (world), eased toward where it wants to face */
  face: number;
  /** turning speed (rad/s), for the lean into a turn */
  spin: number;
  /** walking 0…1, eased */
  mov: number;
  headYaw: number;
  headPitch: number;
  /** where the head wants to look while standing (relative yaw, pitch) */
  lookYaw: number;
  lookPitch: number;
  /** what the head is aiming at: 0 ahead, 1 the camera, 2 the side (kept while it holds) */
  lookKind: number;
  tail: number;
  earL: number;
  earR: number;
  /** eyes closed 0…1 */
  blink: number;
  /** chest breathing −1…1 */
  breath: number;
  /** body lift (share of height), squash (sy − 1), lean forward (rad) and roll (rad) on top of the gait */
  lift: number;
  squash: number;
  lean: number;
  roll: number;
  /** idle actions: rear lowered (sit), front lowered (bow), both 0…1 */
  sit: number;
  bow: number;
  action: Action;
  // timers (seconds of `time`)
  still: number;
  nextBlink: number;
  blinkAt: number;
  blinks: number;
  nextLook: number;
  nextEar: number;
  earAt: number;
  earSide: number;
  nextWag: number;
  wagAt: number;
  nextAction: number;
  actionAt: number;
  actionLen: number;
  settleAt: number;
  phase: number;
}

export interface LifeInput {
  /** seconds since the last step (clamped to 0.1) */
  dt: number;
  /** seconds, the scene clock */
  time: number;
  /** walking right now 0…1 (the crowd's motion) */
  moving: number;
  /** the yaw the body should face: its walking direction, or toward the camera when standing */
  want: number;
  /** the yaw from the creature toward the camera (for glances) */
  camYaw: number;
  /** the step phase (whole number = feet down) */
  steps: number;
}

/** how long things take (s) */
const BLINK = 0.16;
const EAR = 0.32;
const WAG = 1.3;
const SETTLE = 0.35;
/** standing this long before an idle action may start (s) */
const ACTION_AFTER = 4;
/** the body turns toward its target at this rate (per second) */
const TURN = 7;
/** the head may turn this far from the body */
const HEAD_MAX = 0.7;

const TAU = Math.PI * 2;
/** an angle in −π…π */
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** frame-rate independent ease toward a target at `rate` per second */
const ease = (v: number, to: number, rate: number, dt: number) =>
  v + (to - v) * (1 - Math.exp(-rate * dt));
/** 0 → 1 → 0 over [0, 1] */
const pulse = (t: number) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0);

function rand(s: Life): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (s: Life, a: number, b: number) => a + (b - a) * rand(s);

export function lifeInit(seed: number, time: number, face = 0): Life {
  const s: Life = {
    rng: seed | 0,
    face,
    spin: 0,
    mov: 0,
    headYaw: 0,
    headPitch: 0,
    lookYaw: 0,
    lookPitch: 0,
    lookKind: 0,
    tail: 0,
    earL: 0,
    earR: 0,
    blink: 0,
    breath: 0,
    lift: 0,
    squash: 0,
    lean: 0,
    roll: 0,
    sit: 0,
    bow: 0,
    action: 'none',
    still: 0,
    nextBlink: 0,
    blinkAt: -9,
    blinks: 0,
    nextLook: 0,
    nextEar: 0,
    earAt: -9,
    earSide: 1,
    nextWag: 0,
    wagAt: -9,
    nextAction: 0,
    actionAt: -9,
    actionLen: 0,
    settleAt: -9,
    phase: 0,
  };
  s.phase = between(s, 0, TAU);
  s.nextBlink = time + between(s, 0.5, 3);
  s.nextLook = time + between(s, 0.5, 2.5);
  s.nextEar = time + between(s, 2, 8);
  s.nextWag = time + between(s, 4, 10);
  s.nextAction = time + ACTION_AFTER + between(s, 2, 8);
  return s;
}

/** v19 build 02: how long the evolution moment's own action lasts (s) */
export const EVOLVE_S = 2.4;

/** v19 build 02: the evolution moment — crouch, rise into the air with a shiver, land, a big happy wag */
export function lifeEvolve(s: Life, time: number) {
  startAction(s, 'evolve', time, EVOLVE_S);
  s.nextAction = time + EVOLVE_S + 8;
}

/** a tap on the creature: a happy wag and a small hop */
export function lifeCheer(s: Life, time: number) {
  s.wagAt = time;
  if (s.mov < 0.2) startAction(s, 'hop', time, 0.55);
}

function startAction(s: Life, a: Action, time: number, len: number) {
  s.action = a;
  s.actionAt = time;
  s.actionLen = len;
}

export function lifeStep(s: Life, i: LifeInput) {
  const { time } = i;
  const dt = clamp(i.dt, 0, 0.1);
  const target = clamp(i.moving, 0, 1);

  // ---- walking: ease in and out; a stop settles with a little squash ----
  const was = s.mov;
  s.mov = ease(s.mov, target, target > s.mov ? 5 : 6, dt);
  if (was > 0.5 && target === 0 && s.mov <= 0.5) s.settleAt = time;
  const walking = s.mov > 0.05;
  s.still = walking ? 0 : s.still + dt;

  // ---- body yaw, and how fast it turns ----
  const before = s.face;
  s.face += wrapAngle(i.want - s.face) * (1 - Math.exp(-TURN * dt));
  s.face = wrapAngle(s.face);
  s.spin = ease(s.spin, dt > 0 ? wrapAngle(s.face - before) / dt : 0, 10, dt);

  // ---- body pose on top of the gait ----
  const accel = Math.max(0, target - s.mov);
  const settle = pulse((time - s.settleAt) / SETTLE);
  s.lean = 0.18 * accel;
  s.roll = clamp(-0.07 * s.spin, -0.16, 0.16) * Math.max(s.mov, 0.3);
  s.squash = -0.07 * settle;
  s.lift = 0;

  // ---- idle actions: sit, play bow, hop; any walking cancels them ----
  if (walking && s.action !== 'none' && s.action !== 'evolve') s.action = 'none';
  if (!walking && s.action === 'none' && s.still > ACTION_AFTER && time > s.nextAction) {
    const r = rand(s);
    if (r < 0.45) startAction(s, 'sit', time, between(s, 3, 6));
    else if (r < 0.75) startAction(s, 'bow', time, 1.4);
    else startAction(s, 'hop', time, 0.55);
    s.nextAction = time + s.actionLen + between(s, 6, 14);
  }
  const at = (time - s.actionAt) / Math.max(0.01, s.actionLen);
  if (s.action !== 'none' && at >= 1) s.action = 'none';
  // sit and bow ease in over 0.35 s and out over 0.35 s
  const hold = (len: number) => {
    const t = (time - s.actionAt) / 0.35;
    const out = (s.actionAt + len - time) / 0.35;
    return clamp(Math.min(t, out), 0, 1);
  };
  s.sit = ease(s.sit, s.action === 'sit' ? hold(s.actionLen) : 0, 12, dt);
  s.bow = ease(s.bow, s.action === 'bow' ? pulse(at) : 0, 14, dt);
  if (s.action === 'evolve') {
    // crouch (0–15 %), rise and hang with a shiver (15–70 %), land (70–85 %), a happy wag after
    const p = clamp(at, 0, 1);
    s.lift = 0.45 * pulse(clamp((p - 0.12) / 0.66, 0, 1));
    s.squash +=
      p < 0.15
        ? -0.16 * pulse(p / 0.15)
        : p > 0.72 && p < 0.86
          ? -0.12 * pulse((p - 0.72) / 0.14)
          : 0.04;
    s.roll += p > 0.2 && p < 0.7 ? 0.06 * Math.sin(time * 38) : 0;
    s.lookPitch = -0.25;
    if (p > 0.8) s.wagAt = Math.max(s.wagAt, time - 0.05);
  }
  if (s.action === 'hop') {
    // crouch, jump, land
    const p = clamp(at, 0, 1);
    s.lift = 0.22 * pulse(clamp((p - 0.25) / 0.6, 0, 1));
    s.squash +=
      p < 0.25 ? -0.12 * pulse(p / 0.25) : p > 0.85 ? -0.1 * pulse((p - 0.85) / 0.15) : 0.06;
  }

  // ---- head: leads a turn while walking, nods in step; glances while standing ----
  if (walking) {
    s.lookKind = 0;
    s.lookYaw = clamp(wrapAngle(i.want - s.face) * 0.9, -HEAD_MAX, HEAD_MAX);
    s.lookPitch = 0.045 * Math.sin(TAU * i.steps) * s.mov;
    s.nextLook = time + between(s, 1, 2.5);
  } else {
    if (time > s.nextLook) {
      const r = rand(s);
      s.lookKind = r < 0.45 ? 1 : r < 0.8 ? 2 : 0;
      s.lookPitch = rand(s) < 0.35 ? between(s, -0.25, 0.2) : between(s, -0.06, 0.06);
      if (s.lookKind === 2) s.lookYaw = between(s, -HEAD_MAX, HEAD_MAX);
      if (s.lookKind === 0) s.lookYaw = 0;
      s.nextLook = time + between(s, 1.8, 5.5);
    }
    // looking at the camera follows it as the body or the camera turns
    if (s.lookKind === 1) s.lookYaw = clamp(wrapAngle(i.camYaw - s.face), -HEAD_MAX, HEAD_MAX);
    if (s.action === 'bow') s.lookPitch = -0.12;
  }
  s.headYaw = ease(s.headYaw, s.lookYaw, walking ? 8 : 5, dt);
  s.headPitch = ease(s.headPitch, s.lookPitch, walking ? 14 : 5, dt);

  // ---- eyes: a blink every few seconds, sometimes two ----
  if (time > s.nextBlink) {
    s.blinkAt = time;
    s.blinks = rand(s) < 0.2 ? 2 : 1;
    s.nextBlink = time + between(s, 2, 5.5);
  }
  const bt = (time - s.blinkAt) / BLINK;
  s.blink = s.blinks === 2 ? pulse(bt) + pulse(bt - 1.3) : pulse(bt);

  // ---- ears: now and then one ear flicks twice ----
  if (time > s.nextEar) {
    s.earAt = time;
    s.earSide = rand(s) < 0.5 ? -1 : 1;
    s.nextEar = time + between(s, 3, 9);
  }
  const et = (time - s.earAt) / EAR;
  const flick = 0.45 * (pulse(et * 2) + 0.6 * pulse(et * 2 - 1));
  s.earL = s.earSide < 0 ? flick : 0;
  s.earR = s.earSide > 0 ? flick : 0;

  // ---- tail: follows the body's rock late while walking; sways, and wags in bursts, standing ----
  if (!walking && time > s.nextWag) {
    s.wagAt = time;
    s.nextWag = time + between(s, 5, 12);
  }
  const wag = pulse((time - s.wagAt) / WAG);
  const walkTail = 0.32 * Math.sin(Math.PI * i.steps - 1.1) * s.mov;
  const idleTail = 0.13 * Math.sin(time * 1.5 + s.phase) * (1 - s.mov);
  s.tail = walkTail + idleTail + 0.38 * wag * Math.sin((time - s.wagAt) * 15);

  // ---- breathing: slower and deeper standing, quicker walking ----
  s.breath = Math.sin(time * (1.7 + 1.5 * s.mov) + s.phase);
}
