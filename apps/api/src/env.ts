export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  STATIC: Fetcher;

  PUBLIC_ORIGIN: string;
  WORKOS_CLIENT_ID: string;
  /** Anti-abuse numbers live here (env config), not in the public code. Defaults in limits.ts. */
  DAILY_CATCH_LIMIT?: string;
  REAL_MIN_AGE_DAYS?: string;
  ADMIN_EMAILS?: string;
  ADMIN_LOGINS?: string;

  // secrets
  WORKOS_API_KEY: string;
  SESSION_SECRET: string;
  TOKEN_KEY: string;
  INTERNAL_KEY: string;
  /** Optional no-scope token for fetching public profiles of visitors who are not signed in. */
  GITHUB_TOKEN?: string;
}

export type Vars = { player: Player | null };
export type AppEnv = { Bindings: Env; Variables: Vars };

export interface Player {
  id: number;
  login: string;
  is_admin: number;
  real: number;
}

export function limits(env: Env) {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? +v : d);
  return {
    dailyCatches: n(env.DAILY_CATCH_LIMIT, 10),
    realMinAgeDays: n(env.REAL_MIN_AGE_DAYS, 90),
  };
}
