import { merit, score } from '@gitemon/scorer';
import {
  CHUNK,
  WORLD_W,
  rectCandidates,
  villageRect,
  wildCandidates,
  type MapGitemon,
  type Score,
  type Snapshot,
  type TypeId,
} from '@gitemon/shared';

export interface Row {
  id: number;
  login: string;
  name: string | null;
  status: 'wild' | 'claimed';
  hidden: number;
  x: number;
  y: number;
  t1: TypeId;
  t2: TypeId | null;
  shape: MapGitemon['sh'];
  form: 1 | 2 | 3;
  shiny: number;
  machine: number;
  level: number;
  notable: number;
  stats: string;
  scorer_version: number;
  snapshot: string;
  fetched_at: string;
  chunk: number;
  aura_until: string | null;
  created_at: string;
  claimed_at: string | null;
  town_id: number | null;
  caught_count: number;
  merit?: number;
}

export const chunkOf = (x: number, y: number) =>
  Math.floor(y / CHUNK) * (WORLD_W / CHUNK) + Math.floor(x / CHUNK);
export const now = () => new Date().toISOString();

export async function byId(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM gitemon WHERE id = ?').bind(id).first<Row>();
}
export async function byLogin(db: D1Database, login: string) {
  return db
    .prepare('SELECT * FROM gitemon WHERE login = ? COLLATE NOCASE')
    .bind(login)
    .first<Row>();
}

/** First free slot among candidates, checked in batches of 32. */
async function firstFree(
  db: D1Database,
  cands: Iterable<{ x: number; y: number }>,
  skip = new Set<string>(),
) {
  let batch: { x: number; y: number }[] = [];
  const check = async () => {
    const values = batch.map(() => '(?, ?)').join(',');
    const taken = await db
      .prepare(`SELECT x, y FROM gitemon WHERE (x, y) IN (VALUES ${values})`)
      .bind(...batch.flatMap((c) => [c.x, c.y]))
      .all<{ x: number; y: number }>();
    const used = new Set(taken.results.map((r) => `${r.x},${r.y}`));
    return batch.find((c) => !used.has(`${c.x},${c.y}`) && !skip.has(`${c.x},${c.y}`)) ?? null;
  };
  for (const c of cands) {
    batch.push(c);
    if (batch.length === 32) {
      const hit = await check();
      if (hit) return hit;
      batch = [];
    }
  }
  if (batch.length) return check();
  return null;
}

export type Home =
  | { kind: 'wild' }
  | { kind: 'village' }
  | { kind: 'plot'; rect: { x: number; y: number; w: number; h: number } };

export async function findSlot(
  db: D1Database,
  id: number,
  t1: TypeId,
  home: Home,
  skip?: Set<string>,
) {
  if (home.kind === 'plot') return firstFree(db, rectCandidates(home.rect, id), skip);
  if (home.kind === 'village') {
    const s = await firstFree(db, rectCandidates(villageRect(t1), id), skip);
    if (s) return s;
  }
  const pop = await db
    .prepare('SELECT n FROM biome_pop WHERE t1 = ?')
    .bind(t1)
    .first<{ n: number }>();
  return firstFree(db, wildCandidates(t1, id, pop?.n ?? 0), skip);
}

/** Move a Gitemon to a new home. Retries on the rare unique-slot race. */
export async function relocate(
  db: D1Database,
  id: number,
  t1: TypeId,
  home: Home,
): Promise<{ x: number; y: number }> {
  const skip = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const s = await findSlot(db, id, t1, home, skip);
    if (!s) throw new Error('world full');
    try {
      await db
        .prepare('UPDATE gitemon SET x = ?, y = ?, chunk = ? WHERE id = ?')
        .bind(s.x, s.y, chunkOf(s.x, s.y), id)
        .run();
      return s;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
      skip.add(`${s.x},${s.y}`);
    }
  }
  throw new Error('no slot after retries');
}

function scoreCols(sc: Score) {
  return {
    t1: sc.type1,
    t2: sc.type2,
    shape: sc.shape,
    form: sc.form,
    shiny: sc.shiny ? 1 : 0,
    machine: sc.machine ? 1 : 0,
    level: sc.level,
    notable: sc.notable,
    stats: JSON.stringify(sc.stats),
    scorer_version: sc.scorerVersion,
  };
}

/**
 * Insert or refresh a Gitemon from a snapshot. The only path by which Gitemon enter the world.
 * Returns the row after the write.
 */
