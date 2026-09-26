import { Hono, type Context } from 'hono';
import { fetchSnapshot, isValidLogin } from '@gitemon/ingest';
import { SCORER_VERSION } from '@gitemon/scorer';
import {
  BIOME_ORDER,
  CHUNK,
  TYPES,
  WORLD_H,
  WORLD_W,
  type Snapshot,
  type TypeId,
} from '@gitemon/shared';
import type { AppEnv } from './env.js';
import { limits } from './env.js';
import { AuthError, callback, currentPlayer, loginRedirect, logout, playerToken } from './auth.js';
import { safeEqual } from './crypto.js';
import { bonusLevels, checkBonded, doCatch, foundTown, joinTown, leaveTown } from './game.js';
import { ogPng, spritePng } from './og.js';
import { homePage, messagePage, privacyPage, profilePage, termsPage } from './pages.js';
import {
  byId,
  byLogin,
  ingest,
  isStale,
  MAP_COLS,
  now,
  toMap,
  worldCount,
  type Row,
} from './world.js';

const VERSION = '1.0.0';
const app = new Hono<AppEnv>();

// ---- helpers ------------------------------------------------------------------------------------

const html = (c: Context<AppEnv>, body: string, status = 200, maxAge = 60) =>
  c.body(body, status as 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': `public, max-age=${maxAge}`,
  });

async function edgeCached(
  c: Context<AppEnv>,
  ttl: number,
  make: () => Promise<Response>,
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) {
    const copy = new Response(res.body, res);
    copy.headers.set('cache-control', `public, max-age=${ttl}`);
    c.executionCtx.waitUntil(cache.put(key, copy.clone()));
    return copy;
  }
  return res;
}

/** A token that may read public GitHub data for this request: the server's, else the player's own. */
async function tokenFor(c: Context<AppEnv>): Promise<string | null> {
  if (c.env.GITHUB_TOKEN) return c.env.GITHUB_TOKEN;
  const p = c.get('player');
  return p ? playerToken(c.env, p.id) : null;
}

function refreshLater(c: Context<AppEnv>, r: Row) {
  if (!isStale(r)) return;
  c.executionCtx.waitUntil(
    (async () => {
      const token = await tokenFor(c);
      if (!token) return;
      const snap = await fetchSnapshot(r.login, token);
      if (!('notFound' in snap)) await ingest(c.env.DB, snap);
    })().catch(() => undefined),
  );
}

const spriteParams = (r: Row) =>
  ({ id: r.id, t1: r.t1, t2: r.t2, sh: r.shape, f: r.form, s: r.shiny ? 1 : 0 }) as const;

// ---- middleware ---------------------------------------------------------------------------------

app.use('*', async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (host === 'www.gitemon.fun') return c.redirect(c.req.url.replace('://www.', '://'), 301);
  c.set('player', null);
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/'))
    c.set('player', await currentPlayer(c));
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('x-frame-options', 'DENY');
});

// Same-origin check for every state-changing API call (the session cookie is SameSite=Lax too).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    if (origin && origin !== c.env.PUBLIC_ORIGIN) return c.json({ error: 'bad-origin' }, 403);
  }
  await next();
});

// ---- health + meta ------------------------------------------------------------------------------

app.get('/health', async (c) => {
  const p = await c.env.DB.prepare(
    'SELECT MIN(requested_at) AS t, COUNT(*) AS n FROM pending',
  ).first<{
    t: string | null;
    n: number;
  }>();
  const pendingOldestMin = p?.t ? Math.floor((Date.now() - Date.parse(p.t)) / 60_000) : 0;
  return c.json({
    ok: true,
    version: VERSION,
    scorerVersion: SCORER_VERSION,
    pending: p?.n ?? 0,
    pendingOldestMin,
  });
});

app.get('/robots.txt', (c) =>
  c.text(
    'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nSitemap: https://gitemon.fun/sitemap.xml\n',
  ),
);

