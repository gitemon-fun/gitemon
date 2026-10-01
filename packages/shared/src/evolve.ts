/**
 * v19 build 02 (V19-D3): how a Gitemon gets to its next form, and when the evolution moment plays. A form rises
 * on either path — steady work (merit, V11-D5) or the scorer's level (D26) — whichever comes first; the stored
 * form is the highest of both and never goes back (apps/api/src/world.ts). The scorer's level lines are kept
 * equal to FORM_LEVEL by a test in packages/scorer.
 */

/** the merit each form needs (V11-D5) */
export const FORM_MERIT = { 2: 40, 3: 70 } as const;
/** the scorer's level each form needs (TUNING.form2Level / form3Level) */
export const FORM_LEVEL = { 2: 61, 3: 85 } as const;

export interface NextForm {
  to: 2 | 3;
  merit: { have: number; need: number };
  level: { have: number; need: number };
  /** how far along the nearer path is, 0…1 */
  share: number;
}

/** the way to the next form; null at Form 3 */
export function nextForm(form: 1 | 2 | 3, merit: number, level: number): NextForm | null {
  if (form >= 3) return null;
  const to = (form + 1) as 2 | 3;
  const m = { have: Math.max(0, merit), need: FORM_MERIT[to] };
  const l = { have: Math.max(0, level), need: FORM_LEVEL[to] };
  const share = Math.min(1, Math.max(m.have / m.need, l.have / l.need));
  return { to, merit: m, level: l, share };
}

/**
 * The form the moment should grow from, or null when there is nothing to show: the stored form is higher than
 * the last form the player saw. A missing `seen` (before v19) counts as seen, so nobody gets a false moment.
 */
export function evolvedFrom(form: number, seen: number | null | undefined): 1 | 2 | null {
  if (seen == null || form <= seen) return null;
  return Math.max(1, Math.min(2, seen)) as 1 | 2;
}
