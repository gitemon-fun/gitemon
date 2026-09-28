/**
 * v11 (GRANDPLAN v11 §4, V11-D2/D3/D5): status has to be earned. Pure — the map, the daily job and
 * the Worker use the same numbers. Chosen from the 300-player simulation on real merit data
 * (ordinary developers: median 16, p75 41; Theo-class 76–82; centre-class 92).
 */

/** a plaza seat: the top 1 % of players AND at least this merit */
export const PLAZA_FLOOR = 75;
/** a Merit House: top 3 of the region (kept while top 5) AND at least this merit */
export const HOUSE_FLOOR = 50;
/** a champion seat on a mini plaza: top 6 of the type AND at least this merit */
export const SEAT_FLOOR = 40;
/** most plaza seats there can ever be (the plaza's champion rings) */
export const PLAZA_MAX = 24;

/** how many plaza seats a population of `players` signed-in players earns: 1 %, at least 1 */
export const plazaSeatCount = (players: number) =>
  Math.max(1, Math.min(PLAZA_MAX, Math.round(players * 0.01)));

/** V11-D5: the form steady work earns (Form 2 at merit 40, Form 3 at 70); the scorer's form may be higher */
export const meritForm = (merit: number): 1 | 2 | 3 => (merit >= 70 ? 3 : merit >= 40 ? 2 : 1);