app.get('/sitemap.xml', (c) =>
  edgeCached(c, 3600, async () => {
    const rows = await c.env.DB.prepare(
      'SELECT login FROM gitemon WHERE hidden = 0 AND machine = 0 ORDER BY notable DESC LIMIT 20000',
    ).all<{ login: string }>();
    const urls = [
      '/',
      '/map',
      '/privacy',
      '/terms',
      ...rows.results.map((r) => `/${encodeURIComponent(r.login)}`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
      .map((u) => `<url><loc>https://gitemon.fun${u}</loc></url>`)
      .join('')}</urlset>`;
    return new Response(xml, { headers: { 'content-type': 'application/xml' } });
  }),
);

// ---- auth -----------------------------------------------------------------------------------------

app.get('/auth/login', (c) => loginRedirect(c));
app.get('/auth/callback', async (c) => {
  try {
    return c.redirect(await callback(c), 302);
  } catch (e) {
    if (e instanceof AuthError)
      return html(c, messagePage(400, 'Sign-in did not work', e.message), 400, 0);
    throw e;
  }
});
app.post('/auth/logout', (c) => {
  logout(c);
  return c.json({ ok: true });
});

// ---- read API -------------------------------------------------------------------------------------

app.get('/api/me', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ player: null });
  const r = await byId(c.env.DB, p.id);
  if (!r) return c.json({ player: null });
  const town = r.town_id
    ? await c.env.DB.prepare('SELECT id, name FROM towns WHERE id = ?').bind(r.town_id).first()
    : null;
  const since = new Date(new Date().toISOString().slice(0, 10)).toISOString();
  const used = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM catches WHERE catcher_id = ? AND created_at >= ?',
  )
    .bind(p.id, since)
    .first<{ n: number }>();
  const legend = await c.env.DB.prepare(
    'SELECT key, rank, tier, title, woken_at FROM legend WHERE id = ?',
  )
    .bind(p.id)
    .first<{
      key: string;
      rank: number;
      tier: string;
      title: string | null;
      woken_at: string | null;
    }>();
  return c.json({
    player: {
      ...toMap(r),
      hidden: r.hidden,
      // only ever sent to the developer themselves (V5-D4)
      legend: legend
        ? {
            key: legend.key,
            rank: legend.rank,
            tier: legend.tier,
            title: legend.title,
            woken: !!legend.woken_at,
          }
        : null,
      admin: !!p.is_admin,
      bonus: await bonusLevels(c.env.DB, p.id),
      town,
      catchesLeft: Math.max(0, limits(c.env).dailyCatches - (used?.n ?? 0)),
    },
  });
});

app.get('/api/chunk/:cx/:cy', async (c) => {
  const cx = Number(c.req.param('cx'));
  const cy = Number(c.req.param('cy'));
  if (
    !Number.isInteger(cx) ||
    !Number.isInteger(cy) ||
    cx < 0 ||
    cy < 0 ||
    cx >= WORLD_W / CHUNK ||
    cy >= WORLD_H / CHUNK
  )
    return c.json({ error: 'bad-chunk' }, 400);
  return edgeCached(c, 20, async () => {
    const rows = await c.env.DB.prepare(
      `SELECT ${MAP_COLS} FROM gitemon WHERE chunk = ? AND hidden = 0`,
    )
      .bind(cy * (WORLD_W / CHUNK) + cx)
      .all<Row>();
    return c.json({ g: rows.results.map(toMap) });
  });
});

/** Everything in one biome as dots: [x, y, notable, id]. For the middle zoom. */
app.get('/api/biome/:t', async (c) => {
  const t = c.req.param('t') as TypeId;
  if (!TYPES.includes(t)) return c.json({ error: 'bad-biome' }, 400);
  return edgeCached(c, 120, async () => {
    const rows = await c.env.DB.prepare(
      "SELECT x, y, notable, CASE status WHEN 'claimed' THEN 1 ELSE 0 END AS c FROM gitemon WHERE t1 = ? AND hidden = 0 AND town_id IS NULL LIMIT 70000",
    )
      .bind(t)
      .raw<[number, number, number, number]>();
    const towned = await c.env.DB.prepare(
      'SELECT g.x, g.y, g.notable, 1 FROM gitemon g JOIN towns t ON t.id = g.town_id WHERE t.biome = ? AND g.hidden = 0',
    )
      .bind(t)
      .raw<[number, number, number, number]>();
    return c.json({ d: [...rows, ...towned] });
  });
});

/** The Gitemon that stay visible from the far zoom, plus town labels. */
app.get('/api/notable', (c) =>
  edgeCached(c, 300, async () => {
    const perBiome = await Promise.all(
      BIOME_ORDER.filter((t) => t !== 'machine').map((t) =>
        c.env.DB.prepare(
          `SELECT ${MAP_COLS} FROM gitemon WHERE t1 = ? AND hidden = 0 ORDER BY notable DESC LIMIT 16`,
        )
          .bind(t)
          .all<Row>(),
      ),
    );
    const mostCaught = await c.env.DB.prepare(
      `SELECT ${MAP_COLS} FROM gitemon WHERE hidden = 0 AND caught_count > 0 ORDER BY caught_count DESC LIMIT 24`,
    ).all<Row>();
    const shiny = await c.env.DB.prepare(
      `SELECT ${MAP_COLS} FROM gitemon WHERE hidden = 0 AND shiny = 1 LIMIT 64`,
    ).all<Row>();
    const towns = await c.env.DB.prepare(
      "SELECT id, name, biome, plot, kind, members FROM towns WHERE members >= 3 OR kind = 'official'",
    ).all();
    const seen = new Set<number>();
    const g = [...perBiome.flatMap((r) => r.results), ...mostCaught.results, ...shiny.results]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map(toMap);
    const total = { n: await worldCount(c.env.DB) };
    const pops = await c.env.DB.prepare('SELECT t1, n FROM biome_pop').all<{
      t1: string;
      n: number;
    }>();
    return c.json({
      g,
      towns: towns.results,
      total: total?.n ?? 0,
      pops: Object.fromEntries(pops.results.map((r) => [r.t1, r.n])),
    });
  }),
);

/** Gitemon City: the world's most notable, for the central plaza. */
app.get('/api/top', (c) =>
  edgeCached(c, 300, async () => {
    const limit = Math.min(120, Math.max(1, Number(c.req.query('limit') ?? 48) | 0));
    const rows = await c.env.DB.prepare(
      `SELECT ${MAP_COLS} FROM gitemon WHERE hidden = 0 AND machine = 0 ORDER BY notable DESC, id LIMIT ?`,
    )
      .bind(limit)
      .all<Row>();
    return c.json({ g: rows.results.map(toMap) });
  }),
);

/** Gitemon City: a district's residents, most notable first. */
app.get('/api/district/:t', async (c) => {
  const t = c.req.param('t') as TypeId;
  if (!TYPES.includes(t)) return c.json({ error: 'bad-district' }, 400);
  return edgeCached(c, 300, async () => {
    const limit = Math.min(1500, Math.max(1, Number(c.req.query('limit') ?? 600) | 0));
    const rows = await c.env.DB.prepare(
      `SELECT ${MAP_COLS} FROM gitemon WHERE t1 = ? AND hidden = 0 ORDER BY notable DESC, id LIMIT ?`,
    )
      .bind(t, limit)
      .all<Row>();
    return c.json({ g: rows.results.map(toMap) });
  });
});

/**
 * Gitemon City: every resident, most notable first, as plain arrays (cheap to serialise under the
 * free plan's CPU limit): [id, login, t1, t2, shape, form, shiny, level, claimed, aura, claimedAt].
 */
app.get('/api/city', (c) =>
  edgeCached(c, 600, async () => {
    const rows = await c.env.DB.prepare(
      `SELECT id, login, t1, t2, shape, form, shiny, level, status = 'claimed', COALESCE(aura_until > ?, 0), claimed_at
       FROM gitemon WHERE hidden = 0 ORDER BY notable DESC, id LIMIT 40000`,
    )
      .bind(now())
      .raw();
    // the specials (V5-D4): [key, rank, tier, title, species, t1, t2, shape, form, shiny, id, login].
    // Sealed ones carry NO id and NO login — nothing links them to a person until they wake.
    const legends = await c.env.DB.prepare(
      `SELECT l.key, l.rank, l.tier, l.title, l.species, l.t1, l.t2, l.shape, l.form, l.shiny,
              CASE WHEN l.woken_at IS NOT NULL THEN g.id END,
              CASE WHEN l.woken_at IS NOT NULL THEN g.login END
       FROM legend l LEFT JOIN gitemon g ON g.id = l.id AND g.hidden = 0
       ORDER BY l.rank`,
    ).raw();
    return c.json({ g: rows, l: legends });
  }),
);

app.get('/api/find', async (c) => {
  const login = (c.req.query('login') ?? '').trim().replace(/^@/, '');
  if (!isValidLogin(login)) return c.json({ error: 'bad-login' }, 400);
  // v5 (V5-D2, V5-D9): searching never hatches anyone. Someone who has not joined — including the
  // developer behind a sealed legend — gets the same answer as a name that does not exist.
  const r = await byLogin(c.env.DB, login);
  if (!r || r.hidden) return c.json({ error: 'not-joined' }, 404);
  refreshLater(c, r);
  return c.json({ g: toMap(r) });
});

app.get('/api/gitemon/:id', async (c) => {
  const r = await byId(c.env.DB, Number(c.req.param('id')));
  if (!r || r.hidden) return c.json({ error: 'not-found' }, 404);
  const p = c.get('player');
  const caught = p
    ? await c.env.DB.prepare('SELECT bonded FROM catches WHERE catcher_id = ? AND target_id = ?')
        .bind(p.id, r.id)
        .first<{ bonded: number }>()
    : null;
  const town = r.town_id
    ? await c.env.DB.prepare('SELECT id, name FROM towns WHERE id = ?').bind(r.town_id).first()
    : null;
  return c.json({
    g: toMap(r),
    name: r.name,
    stats: JSON.parse(r.stats),
    caughtCount: r.caught_count,
    bonus: await bonusLevels(c.env.DB, r.id),
    machine: !!r.machine,
    town,
    caughtByMe: caught ? { bonded: !!caught.bonded } : null,
  });
});

app.get('/api/dex', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT ${MAP_COLS.split(', ')
      .map((k) => 'g.' + k)
      .join(', ')}, k.bonded, k.created_at AS caught_at
     FROM catches k JOIN gitemon g ON g.id = k.target_id WHERE k.catcher_id = ? AND g.hidden = 0 ORDER BY k.created_at DESC`,
  )
    .bind(p.id)
    .all<Row & { bonded: number; caught_at: string }>();
  return c.json({
    dex: rows.results.map((r) => ({ ...toMap(r), bonded: !!r.bonded, caughtAt: r.caught_at })),
  });
});

app.get('/api/towns', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, biome, plot, kind, owner_login, members FROM towns ORDER BY members DESC, id LIMIT 500',
  ).all();
  return c.json({ towns: rows.results });
});

