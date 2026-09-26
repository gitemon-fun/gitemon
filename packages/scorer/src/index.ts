import {
  hash32,
  typeForLanguage,
  type Score,
  type Shape,
  type Snapshot,
  type Stats,
  type TypeId,
} from '@gitemon/shared';

/**
 * The rules. A pure function: same snapshot + same version → same Gitemon.
 *
 * Power is not size (DECISIONS D6):
 *   - only work other people confirmed counts (merged into their repos, reviews, stars they gave);
 *   - commits to your own repos count for nothing on their own;
 *   - every stat is log-scaled and capped, so volume stops paying early.
 * AI use is neither detected nor punished (D7); agent accounts are tagged `machine`.
 */
export const SCORER_VERSION = 2;

/** Tuning knobs (DECISIONS: tune-at-build, locked after the sample run). */
export const TUNING = {
  /** x at which a log stat reaches 100 */
  mightAt100: 1000,
  insightAt100: 800,
  renownAt100: 100000,
  rangePerLang: 12,
  weights: { might: 0.32, insight: 0.22, renown: 0.2, grit: 0.16, range: 0.1 },
  /**
   * Evolution by rarity (DECISIONS D26): cut-offs are level percentiles of the live world
   * (8,309 Gitemon, 2026-09-25): Form 3 = top 5 % (Lv 85+), Form 2 = next 25 % (Lv 61+).
   * Both also need at least one pull request merged into someone else's repo.
   */
  form2Level: 61,
  form3Level: 85,
  formMinMerged: 1,
  dualTypeRatio: 0.25,
  polyglotLangs: 6,
  /** minimum confirmed weight for a language to count toward Range and Polyglot */
  langMinWeight: 1.5,
  shinyOdds: 256,
} as const;

const logStat = (x: number, at100: number) =>
  Math.min(100, Math.round((100 * Math.log1p(Math.max(0, x))) / Math.log1p(at100)));

/** Language weights from confirmed work only. */
export function languageWeights(s: Snapshot): Map<string, number> {
  const w = new Map<string, number>();
  const add = (lang: string | null, v: number) => {
    if (!lang || v <= 0) return;
    w.set(lang, (w.get(lang) ?? 0) + v);
  };
  for (const [lang, n] of Object.entries(s.mergedToOthers.langs)) add(lang, n);
  for (const r of s.repos) {
    if (r.fork) continue;
    // A repo counts as confirmed once someone else starred it.
    if (r.stars > 0) add(r.lang, Math.log1p(r.stars));
  }
  if (w.size === 0) {
    // Newcomers: fall back to their own repos, lightly, so they still get a type.
    for (const r of s.repos) if (!r.fork) add(r.lang, 0.1);
  }
  return w;
}

export function computeStats(s: Snapshot, langCount: number): Stats {
  const stars = s.repos.filter((r) => !r.fork).reduce((a, r) => a + r.stars, 0);
  return {
    might: logStat(s.mergedToOthers.count, TUNING.mightAt100),
    insight: logStat(s.contrib.reviews, TUNING.insightAt100),
    renown: logStat(stars, TUNING.renownAt100),
    grit: Math.round((100 * Math.min(52, s.contrib.activeWeeks)) / 52),
    range: Math.min(100, langCount * TUNING.rangePerLang),
  };
}

export function levelOf(st: Stats): number {
  const w = TUNING.weights;
  const v =
    st.might * w.might +
    st.insight * w.insight +
    st.renown * w.renown +
    st.grit * w.grit +
    st.range * w.range;
  return Math.max(1, Math.min(100, 1 + Math.round(v * 0.99)));
}

function typesOf(weights: Map<string, number>): [TypeId, TypeId | null] {
  const byType = new Map<TypeId, number>();
  for (const [lang, v] of weights) {
    const t = typeForLanguage(lang);
    byType.set(t, (byType.get(t) ?? 0) + v);
  }
  // 'wild' only wins when nothing else is there.
  const ranked = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = ranked.filter(([t]) => t !== 'wild');
  const list = named.length ? named : ranked;
  const first = list[0];
  if (!first) return ['wild', null];
  const second = list[1];
  const t2 = second && second[1] >= first[1] * TUNING.dualTypeRatio ? second[0] : null;
  return [first[0], t2];
}

