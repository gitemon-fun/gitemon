import { describe, expect, it } from 'vitest';
import {
  FORM_MERIT,
  HOUSE_FLOOR,
  LEGEND_SEATS,
  PLAZA_FLOOR,
  SEAT_FLOOR,
  levelRungs,
  meritRungs,
} from '../src/index.js';

// v19 build 04: /ladder shows the code's own numbers
describe('ladder (v19)', () => {
  it('the 500 sealed legends add up', () => {
    expect(Object.values(LEGEND_SEATS).reduce((a, b) => a + b, 0)).toBe(500);
  });
  it('every merit line on the page is a line the game uses, in order', () => {
    const m = meritRungs().map((r) => r.merit);
    for (const line of [FORM_MERIT[2], FORM_MERIT[3], SEAT_FLOOR, HOUSE_FLOOR, PLAZA_FLOOR])
      expect(m).toContain(line);
    expect([...m].sort((a, b) => a - b)).toEqual(m);
    expect(levelRungs()).toHaveLength(2);
  });
});