// ---- write API (signed in) ---------------------------------------------------------------------------

app.post('/api/catch/:id', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const targetId = Number(c.req.param('id'));
  const res = await doCatch(c.env.DB, p, targetId, limits(c.env).dailyCatches);
  if (!res.ok) return c.json({ error: res.error }, res.error === 'limit' ? 429 : 400);
  c.executionCtx.waitUntil(
    (async () => {
      const token = await playerToken(c.env, p.id);
      const target = await byId(c.env.DB, targetId);
      if (token && target && !target.machine) await checkBonded(c.env.DB, p, target, token);
    })(),
  );
  return c.json(res);
});

/** A listed developer wakes their sealed legend: it shows with their name from now on (V5-D4). */
app.post('/api/legend/wake', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const r = await c.env.DB.prepare(
    'UPDATE legend SET woken_at = ? WHERE id = ? AND woken_at IS NULL',
  )
    .bind(now(), p.id)
    .run();
  return c.json({ ok: true, woken: r.meta.changes > 0 });
});

/** …or removes it for good: deleted, and never imported again (V5-D4, G3). */
app.post('/api/legend/remove', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM legend WHERE id = ?').bind(p.id),
    c.env.DB.prepare('INSERT OR IGNORE INTO legend_removed (id, removed_at) VALUES (?, ?)').bind(
      p.id,
      now(),
    ),
  ]);
  return c.json({ ok: true });
});