export async function ingest(db: D1Database, snap: Snapshot): Promise<Row> {
  const row = await ingestScored(db, snap);
  // v7 (V7-D2): merit, recomputed on every fresh snapshot
  await db
    .prepare('UPDATE gitemon SET merit = ? WHERE id = ?')
    .bind(merit(snap), snap.userId)
    .run();
  return { ...row, merit: merit(snap) } as Row;
}

async function ingestScored(db: D1Database, snap: Snapshot): Promise<Row> {
  const sc = score(snap);
  const cols = scoreCols(sc);
  const existing = await byId(db, snap.userId);
  if (existing) {
    // A renamed account frees its old login for whoever owns it now.
    await db
      .prepare('DELETE FROM gitemon WHERE login = ? COLLATE NOCASE AND id != ?')
      .bind(snap.login, snap.userId)
      .run();
    await db
      .prepare(
        `UPDATE gitemon SET login=?, name=?, t1=?, t2=?, shape=?, form=?, shiny=?, machine=?, level=?, notable=?,
         stats=?, scorer_version=?, snapshot=?, fetched_at=? WHERE id=?`,
      )
      .bind(
        snap.login,
        snap.name,
        cols.t1,
        cols.t2,
        cols.shape,
        cols.form,
        cols.shiny,
        cols.machine,
        cols.level,
        cols.notable,
        cols.stats,
        cols.scorer_version,
        JSON.stringify(snap),
        snap.fetchedAt,
        snap.userId,
      )
      .run();
    // Main language changed and it lives outside a town: move it to its new biome.
    if (existing.t1 !== cols.t1) await movePop(db, existing.t1, cols.t1);
    if (existing.t1 !== cols.t1 && existing.town_id == null) {
      await relocate(
        db,
        snap.userId,
        cols.t1,
        existing.status === 'claimed' ? { kind: 'village' } : { kind: 'wild' },
      );
    }
    return (await byId(db, snap.userId))!;
  }
  await db.prepare('DELETE FROM gitemon WHERE login = ? COLLATE NOCASE').bind(snap.login).run();
  const skip = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const s = await findSlot(db, snap.userId, cols.t1, { kind: 'wild' }, skip);
    if (!s) throw new Error('world full');
    try {
      await db
        .prepare(
          `INSERT INTO gitemon (id, login, name, status, hidden, x, y, chunk, t1, t2, shape, form, shiny, machine, level,
           notable, stats, scorer_version, snapshot, fetched_at, created_at)
           VALUES (?, ?, ?, 'wild', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          snap.userId,
          snap.login,
          snap.name,
          s.x,
          s.y,
          chunkOf(s.x, s.y),
          cols.t1,
          cols.t2,
          cols.shape,
          cols.form,
          cols.shiny,
          cols.machine,
          cols.level,
          cols.notable,
          cols.stats,
          cols.scorer_version,
          JSON.stringify(snap),
          snap.fetchedAt,
          now(),
        )
        .run();
      await movePop(db, null, cols.t1);
      return (await byId(db, snap.userId))!;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
      skip.add(`${s.x},${s.y}`);
    }
  }
  throw new Error('no slot after retries');
}

async function movePop(db: D1Database, from: TypeId | null, to: TypeId) {
  const stmts = [
    db
      .prepare(
        'INSERT INTO biome_pop (t1, n) VALUES (?, 1) ON CONFLICT(t1) DO UPDATE SET n = n + 1',
      )
      .bind(to),
  ];
  if (from)
    stmts.push(db.prepare('UPDATE biome_pop SET n = MAX(0, n - 1) WHERE t1 = ?').bind(from));
  await db.batch(stmts);
}

export async function worldCount(db: D1Database): Promise<number> {
  const r = await db
    .prepare('SELECT COALESCE(SUM(n), 0) AS n FROM biome_pop')
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export function toMap(r: Row): MapGitemon {
  return {
    id: r.id,
    login: r.login,
    x: r.x,
    y: r.y,
    t1: r.t1,
    t2: r.t2,
    sh: r.shape,
    f: r.form,
    s: r.shiny ? 1 : 0,
    lv: r.level,
    st: r.status === 'claimed' ? 'c' : 'w',
    a: r.aura_until && r.aura_until > now() ? 1 : 0,
  };
}

export const MAP_COLS = 'id, login, x, y, t1, t2, shape, form, shiny, level, status, aura_until';

export function isStale(r: Row): boolean {
  const age = Date.now() - Date.parse(r.fetched_at);
  return age > (r.status === 'claimed' ? 24 : 24 * 7) * 3600_000;
}
