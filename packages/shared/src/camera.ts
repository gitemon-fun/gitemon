/**
 * v13 camera maths (GRANDPLAN v13): pure, so the scene and the tests agree. The camera sits at angle
 * `yaw` from its pivot (position = pivot + (cos yaw, ·, sin yaw) · distance) and looks back at it.
 */

/** tilt limits for the island camera (V13-D2): 18°–70° */
export const PITCH_MIN = (18 * Math.PI) / 180;
export const PITCH_MAX = (70 * Math.PI) / 180;
/** the walk camera (V13-D5/D6): ~34° off straight behind, pitch 28°, never below 20° */
export const FOLLOW_OFFSET = 0.6;
export const FOLLOW_PITCH = (28 * Math.PI) / 180;
export const FOLLOW_PITCH_MIN = (20 * Math.PI) / 180;
/** zooming out past this leaves the walk camera */
export const FOLLOW_MIN_ZOOM = 2.2;

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
