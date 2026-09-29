/**
 * v13 camera maths (GRANDPLAN v13): pure, so the scene and the tests agree. The camera sits at angle
 * `yaw` from its pivot (position = pivot + (cos yaw, ·, sin yaw) · distance) and looks back at it.
 */

/** tilt limits for the island camera (V13-D2): 18°–70° */
export const PITCH_MIN = (18 * Math.PI) / 180;
export const PITCH_MAX = (70 * Math.PI) / 180;
/** the walk camera (V13-D5/D6): ~34° off straight behind, pitch 28°, never below 20° */
export const FOLLOW_OFFSET = 0.6;

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** exponential approach: frame-rate independent, never overshoots */
export const approach = (cur: number, goal: number, dt: number, rate: number) =>
  goal + (cur - goal) * Math.exp(-rate * dt);

/** the same for an angle, the short way round */
export const approachAngle = (cur: number, goal: number, dt: number, rate: number) =>
  cur + wrapAngle(goal - cur) * (1 - Math.exp(-rate * dt));

/** inertia: a velocity that dies away (rate 7 → under 1 % after 0.66 s) */
export const decay = (v: number, dt: number, rate: number) => v * Math.exp(-rate * dt);

export const clampPitch = (p: number, min = PITCH_MIN) => Math.min(PITCH_MAX, Math.max(min, p));

/**
 * The walk camera's yaw for a direction of travel: behind the Gitemon and to one side (the sprites have
 * no back view, V13-D5) — the side the camera is already nearer to, so it never swings across.
 */
export function followYaw(travel: number, current: number, offset = FOLLOW_OFFSET): number {
  const behind = travel + Math.PI;
  const a = behind + offset;
  const b = behind - offset;
  return Math.abs(wrapAngle(a - current)) <= Math.abs(wrapAngle(b - current)) ? a : b;
}

/** how far the view is from straight behind the Gitemon (radians, 0 = straight behind) */
export const offBehind = (yaw: number, travel: number) =>
  Math.abs(wrapAngle(yaw - (travel + Math.PI)));

/** a twist must pass this (radians, ≈ 11°) before two fingers turn the map, so a pinch stays level */
export const TWIST_START = 0.2;

type Finger = { x: number; y: number };
/**
 * Which two-finger gesture this is (v13.1). Both fingers moving up or down together, side by side,
 * without spreading or twisting, is a tilt (like R / F). A clear spread, twist or slide is a zoom, which
 * also turns and pans. Until one of them is clear the answer is null, so a pinch never tilts by accident.
 */
export function twoFingerMode(
  a0: Finger,
  b0: Finger,
  a: Finger,
  b: Finger,
): 'tilt' | 'zoom' | null {
  const d0 = Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
  const spread = Math.abs(Math.log(Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) / d0));
  const twist = Math.abs(
    wrapAngle(Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)),
  );
  const dya = a.y - a0.y;
  const dyb = b.y - b0.y;
  const sideBySide = Math.abs(a0.y - b0.y) < Math.abs(a0.x - b0.x);
  if (
    sideBySide &&
    dya * dyb > 0 &&
    Math.min(Math.abs(dya), Math.abs(dyb)) > 14 &&
    spread < 0.08 &&
    twist < 0.12
  )
    return 'tilt';
  const slide = Math.hypot((a.x + b.x - a0.x - b0.x) / 2, (a.y + b.y - a0.y - b0.y) / 2);
  if (spread > 0.06 || twist > 0.15 || slide > 18) return 'zoom';
  return null;
}

// ---- v13.2 (V13-D10): the walk view, a third-person camera behind your Gitemon --------------------

/** how far behind (metres), how high (radians) and how wide the walk view looks */
export const TP_DIST = 9;
export const TP_DIST_MIN = 3.5;
export const TP_DIST_MAX = 22;
export const TP_PITCH = (14 * Math.PI) / 180;
export const TP_PITCH_MIN = (3 * Math.PI) / 180;
export const TP_PITCH_MAX = (55 * Math.PI) / 180;
export const TP_FOV = 58;
/** on a tapped walk the camera swings round behind the Gitemon, this far to one side */
export const TP_SIDE = 0.25;
/** the most a Gitemon's cut-out turns toward the way it walks (radians, ≈ 50°) */
export const PAPER_MAX = 0.87;

export const clampTpDist = (d: number) => Math.min(TP_DIST_MAX, Math.max(TP_DIST_MIN, d));
export const clampTpPitch = (p: number) => Math.min(TP_PITCH_MAX, Math.max(TP_PITCH_MIN, p));

/**
 * The spring arm: from the focus point out along `d` (a unit direction), the camera stops short of any
 * ground in the way, so a hill behind your Gitemon brings the camera closer instead of hiding the view.
 */
export function springArm(
  fx: number,
  fy: number,
  fz: number,
  dx: number,
  dy: number,
  dz: number,
  dist: number,
  ground: (x: number, z: number) => number,
  clearance = 0.6,
  min = 2.2,
): number {
  const n = 16;
  for (let k = 1; k <= n; k++) {
    const t = (dist * k) / n;
    if (fy + dy * t < ground(fx + dx * t, fz + dz * t) + clearance)
      return Math.max(min, (dist * (k - 1)) / n);
  }
  return dist;
}

/**
 * The paper turn. The sprites are side views with no back (V13-D5), so in the walk view your Gitemon's
 * cut-out turns toward the way it walks, like a paper figure, by at most `max`: walking away it shows
 * its side going into the picture instead of a flat side gliding up the screen.
 * r = the camera's right on the ground (x, z); t = the way it walks; dir = which way the sprite faces on
 * screen (±1, as the crowd flips it); k = how much of the turn (0 = flat to the camera, 1 = full).
 * Returns the cut-out's right (x, z).
 */
export function paperTurn(
  rx: number,
  rz: number,
  tx: number,
  tz: number,
  dir: number,
  max: number,
  k: number,
): [number, number] {
  const l = Math.hypot(tx, tz);
  if (l < 1e-6 || k <= 0) return [rx, rz];
  const ux = (dir * tx) / l;
  const uz = (dir * tz) / l;
  const a = Math.atan2(rx * uz - rz * ux, rx * ux + rz * uz);
  const turn = Math.sign(a) * Math.min(Math.abs(a), max) * Math.min(1, k);
  const c = Math.cos(turn);
  const sn = Math.sin(turn);
  return [rx * c - rz * sn, rx * sn + rz * c];
}
