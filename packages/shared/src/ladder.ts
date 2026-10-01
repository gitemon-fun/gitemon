import { FORM_LEVEL, FORM_MERIT } from './evolve.js';
import { standingStep } from './gait.js';
import { HOUSE_FLOOR, PLAZA_FLOOR, PLAZA_MAX, SEAT_FLOOR } from './standing.js';

/**
 * v19 build 04 (V19-D1): the two ladders, as players read them on /ladder — built from the code's own numbers,
 * so the page can never drift from the game. WHO YOU ARE is given once (type, legend); WHAT YOU EARNED grows
 * with steady work and is never taken away.
 */

/** the 500 sealed legends by tier (V5-D3); each belongs to one developer and is never earned */
export const LEGEND_SEATS = {
  origin: 1,
  guardian: 2,
  legendary: 7,
  mythic: 40,
  epic: 150,
  rare: 300,
} as const;

export interface Rung {
  merit: number;
  gives: string;
  /** places that only the best reach (a ranking, not a line) */
  rare?: boolean;
}

/** what each merit line gives, lowest first */
export function meritRungs(): Rung[] {
  const pct = (m: number) => Math.round((standingStep(m) - 1) * 100);
  return [
    { merit: 35, gives: `Your Gitemon stands ${pct(35)} % bigger` },
    { merit: FORM_MERIT[2], gives: 'Form 2: a new body and its first new piece' },
    {
      merit: SEAT_FLOOR,
      gives: 'A champion seat on your type’s mini plaza, if you are in its top 6',
      rare: true,
    },
    {
      merit: HOUSE_FLOOR,
      gives: 'A Merit House in your land, if you are in its top 3',
      rare: true,
    },
    { merit: 60, gives: `Your Gitemon stands ${pct(60)} % bigger` },
    { merit: FORM_MERIT[3], gives: 'Form 3: its final body and its second new piece' },
    {
      merit: PLAZA_FLOOR,
      gives: `A seat on the plaza round the monument, if you are in the top 1 % (at most ${PLAZA_MAX} seats)`,
      rare: true,
    },
  ];
}

/** the other road to a form: the level your public work earns */
export const levelRungs = () => [
  { level: FORM_LEVEL[2], gives: 'Form 2' },
  { level: FORM_LEVEL[3], gives: 'Form 3' },
];
