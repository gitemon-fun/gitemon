import type { MapGitemon, Stats } from '@gitemon/shared';

export interface Me extends MapGitemon {
  hidden: number;
  legend: { key: string; rank: number; tier: string; title: string | null; woken: boolean } | null;
  walk: {
    budget: number;
    walked: number;
    streak: number;
    seen: string[];
    tally: Record<string, number>;
  };
  admin: boolean;
  bonus: number;
  town: { id: number; name: string } | null;
  catchesLeft: number;
}
export interface Detail {
  g: MapGitemon;
  name: string | null;
  stats: Stats;
  caughtCount: number;
  bonus: number;
  machine: boolean;
  town: { id: number; name: string } | null;
  caughtByMe: { bonded: boolean } | null;
}
export interface Town {
  id: number;
  name: string;
  biome: MapGitemon['t1'];
  plot: number;
  kind: 'clan' | 'official';
  owner_login?: string | null;
  members: number;
}

async function get<T>(url: string): Promise<{ status: number; data: T }> {
  const r = await fetch(url, { credentials: 'same-origin' });
  return { status: r.status, data: (await r.json()) as T };
}
async function post<T>(url: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, data: (await r.json()) as T };
}

export const api = {
  me: () => get<{ player: Me | null }>('/api/me'),
  notable: () =>
    get<{ g: MapGitemon[]; towns: Town[]; total: number; pops: Record<string, number> }>(
      '/api/notable',
    ),
  chunk: (cx: number, cy: number) => get<{ g: MapGitemon[] }>(`/api/chunk/${cx}/${cy}`),
  biome: (t: string) => get<{ d: [number, number, number, number][] }>(`/api/biome/${t}`),
  find: (login: string) =>
    get<{ g?: MapGitemon; pending?: boolean; error?: string }>(
      `/api/find?login=${encodeURIComponent(login)}`,
    ),
  detail: (id: number) => get<Detail>(`/api/gitemon/${id}`),
  sight: (key: string, x: number, z: number, walked: number) =>
    post<{ ok?: boolean; new?: boolean; seen?: number; streak?: number; error?: string }>(
      '/api/walk/sight',
      { key, x, z, walked },
    ),
  bless: (key: string, x: number, z: number, walked: number) =>
    post<{ ok?: boolean; until?: string; streak?: number; error?: string }>('/api/walk/bless', {
      key,
      x,
      z,
      walked,
    }),
  wake: () => post<{ ok: boolean; woken: boolean }>('/api/legend/wake', {}),
  removeLegend: () => post<{ ok: boolean }>('/api/legend/remove', {}),
  dex: () => get<{ dex: (MapGitemon & { bonded: boolean; caughtAt: string })[] }>('/api/dex'),
  towns: () => get<{ towns: Town[] }>('/api/towns'),
  catch: (id: number) =>
    post<{ ok?: boolean; n?: number; left?: number; error?: string }>(`/api/catch/${id}`),
  release: (hidden: boolean) => post<{ ok: boolean }>('/api/release', { hidden }),
  found: (name: string) =>
    post<{ ok?: boolean; id?: number; error?: string }>('/api/towns', { name }),
  join: (id: number) => post<{ ok?: boolean; error?: string }>(`/api/towns/${id}/join`),
  leave: () => post<{ ok: boolean }>('/api/towns/leave'),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
};

export const ERRORS: Record<string, string> = {
  signin: 'Sign in with GitHub first.',
  self: 'That one is you.',
  already: 'Already in your Dex.',
  limit: 'No catches left today. Come back tomorrow.',
  hidden: 'This Gitemon was released.',
  'not-found': 'Not found.',
  'bad-name': 'Town names are 3–24 letters, numbers, spaces or dashes.',
  taken: 'That town name is taken.',
  'biome-full': 'This biome has no free town plots.',
  full: 'This town is full.',
  'not-eligible': 'Official towns are for people with a merged pull request in that project.',
  server: 'Something broke. Please try again.',
};
