import type { Snapshot } from '@gitemon/shared';

/**
 * Fetches public GitHub data for one developer. Works with any token: a no-scope token, or a
 * player's own `read:user` token. It never asks for, and never reads, private repositories.
 */

const GQL = 'https://api.github.com/graphql';
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const BOT_RE = /^[A-Za-z0-9-]{1,39}\[bot\]$/;

export function isValidLogin(login: string): boolean {
  return LOGIN_RE.test(login) || BOT_RE.test(login);
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

export type NotFound = { notFound: true };

const USER_QUERY = `query($login:String!){
  rateLimit{remaining resetAt}
  user(login:$login){
    databaseId login name createdAt
    followers{totalCount}
    repositories(first:100, ownerAffiliations:OWNER, privacy:PUBLIC, orderBy:{field:STARGAZERS,direction:DESC}){
      nodes{ name stargazerCount isFork primaryLanguage{name} }
    }
    contributionsCollection{
      totalCommitContributions totalPullRequestContributions
      totalPullRequestReviewContributions totalIssueContributions
      restrictedContributionsCount
      contributionCalendar{ weeks{ contributionDays{ contributionCount } } }
    }
  }
}`;

const MERGED_QUERY = `query($q:String!){
  search(query:$q, type:ISSUE, first:100){
    issueCount
    nodes{ ... on PullRequest { repository{ primaryLanguage{name} owner{login} } } }
  }
}`;

interface Fetcher {
  (input: string, init?: RequestInit): Promise<Response>;
}

async function gql<T>(token: string, query: string, variables: object, f: Fetcher): Promise<T> {
  const res = await f(GQL, {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'gitemon.fun',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new GitHubError('bad token', 401);
  if (res.status === 403 || res.status === 429)
    throw new GitHubError('rate limited', res.status, true);
  if (!res.ok) throw new GitHubError(`github ${res.status}`, res.status);
  const body = (await res.json()) as { data?: T; errors?: { type?: string; message: string }[] };
  const errs = (body.errors ?? []).filter((e) => e.type !== 'NOT_FOUND');
  if (errs.some((e) => e.type === 'RATE_LIMITED')) throw new GitHubError('rate limited', 403, true);
  if (errs.length && !body.data) throw new GitHubError(errs.map((e) => e.message).join('; '), 502);
  return body.data as T;
}

interface UserData {
  user: null | {
    databaseId: number;
    login: string;
    name: string | null;
    createdAt: string;
    followers: { totalCount: number };
    repositories: {
      nodes: {
        name: string;
        stargazerCount: number;
        isFork: boolean;
        primaryLanguage: { name: string } | null;
      }[];
    };
    contributionsCollection: {
      totalCommitContributions: number;
      totalPullRequestContributions: number;
      totalPullRequestReviewContributions: number;
      totalIssueContributions: number;
      restrictedContributionsCount: number;
      contributionCalendar: { weeks: { contributionDays: { contributionCount: number }[] }[] };
    };
  };
}

interface MergedData {
  search: {
    issueCount: number;
    nodes: ({
      repository?: { primaryLanguage: { name: string } | null; owner: { login: string } };
    } | null)[];
  };
}

/** Bot accounts are not `User` in GraphQL; REST tells us their id. */
async function fetchBot(login: string, token: string, f: Fetcher): Promise<Snapshot | NotFound> {
  const res = await f(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: {
      authorization: `bearer ${token}`,
      'user-agent': 'gitemon.fun',
      accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return { notFound: true };
  if (res.status === 403 || res.status === 429)
    throw new GitHubError('rate limited', res.status, true);
  if (!res.ok) throw new GitHubError(`github ${res.status}`, res.status);
  const u = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    type: string;
    created_at: string;
    followers: number;
  };
  if (u.type !== 'Bot') return { notFound: true };
  return {
    v: 1,
    userId: u.id,
    login: u.login,
    name: u.name,
    createdAt: u.created_at,
    isBot: true,
    followers: u.followers ?? 0,
    repos: [],
    contrib: { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, activeWeeks: 0 },
    mergedToOthers: { count: 0, langs: {}, owners: [] },
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchSnapshot(
  login: string,
  token: string,
  f: Fetcher = fetch,
): Promise<Snapshot | NotFound> {
  if (!isValidLogin(login)) return { notFound: true };
  if (BOT_RE.test(login)) return fetchBot(login, token, f);
  const d = await gql<UserData>(token, USER_QUERY, { login }, f);
  const u = d.user;
  if (!u) return fetchBot(login, token, f);

  const q = `is:pr is:merged author:${u.login} -user:${u.login}`;
  const m = await gql<MergedData>(token, MERGED_QUERY, { q }, f);
  const langs: Record<string, number> = {};
  const owners = new Set<string>();
  for (const n of m.search.nodes) {
    const r = n?.repository;
    if (!r) continue;
    owners.add(r.owner.login.toLowerCase());
    const l = r.primaryLanguage?.name;
    if (l) langs[l] = (langs[l] ?? 0) + 1;
  }

  const cc = u.contributionsCollection;
  const weeks = cc.contributionCalendar.weeks.slice(-52);
  const activeWeeks = weeks.filter((w) =>
    w.contributionDays.some((d) => d.contributionCount > 0),
  ).length;

  return {
    v: 1,
    userId: u.databaseId,
    login: u.login,
    name: u.name,
    createdAt: u.createdAt,
    isBot: false,
    followers: u.followers.totalCount,
    repos: u.repositories.nodes.map((r) => ({
      name: r.name,
      stars: r.stargazerCount,
      lang: r.primaryLanguage?.name ?? null,
      fork: r.isFork,
    })),
    contrib: {
      commits: cc.totalCommitContributions,
      prs: cc.totalPullRequestContributions,
      reviews: cc.totalPullRequestReviewContributions,
      issues: cc.totalIssueContributions,
      restricted: cc.restrictedContributionsCount,
      activeWeeks,
    },
    mergedToOthers: { count: m.search.issueCount, langs, owners: [...owners].slice(0, 100) },
    fetchedAt: new Date().toISOString(),
  };
}

/** Has `author` had a PR merged into a repo owned by `owner`? Used for bonded catches. */
export async function hasMergedInto(
  author: string,
  owner: string,
  token: string,
  f: Fetcher = fetch,
) {
  if (!isValidLogin(author) || !isValidLogin(owner)) return false;
  const d = await gql<{ search: { issueCount: number } }>(
    token,
    `query($q:String!){ search(query:$q, type:ISSUE, first:1){ issueCount } }`,
    { q: `is:pr is:merged author:${author} user:${owner}` },
    f,
  );
  return d.search.issueCount > 0;
}
