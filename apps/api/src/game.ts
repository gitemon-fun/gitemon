import { PLOT, PLOTS, plotRect, type Snapshot, type TypeId } from '@gitemon/shared';
import { hasMergedInto } from '@gitemon/ingest';
import { byId, now, relocate, type Row } from './world.js';

/** Realness gate for the claim buff (anti sock-puppet). Thresholds come from env config. */
export function isReal(snap: Snapshot, minAgeDays: number): boolean {
  const ageDays = (Date.now() - Date.parse(snap.createdAt)) / 86_400_000;
  const confirmed =
    snap.mergedToOthers.count >= 1 ||
    snap.repos.some((r) => !r.fork && r.stars >= 1) ||
    snap.contrib.activeWeeks >= 4;
  return ageDays >= minAgeDays && confirmed;
}

const AURA_DAYS = 30;
const auraUntil = () => new Date(Date.now() + AURA_DAYS * 86_400_000).toISOString();

/**
 * Claim: a developer signed in for real. Their Gitemon stops being wild and moves into the
 * starter village. If they pass the realness gate, everyone who caught them before the claim
 * gets a buff once (the first 10 get the scout buff), and the claimer gets one buff too.
 */
export async function claim(db: D1Database, me: Row, real: boolean): Promise<{ buffed: number }> {
  if (me.status === 'claimed') return { buffed: 0 };
  const t = now();
  await db
    .prepare("UPDATE gitemon SET status='claimed', claimed_at=?, hidden=0 WHERE id=?")
    .bind(t, me.id)
    .run();
  if (me.town_id == null) await relocate(db, me.id, me.t1, { kind: 'village' });
  if (!real) return { buffed: 0 };
  const catchers = await db
    .prepare('SELECT catcher_id, n FROM catches WHERE target_id = ? AND created_at <= ?')
    .bind(me.id, t)
    .all<{ catcher_id: number; n: number }>();
  const stmts: D1PreparedStatement[] = [];
  const until = auraUntil();
  for (const c of catchers.results) {
    const scout = c.n <= 10;
    stmts.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO buffs (user_id, source_id, kind, xp, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(c.catcher_id, me.id, scout ? 'scout' : 'claimed', scout ? 30 : 15, t),
      db.prepare('UPDATE gitemon SET aura_until = ? WHERE id = ?').bind(until, c.catcher_id),
    );
  }
  if (catchers.results.length) {
    stmts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO buffs (user_id, source_id, kind, xp, created_at) VALUES (?, 0, 'claimer', 20, ?)",
        )
        .bind(me.id, t),
      db.prepare('UPDATE gitemon SET aura_until = ? WHERE id = ?').bind(until, me.id),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { buffed: catchers.results.length };
}

/** Bonus levels from friendship buffs: capped at +5, fading to zero over 30 days. */
export async function bonusLevels(db: D1Database, id: number): Promise<number> {
  const rows = await db
    .prepare('SELECT xp, created_at FROM buffs WHERE user_id = ?')
    .bind(id)
    .all<{ xp: number; created_at: string }>();
  let xp = 0;
  for (const b of rows.results) {
    const age = (Date.now() - Date.parse(b.created_at)) / 86_400_000;
    xp += b.xp * Math.max(0, 1 - age / AURA_DAYS);
  }
  return Math.min(5, Math.floor(xp / 10));
}

export type CatchResult =
  | { ok: true; n: number; left: number }
  | { ok: false; error: 'not-found' | 'self' | 'already' | 'limit' | 'hidden' };

