import { TYPES, type TypeId } from './types.js';
import { hash32 } from './hash.js';

/**
 * The world is a grid of biomes, one per type. Each biome is BIOME x BIOME slots; one Gitemon
 * per slot. Inside a biome (local coords):
 *   - starter village: the centre VILLAGE x VILLAGE square
 *   - town ring: the square [TOWN_MIN, TOWN_MAX), cut into PLOT x PLOT plots (minus the village)
 *   - wild land: everything outside the town ring
 */
export const BIOME = 256;
export const COLS = 6;
export const ROWS = 3;
export const WORLD_W = BIOME * COLS;
export const WORLD_H = BIOME * ROWS;
export const VILLAGE = 32;
export const VILLAGE_MIN = (BIOME - VILLAGE) / 2;
export const TOWN_MIN = 64;
export const TOWN_MAX = 192;
export const PLOT = 16;
export const CHUNK = 32;

/** Biome order on the grid. Machine Wastes sit at the bottom-right edge. */
export const BIOME_ORDER: TypeId[] = [...TYPES];

export function biomeOrigin(t: TypeId): { x: number; y: number } {
  const i = BIOME_ORDER.indexOf(t);
  return { x: (i % COLS) * BIOME, y: Math.floor(i / COLS) * BIOME };
}

export function biomeAt(x: number, y: number): TypeId | null {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return null;
  return BIOME_ORDER[Math.floor(y / BIOME) * COLS + Math.floor(x / BIOME)] ?? null;
}

export type Zone = 'village' | 'town' | 'wild';

export function zoneOf(lx: number, ly: number): Zone {
  const inV = (v: number) => v >= VILLAGE_MIN && v < VILLAGE_MIN + VILLAGE;
  if (inV(lx) && inV(ly)) return 'village';
  const inT = (v: number) => v >= TOWN_MIN && v < TOWN_MAX;
  if (inT(lx) && inT(ly)) return 'town';
  return 'wild';
}

/** Town plots in a biome, in allocation order (village plots excluded). */
export function plotList(): { px: number; py: number }[] {
  const out: { px: number; py: number }[] = [];
  const n = (TOWN_MAX - TOWN_MIN) / PLOT;
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      const lx = TOWN_MIN + px * PLOT;
      const ly = TOWN_MIN + py * PLOT;
      const overlapsVillage =
        lx < VILLAGE_MIN + VILLAGE &&
        lx + PLOT > VILLAGE_MIN &&
        ly < VILLAGE_MIN + VILLAGE &&
        ly + PLOT > VILLAGE_MIN;
      if (!overlapsVillage) out.push({ px, py });
    }
  return out;
}
export const PLOTS = plotList();

/** World rectangle of plot `index` in biome `t`. */
export function plotRect(t: TypeId, index: number) {
  const p = PLOTS[index];
  if (!p) throw new Error(`no plot ${index}`);
  const o = biomeOrigin(t);
  return { x: o.x + TOWN_MIN + p.px * PLOT, y: o.y + TOWN_MIN + p.py * PLOT, w: PLOT, h: PLOT };
}

export function villageRect(t: TypeId) {
  const o = biomeOrigin(t);
  return { x: o.x + VILLAGE_MIN, y: o.y + VILLAGE_MIN, w: VILLAGE, h: VILLAGE };
}

/**
 * Candidate wild slots for a user, in probe order. Wild Gitemon pack densely around the town ring
 * and the populated band grows outward with the biome's population, so neighbours are visible at
 * street zoom. Only one colour of a checkerboard is used, so sprites never touch.
 * Deterministic for a given (user, population).
 */
export function* wildCandidates(
  t: TypeId,
  userId: number,
  population = 0,
): Generator<{ x: number; y: number }> {
  const o = biomeOrigin(t);
  const inner = TOWN_MAX - TOWN_MIN;
  const need = population * 2.5 + 200;
  let r = 1;
  while (r < TOWN_MIN && ((inner + 2 * r) ** 2 - inner ** 2) / 2 < need) r++;
  let h = hash32(`slot:${userId}`);
  let yielded = 0;
  for (let i = 0; i < 20_000; i++) {
    // Sample straight from the band around the town square (four strips), no rejection loop.
    const span = inner + 2 * r;
    const strip = r * span;
    const side = r * inner;
    let k = h % (2 * strip + 2 * side);
    h = hash32(`slot:${userId}:${i}`);
    let lx: number;
    let ly: number;
    if (k < strip) {
      lx = TOWN_MIN - r + (k % span);
      ly = TOWN_MIN - r + Math.floor(k / span);
    } else if ((k -= strip) < strip) {
      lx = TOWN_MIN - r + (k % span);
      ly = TOWN_MAX + Math.floor(k / span);
    } else if ((k -= strip) < side) {
      lx = TOWN_MIN - r + (k % r);
      ly = TOWN_MIN + Math.floor(k / r);
    } else {
      k -= side;
      lx = TOWN_MAX + (k % r);
      ly = TOWN_MIN + Math.floor(k / r);
    }
    if ((lx + ly) % 2 !== 0) continue;
    yield { x: o.x + lx, y: o.y + ly };
    // every 48 offers that were all taken: the band is crowded, widen it
    if (++yielded % 48 === 0 && r < TOWN_MIN) r = Math.min(TOWN_MIN, r + 4);
  }
}

/** Candidate slots inside a rectangle (village or plot), seeded by user id. */
export function* rectCandidates(
  r: { x: number; y: number; w: number; h: number },
  userId: number,
): Generator<{ x: number; y: number }> {
  const n = r.w * r.h;
  const start = hash32(`rect:${userId}`) % n;
  for (let i = 0; i < n; i++) {
    const k = (start + i) % n;
    yield { x: r.x + (k % r.w), y: r.y + Math.floor(k / r.w) };
  }
}