app.post('/api/release', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const { hidden } = await c.req.json<{ hidden: boolean }>();
  await c.env.DB.prepare('UPDATE gitemon SET hidden = ? WHERE id = ?')
    .bind(hidden ? 1 : 0, p.id)
    .run();
  return c.json({ ok: true, hidden: !!hidden });
});

app.post('/api/towns', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const { name } = await c.req.json<{ name: string }>();
  const me = await byId(c.env.DB, p.id);
  if (!me) return c.json({ error: 'not-found' }, 404);
  const r = await foundTown(c.env.DB, me, String(name ?? '').trim());
  return r.ok ? c.json(r) : c.json(r, 400);
});

app.post('/api/towns/:id/join', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const me = await byId(c.env.DB, p.id);
  if (!me) return c.json({ error: 'not-found' }, 404);
  const r = await joinTown(c.env.DB, me, Number(c.req.param('id')));
  return r.ok ? c.json(r) : c.json(r, 400);
});

app.post('/api/towns/leave', async (c) => {
  const p = c.get('player');
  if (!p) return c.json({ error: 'signin' }, 401);
  const me = await byId(c.env.DB, p.id);
  if (me) await leaveTown(c.env.DB, me);
  return c.json({ ok: true });
});

app.post('/api/admin/hide/:id', async (c) => {
  const p = c.get('player');
  if (!p?.is_admin) return c.json({ error: 'forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const { hidden, note } = await c.req.json<{ hidden: boolean; note?: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE gitemon SET hidden = ? WHERE id = ?').bind(hidden ? 1 : 0, id),
    c.env.DB.prepare(
      'INSERT INTO admin_log (admin_id, action, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(p.id, hidden ? 'hide' : 'unhide', id, note ?? null, now()),
  ]);
  return c.json({ ok: true });
});