function shapeOf(st: Stats, langCount: number): Shape {
  if (langCount >= TUNING.polyglotLangs) return 'polyglot';
  const order: [Shape, number][] = [
    ['builder', st.might],
    ['reviewer', st.insight],
    ['maintainer', st.renown],
    ['steady', st.grit * 0.6],
  ];
  let best = order[0]!;
  for (const o of order) if (o[1] > best[1]) best = o;
  return best[1] > 0 ? best[0] : 'steady';
}

function formOf(s: Snapshot, level: number): 1 | 2 | 3 {
  if (s.mergedToOthers.count < TUNING.formMinMerged) return 1;
  if (level >= TUNING.form3Level) return 3;
  if (level >= TUNING.form2Level) return 2;
  return 1;
}

export function isShiny(userId: number): boolean {
  return hash32(`shiny:${userId}`) % TUNING.shinyOdds === 0;
}

export function score(s: Snapshot): Score {
  const shiny = isShiny(s.userId);
  if (s.isBot) {
    return {
      scorerVersion: SCORER_VERSION,
      stats: { might: 0, insight: 0, renown: 0, grit: 0, range: 0 },
      level: 1,
      type1: 'machine',
      type2: null,
      shape: 'steady',
      form: 1,
      shiny,
      machine: true,
      notable: 0,
    };
  }
  const weights = languageWeights(s);
  const confirmedLangs = [...weights.entries()].filter(([, v]) => v >= TUNING.langMinWeight).length;
  const stats = computeStats(s, confirmedLangs);
  const level = levelOf(stats);
  const [type1, type2] = typesOf(weights);
  const form = formOf(s, level);
  return {
    scorerVersion: SCORER_VERSION,
    stats,
    level,
    type1,
    type2,
    shape: shapeOf(stats, confirmedLangs),
    form,
    shiny,
    machine: false,
    notable: level + (form - 1) * 15 + (shiny ? 40 : 0),
  };
}

// ---- v7 merit (GRANDPLAN v7 §4, V7-D2) ---------------------------------------------------------------

/**
 * Merit: a player's own work, rewarding CONSISTENCY over volume. Raw commits count — including on your
 * own repos — but only as active days (one per calendar day, whatever the count). Every term is on a
 * flattening scale and capped; fresh repos (< 14 days) and forks earn no stars; bots earn nothing.
 * 0..100. Separate from the stats and the level (D6 still holds for them).
 */
export const MERIT = {
  daysAt100: 300,
  mergedAt100: 200,
  reviewsAt100: 300,
  starsAt100: 5000,
  issuesAt100: 200,
  freshRepoDays: 14,
  weights: { days: 40, merged: 25, reviews: 15, stars: 10, issues: 10 },
} as const;

const unit = (x: number, at: number) => Math.min(1, Math.log1p(Math.max(0, x)) / Math.log1p(at));

export function merit(s: Snapshot, now = Date.parse(s.fetchedAt) || Date.now()): number {
  if (s.isBot) return 0;
  const fresh = now - MERIT.freshRepoDays * 86_400_000;
  const stars = s.repos
    .filter((r) => !r.fork && (!r.createdAt || Date.parse(r.createdAt) < fresh))
    .reduce((a, r) => a + r.stars, 0);
  // older snapshots have no activeDays: a week with activity counts as ~2 days until the next fetch
  const days = s.contrib.activeDays ?? s.contrib.activeWeeks * 2;
  const w = MERIT.weights;
  const v =
    w.days * unit(days, MERIT.daysAt100) +
    w.merged * unit(s.mergedToOthers.count, MERIT.mergedAt100) +
    w.reviews * unit(s.contrib.reviews, MERIT.reviewsAt100) +
    w.stars * unit(stars, MERIT.starsAt100) +
    w.issues * unit(s.contrib.issues, MERIT.issuesAt100);
  return Math.round(v * 10) / 10;
}