export async function doCatch(
  db: D1Database,
  me: { id: number; login: string },
  targetId: number,
  dailyLimit: number,
): Promise<CatchResult> {
  if (targetId === me.id) return { ok: false, error: 'self' };
  const target = await byId(db, targetId);
  if (!target) return { ok: false, error: 'not-found' };
  if (target.hidden) return { ok: false, error: 'hidden' };
  const since = new Date(new Date().toISOString().slice(0, 10)).toISOString();
  const today = await db
    .prepare('SELECT COUNT(*) AS n FROM catches WHERE catcher_id = ? AND created_at >= ?')
    .bind(me.id, since)
    .first<{ n: number }>();
  const used = today?.n ?? 0;
  if (used >= dailyLimit) return { ok: false, error: 'limit' };
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO catches (catcher_id, target_id, n, bonded, created_at)
       VALUES (?, ?, (SELECT caught_count + 1 FROM gitemon WHERE id = ?), 0, ?)`,
    )
    .bind(me.id, targetId, targetId, now())
    .run();
  if (!res.meta.changes) return { ok: false, error: 'already' };
  await db
    .prepare('UPDATE gitemon SET caught_count = caught_count + 1 WHERE id = ?')
    .bind(targetId)
    .run();
  const row = await db
    .prepare('SELECT n FROM catches WHERE catcher_id = ? AND target_id = ?')
    .bind(me.id, targetId)
    .first<{ n: number }>();
  return { ok: true, n: row?.n ?? 1, left: dailyLimit - used - 1 };
}

/** Bonded = the two have really worked together: one merged a PR into a repo the other owns. */
export async function checkBonded(
  db: D1Database,
  me: { id: number; login: string },
  target: Row,
  token: string,
) {
  try {
    const bonded =
      (await hasMergedInto(me.login, target.login, token)) ||
      (await hasMergedInto(target.login, me.login, token));
    if (bonded)
      await db
        .prepare('UPDATE catches SET bonded = 1 WHERE catcher_id = ? AND target_id = ?')
        .bind(me.id, target.id)
        .run();
  } catch {
    // best effort; a failed check leaves the catch unbonded
  }
}

// ---- towns ------------------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '.-]{1,22}[A-Za-z0-9.]$/;
const BLOCKED = [
  'admin',
  'gitemon',
  'official',
  'moderator',
  'nazi',
  'hitler',
  'nigg',
  'fag',
  'rape',
  'porn',
  'sex',
];

export function validTownName(name: string): boolean {
  if (!NAME_RE.test(name)) return false;
  const low = name.toLowerCase().replace(/[^a-z]/g, '');
  return !BLOCKED.some((b) => low.includes(b));
}

export const TOWN_CAP = PLOT * PLOT;

export async function foundTown(db: D1Database, me: Row, name: string) {
  if (!validTownName(name)) return { ok: false as const, error: 'bad-name' };
  const biome: TypeId = me.t1;
  const used = await db
    .prepare('SELECT plot FROM towns WHERE biome = ?')
    .bind(biome)
    .all<{ plot: number }>();
  const taken = new Set(used.results.map((r) => r.plot));
  const plot = PLOTS.findIndex((_, i) => !taken.has(i));
  if (plot < 0) return { ok: false as const, error: 'biome-full' };
  try {
    const r = await db
      .prepare(
        "INSERT INTO towns (name, biome, plot, kind, founder_id, members, created_at) VALUES (?, ?, ?, 'clan', ?, 0, ?) RETURNING id",
      )
      .bind(name, biome, plot, me.id, now())
      .first<{ id: number }>();
    await joinTown(db, me, r!.id, true);
    return { ok: true as const, id: r!.id };
  } catch (e) {
    if (String(e).includes('UNIQUE')) return { ok: false as const, error: 'taken' };
    throw e;
  }
}

export async function joinTown(db: D1Database, me: Row, townId: number, skipEligibility = false) {
  const town = await db.prepare('SELECT * FROM towns WHERE id = ?').bind(townId).first<{
    id: number;
    biome: TypeId;
    plot: number;
    kind: string;
    owner_login: string | null;
    members: number;
  }>();
  if (!town) return { ok: false as const, error: 'not-found' };
  if (me.town_id === town.id) return { ok: true as const };
  if (town.members >= TOWN_CAP) return { ok: false as const, error: 'full' };
  if (!skipEligibility && town.kind === 'official' && town.owner_login) {
    const snap = JSON.parse(me.snapshot) as Snapshot;
    if (!snap.mergedToOthers.owners.includes(town.owner_login.toLowerCase()))
      return { ok: false as const, error: 'not-eligible' };
  }
  if (me.town_id != null) await leaveTown(db, me, false);
  await relocate(db, me.id, me.t1, { kind: 'plot', rect: plotRect(town.biome, town.plot) });
  await db.batch([
    db.prepare('UPDATE gitemon SET town_id = ? WHERE id = ?').bind(town.id, me.id),
    db.prepare('UPDATE towns SET members = members + 1 WHERE id = ?').bind(town.id),
  ]);
  return { ok: true as const };
}

export async function leaveTown(db: D1Database, me: Row, moveHome = true) {
  if (me.town_id == null) return;
  await db.batch([
    db.prepare('UPDATE gitemon SET town_id = NULL WHERE id = ?').bind(me.id),
    db.prepare('UPDATE towns SET members = members - 1 WHERE id = ?').bind(me.town_id),
    db
      .prepare("DELETE FROM towns WHERE id = ? AND kind = 'clan' AND members <= 0")
      .bind(me.town_id),
  ]);
  if (moveHome) await relocate(db, me.id, me.t1, { kind: 'village' });
}