app.post('/api/admin/town/:id/delete', async (c) => {
  const p = c.get('player');
  if (!p?.is_admin) return c.json({ error: 'forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const members = await c.env.DB.prepare('SELECT id, t1 FROM gitemon WHERE town_id = ?')
    .bind(id)
    .all<{ id: number; t1: TypeId }>();
  for (const m of members.results) {
    const me = await byId(c.env.DB, m.id);
    if (me) await leaveTown(c.env.DB, me);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM towns WHERE id = ?').bind(id),
    c.env.DB.prepare(
      "INSERT INTO admin_log (admin_id, action, target_id, created_at) VALUES (?, 'delete-town', ?, ?)",
    ).bind(p.id, id, now()),
  ]);
  return c.json({ ok: true });
});

app.get('/api/admin/log', async (c) => {
  const p = c.get('player');
  if (!p?.is_admin) return c.json({ error: 'forbidden' }, 403);
  const rows = await c.env.DB.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT 200').all();
  return c.json({ log: rows.results });
});

// ---- internal (trusted fetcher: seeding, pending drain, stale sweep) ----------------------------------

app.use('/internal/*', async (c, next) => {
  const key = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
  if (!c.env.INTERNAL_KEY || !safeEqual(key, c.env.INTERNAL_KEY))
    return c.json({ error: 'forbidden' }, 403);
  await next();
});

app.post('/internal/ingest', async (c) => {
  const { snapshots } = await c.req.json<{ snapshots: Snapshot[] }>();
  const done: string[] = [];
  // D1 allows 50 queries per request on the Workers free plan; one ingest uses ~6; CPU limit is 10 ms.
  for (const s of snapshots.slice(0, 3)) {
    if (s?.v !== 1 || !Number.isInteger(s.userId) || !isValidLogin(s.login)) continue;
    await ingest(c.env.DB, s);
    await c.env.DB.prepare('DELETE FROM pending WHERE login = ?').bind(s.login).run();
    done.push(s.login);
  }
  return c.json({ ok: true, done });
});

/**
 * The Legends list (V5-D3): the private import script posts ranked, already-scored specials. Keys
 * survive re-imports; anyone in `legend_removed` is skipped; ranks not in this batch are left alone
 * (a full import sends `final: true` to drop legends that fell off the list and were never woken).
 */
app.post('/internal/legends', async (c) => {
  type L = {
    id: number;
    login: string;
    rank: number;
    tier: string;
    title: string | null;
    species: string | null;
    t1: TypeId;
    t2: TypeId | null;
    shape: string;
    form: number;
    shiny: number;
  };
  const { legends, final, keep } = await c.req.json<{
    legends: L[];
    final?: boolean;
    keep?: number[];
  }>();
  const db = c.env.DB;
  const removed = new Set(
    (await db.prepare('SELECT id FROM legend_removed').all<{ id: number }>()).results.map(
      (r) => r.id,
    ),
  );
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  for (const l of (legends ?? []).slice(0, 40)) {
    if (!Number.isInteger(l.id) || removed.has(l.id) || !TYPES.includes(l.t1)) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO legend (id, key, login, rank, tier, title, species, t1, t2, shape, form, shiny, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET login=excluded.login, rank=excluded.rank, tier=excluded.tier,
             title=excluded.title, species=excluded.species, t1=excluded.t1, t2=excluded.t2,
             shape=excluded.shape, form=excluded.form, shiny=excluded.shiny, imported_at=excluded.imported_at`,
        )
        .bind(
          l.id,
          crypto.randomUUID().replace(/-/g, '').slice(0, 16),
          l.login,
          l.rank,
          l.tier,
          l.title,
          l.species,
          l.t1,
          l.t2,
          l.shape,
          l.form,
          l.shiny,
          t,
        ),
    );
  }
  if (stmts.length) await db.batch(stmts);
  if (final && Array.isArray(keep)) {
    const ids = keep.filter(Number.isInteger);
    await db
      .prepare(
        `DELETE FROM legend WHERE woken_at IS NULL AND id NOT IN (${ids.map(() => '?').join(',') || 'NULL'})`,
      )
      .bind(...ids)
      .run();
  }
  return c.json({ ok: true, upserted: stmts.length });
});

/** Re-score from stored snapshots after a scorer change (no GitHub calls). */
app.post('/internal/rescore', async (c) => {
  const after = Number(c.req.query('after') ?? 0);
  const rows = await c.env.DB.prepare(
    'SELECT snapshot FROM gitemon WHERE id > ? AND scorer_version < ? ORDER BY id LIMIT 4',
  )
    .bind(after, SCORER_VERSION)
    .all<{ snapshot: string }>();
  let last = after;
  for (const r of rows.results) {
    const snap = JSON.parse(r.snapshot) as Snapshot;
    await ingest(c.env.DB, snap);
    last = snap.userId;
  }
  return c.json({ done: rows.results.length, last });
});

app.post('/internal/missing', async (c) => {
  const { logins } = await c.req.json<{ logins: string[] }>();
  for (const l of logins.slice(0, 100))
    await c.env.DB.prepare('DELETE FROM pending WHERE login = ?').bind(l).run();
  return c.json({ ok: true });
});

app.get('/internal/pending', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT login FROM pending ORDER BY requested_at LIMIT 50',
  ).all<{ login: string }>();
  return c.json({ logins: rows.results.map((r) => r.login) });
});

app.get('/internal/stale', async (c) => {
  const limit = Math.min(200, Number(c.req.query('limit') ?? 50));
  const claimedCut = new Date(Date.now() - 86_400_000).toISOString();
  // v5: only signed-in players are refreshed; nobody else's profile is fetched (V5-D2)
  const rows = await c.env.DB.prepare(
    `SELECT login FROM gitemon WHERE hidden = 0 AND status = 'claimed' AND fetched_at < ?
     ORDER BY fetched_at LIMIT ?`,
  )
    .bind(claimedCut, limit)
    .all<{ login: string }>();
  return c.json({ logins: rows.results.map((r) => r.login) });
});

app.post('/internal/official-town', async (c) => {
  const { name, owner, biome } = await c.req.json<{ name: string; owner: string; biome: TypeId }>();
  if (!TYPES.includes(biome) || !isValidLogin(owner)) return c.json({ error: 'bad-input' }, 400);
  const used = await c.env.DB.prepare('SELECT plot FROM towns WHERE biome = ?')
    .bind(biome)
    .all<{ plot: number }>();
  const taken = new Set(used.results.map((r) => r.plot));
  const { PLOTS } = await import('@gitemon/shared');
  const plot = PLOTS.findIndex((_, i) => !taken.has(i));
  if (plot < 0) return c.json({ error: 'biome-full' }, 400);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO towns (name, biome, plot, kind, owner_login, members, created_at) VALUES (?, ?, ?, 'official', ?, 0, ?)",
  )
    .bind(name, biome, plot, owner.toLowerCase(), now())
    .run();
  return c.json({ ok: true });
});

// ---- images -------------------------------------------------------------------------------------------

app.get('/sprite/:file', async (c) => {
  const m = /^(\d+)\.png$/.exec(c.req.param('file'));
  if (!m) return c.notFound();
  const scale = Math.max(1, Math.min(12, Number(c.req.query('s') ?? 4) | 0));
  return edgeCached(c, 86400, async () => {
    const r = await byId(c.env.DB, Number(m[1]));
    if (!r || r.hidden) return new Response('not found', { status: 404 });
    return new Response(spritePng(spriteParams(r), scale), {
      headers: { 'content-type': 'image/png' },
    });
  });
});

app.get('/og/:file', async (c) => {
  const m = /^(\d+)\.png$/.exec(c.req.param('file'));
  if (!m) return c.notFound();
  return edgeCached(c, 86400, async () => {
    const r = await byId(c.env.DB, Number(m[1]));
    if (!r || r.hidden) return new Response('not found', { status: 404 });
    const key = `og/${SCORER_VERSION}/${r.id}-${r.level}-${r.form}-${r.t1}-${r.t2 ?? ''}.png`;
    const stored = await c.env.BUCKET.get(key);
    if (stored) return new Response(stored.body, { headers: { 'content-type': 'image/png' } });
    const png = ogPng({ ...spriteParams(r), login: r.login, level: r.level });
    c.executionCtx.waitUntil(
      c.env.BUCKET.put(key, png, { httpMetadata: { contentType: 'image/png' } }),
    );
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
});

// ---- pages ----------------------------------------------------------------------------------------------

const SPA = new Set(['/map', '/dex', '/towns', '/me']);
const CITY = new Set(['/city']);

async function spa(c: Context<AppEnv>) {
  const res = await c.env.STATIC.fetch(new Request(new URL('/app.html', c.req.url)));
  return new Response(res.body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

app.get('/', async (c) =>
  edgeCached(c, 300, async () => {
    return new Response(homePage(await worldCount(c.env.DB)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }),
);
app.get('/privacy', (c) => html(c, privacyPage(), 200, 3600));
app.get('/terms', (c) => html(c, termsPage(), 200, 3600));

app.get('*', async (c) => {
  const path = c.req.path;
  if (SPA.has(path)) return spa(c);
  // the v2 preview address: the city is the map now
  if (CITY.has(path)) return c.redirect('/map', 301);
  if (path.includes('.') || path.startsWith('/assets/')) {
    const res = await c.env.STATIC.fetch(c.req.raw);
    if (res.status !== 404) return res;
    return html(c, messagePage(404, 'Not found', 'There is nothing at this address.'), 404, 60);
  }
  const seg = decodeURIComponent(path.slice(1).replace(/\/$/, ''));
  if (!seg.includes('/') && isValidLogin(seg)) {
    c.set('player', await currentPlayer(c));
    // v5: a profile address never hatches anyone; not joined = not here (V5-D2, V5-D9)
    const r = await byLogin(c.env.DB, seg);
    if (!r || r.hidden)
      return html(
        c,
        messagePage(
          404,
          'Not on the island yet',
          'This developer has no Gitemon on the island. Every Gitemon hatches when its own developer signs in with GitHub.',
        ),
        404,
      );
    refreshLater(c, r);
    const town = r.town_id
      ? ((
          await c.env.DB.prepare('SELECT name FROM towns WHERE id = ?')
            .bind(r.town_id)
            .first<{ name: string }>()
        )?.name ?? null)
      : null;
    return html(
      c,
      profilePage(r, await bonusLevels(c.env.DB, r.id), town, r.caught_count),
      200,
      60,
    );
  }
  return html(c, messagePage(404, 'Not found', 'There is nothing at this address.'), 404, 60);
});

app.onError((err, c) => {
  console.error(err);
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/internal/'))
    return c.json({ error: 'server' }, 500);
  return html(
    c,
    messagePage(500, 'Something broke', 'This page failed to load. Please try again in a minute.'),
    500,
    0,
  );
});

export default app;
