import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { fetchSnapshot } from '@gitemon/ingest';
import type { AppEnv, Env, Player } from './env.js';
import { limits } from './env.js';
import { decrypt, encrypt, randomId, sign, verify } from './crypto.js';
import { byId, ingest, now } from './world.js';
import { claim, isReal } from './game.js';
import { messagePage } from './pages.js';

/**
 * Sign-in: WorkOS User Management with GitHub as the only provider (binding: WorkOS, never
 * roll-your-own). We go straight to GitHub's consent screen (provider=GitHubOAuth) and ask
 * WorkOS to hand back the GitHub token, so we know which GitHub account signed in.
 * Scope stays at GitHub's basic profile. We never ask for `repo` (DECISIONS D9).
 */

const SESSION = 'gm_session';
const STATE = 'gm_state';
const SESSION_DAYS = 30;

const redirectUri = (env: Env) => `${env.PUBLIC_ORIGIN}/auth/callback`;

export async function loginRedirect(c: Context<AppEnv>) {
  const state = randomId();
  const next = safeNext(c.req.query('next'));
  setCookie(c, STATE, await sign(`${state}|${next}`, c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/auth',
    maxAge: 600,
  });
  const u = new URL('https://api.workos.com/user_management/authorize');
  u.searchParams.set('client_id', c.env.WORKOS_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri(c.env));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('provider', 'GitHubOAuth');
  u.searchParams.set('state', state);
  // Until sign-in is fully configured in WorkOS, show our own page instead of WorkOS's error page.
  const probe = await fetch(u.toString(), { redirect: 'manual' });
  const to = probe.headers.get('location') ?? '';
  if (probe.status >= 400 || to.startsWith('https://error.workos.com'))
    return c.html(
      messagePage(
        503,
        'Sign-in opens soon',
        'Signing in with GitHub is being switched on right now. Catching, claiming and towns open the moment it is. The map and every profile already work.',
      ),
      503,
    );
  return c.redirect(u.toString(), 302);
}

function safeNext(n: string | undefined): string {
  return n && /^\/[A-Za-z0-9/_?=&.-]*$/.test(n) && !n.startsWith('//') ? n : '/';
}

export class AuthError extends Error {}

interface WorkosAuth {
  user: { id: string; email: string | null };
  oauth_tokens?: { access_token: string; scopes?: string[] };
}

export async function callback(c: Context<AppEnv>): Promise<string> {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const saved = await verify(getCookie(c, STATE), c.env.SESSION_SECRET);
  deleteCookie(c, STATE, { path: '/auth' });
  if (!code || !state || !saved) throw new AuthError('The sign-in link expired. Please try again.');
  const [savedState, next] = saved.split('|');
  if (savedState !== state) throw new AuthError('The sign-in link expired. Please try again.');

  const res = await fetch('https://api.workos.com/user_management/authenticate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.WORKOS_CLIENT_ID,
      client_secret: c.env.WORKOS_API_KEY,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!res.ok) throw new AuthError('GitHub sign-in did not complete. Please try again.');
  const auth = (await res.json()) as WorkosAuth;
  const token = auth.oauth_tokens?.access_token;
  if (!token)
    throw new AuthError(
      'Sign-in is not fully set up yet (no GitHub token returned). Please try later.',
    );
  if (auth.oauth_tokens?.scopes?.some((s) => s === 'repo' || s.startsWith('repo:')))
    throw new AuthError('Refusing a token with private-repo access.');

  const gh = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `bearer ${token}`,
      'user-agent': 'gitemon.fun',
      accept: 'application/vnd.github+json',
    },
  });
  if (!gh.ok) throw new AuthError('Could not read your GitHub profile.');
  const ghUser = (await gh.json()) as { id: number; login: string };

  const snap = await fetchSnapshot(ghUser.login, token);
  if ('notFound' in snap) throw new AuthError('Could not read your GitHub profile.');
  const row = await ingest(c.env.DB, snap);
  const lim = limits(c.env);
  const real = isReal(snap, lim.realMinAgeDays);
  const admins = new Set(
    (c.env.ADMIN_EMAILS ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const adminLogins = new Set(
    (c.env.ADMIN_LOGINS ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const isAdmin =
    (auth.user.email && admins.has(auth.user.email.toLowerCase())) ||
    adminLogins.has(ghUser.login.toLowerCase())
      ? 1
      : 0;
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO players (id, workos_id, email, token_enc, is_admin, real, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET workos_id=excluded.workos_id, email=excluded.email, token_enc=excluded.token_enc,
       is_admin=excluded.is_admin, real=MAX(players.real, excluded.real), last_seen=excluded.last_seen`,
  )
    .bind(
      ghUser.id,
      auth.user.id,
      auth.user.email,
      await encrypt(token, c.env.TOKEN_KEY),
      isAdmin,
      real ? 1 : 0,
      t,
      t,
    )
    .run();
  await claim(c.env.DB, row, real);

  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  setCookie(c, SESSION, await sign(`${ghUser.id}|${exp}`, c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  return safeNext(next);
}

export function logout(c: Context<AppEnv>) {
  deleteCookie(c, SESSION, { path: '/' });
}

export async function currentPlayer(c: Context<AppEnv>): Promise<Player | null> {
  const v = await verify(getCookie(c, SESSION), c.env.SESSION_SECRET);
  if (!v) return null;
  const [id, exp] = v.split('|').map(Number);
  if (!id || !exp || exp < Date.now()) return null;
  const p = await c.env.DB.prepare(
    'SELECT p.id, g.login, p.is_admin, p.real FROM players p JOIN gitemon g ON g.id = p.id WHERE p.id = ?',
  )
    .bind(id)
    .first<Player>();
  return p ?? null;
}

export async function playerToken(env: Env, id: number): Promise<string | null> {
  const r = await env.DB.prepare('SELECT token_enc FROM players WHERE id = ?')
    .bind(id)
    .first<{ token_enc: string | null }>();
  return decrypt(r?.token_enc ?? null, env.TOKEN_KEY);
}

export { byId };
