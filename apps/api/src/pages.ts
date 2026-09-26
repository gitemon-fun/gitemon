import { SHAPE_NAME, STAT_MEANING, TYPE_INFO, type Stats } from '@gitemon/shared';
import type { Row } from './world.js';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export const CSS = `
:root{--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--dim:#6e6e73;--line:#d2d2d7;--tint:#0a66d8;--tint-text:#fff;--good:#1e8e3e;--fill:#f2f2f5;
font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--dim:#98989d;--line:#38383a;--tint:#3d8bff;--good:#30d158;--fill:#2c2c2e;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:17px;line-height:1.47}
a{color:var(--tint);text-decoration:none}a:hover{text-decoration:underline}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;max-width:760px;margin:0 auto}
.brand{font-weight:700;font-size:20px;color:var(--text);letter-spacing:-.02em}
main{max-width:760px;margin:0 auto;padding:8px 20px 48px}
.card{background:var(--card);border-radius:18px;padding:24px;margin-bottom:16px}
.hero{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.hero img{width:192px;height:192px;image-rendering:pixelated;border-radius:14px}
.hero .who{flex:1;min-width:220px}
h1{font-size:34px;line-height:1.1;margin:0 0 4px;letter-spacing:-.02em;word-break:break-word}
h2{font-size:22px;margin:0 0 12px}
.sub{color:var(--dim);margin:0 0 12px}
.lv{font-size:28px;font-weight:700}.bonus{font-size:17px;color:var(--good);font-weight:600}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.chip{border-radius:999px;padding:4px 12px;font-size:15px;font-weight:600;color:#fff}
.chip.plain{background:var(--fill);color:var(--text)}
.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.btn{display:inline-block;border-radius:12px;padding:11px 18px;font-weight:600;font-size:16px;background:var(--fill);color:var(--text)}
.btn.primary{background:var(--tint);color:var(--tint-text)}.btn:hover{text-decoration:none;opacity:.9}
.stat{margin:14px 0}.stat .row{display:flex;justify-content:space-between;font-weight:600}
.stat .why{color:var(--dim);font-size:14px}
.bar{height:8px;border-radius:4px;background:var(--fill);overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:var(--tint)}
footer{max-width:760px;margin:0 auto;padding:0 20px 40px;color:var(--dim);font-size:14px}
footer a{color:var(--dim);margin-right:14px}
.prose p,.prose li{color:var(--text)}.prose h2{margin-top:28px}
.rank{width:100%;border-collapse:collapse;font-size:16px}.rank th{text-align:left;color:var(--dim);font-weight:600;font-size:14px;padding:6px 8px}
.rank td{padding:8px;border-top:1px solid var(--line)}.rank .num{text-align:right;font-variant-numeric:tabular-nums}.rank .rk{color:var(--dim);width:2.5em}
.dim{color:var(--dim)}
`;

export function layout(o: {
  noindex?: boolean;
  title: string;
  description: string;
  path: string;
  body: string;
  image?: string;
  status?: string;
}) {
  const url = `https://gitemon.fun${o.path}`;
  const img = o.image ?? 'https://gitemon.fun/og-default.png';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${o.noindex ? '<meta name="robots" content="noindex">' : ''}
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${url}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Gitemon"><meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}">
<meta property="og:image" content="${img}"><meta property="og:image:alt" content="${esc(o.title)} — pixel creature card">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#0a66d8">
<style>${CSS}</style></head><body>
<header><a class="brand" href="/">Gitemon</a><a href="/map">Open the island</a></header>
<main>${o.body}</main>
<footer><a href="/map">Map</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://github.com/gitemon-fun/gitemon">Source (AGPL)</a><span>Made by AIgnited</span></footer>
</body></html>`;
}

export function profilePage(r: Row, bonus: number, town: string | null, caughtBy: number) {
  const t1 = TYPE_INFO[r.t1];
  const t2 = r.t2 ? TYPE_INFO[r.t2] : null;
  const stats = JSON.parse(r.stats) as Stats;
  const name = r.name ? `${esc(r.name)} · ` : '';
  const wild = r.status !== 'claimed';
  const statRows = (Object.keys(STAT_MEANING) as (keyof Stats)[])
    .map(
      (
        k,
      ) => `<div class="stat"><div class="row"><span>${k[0]!.toUpperCase() + k.slice(1)}</span><span>${stats[k]}</span></div>
<div class="why">${STAT_MEANING[k]}</div><div class="bar"><i style="width:${stats[k]}%"></i></div></div>`,
    )
    .join('');
  const body = `
<section class="card hero">
  <img style="background:radial-gradient(ellipse at 50% 85%, ${t1.colors[1]}55 0%, ${t1.colors[0]}33 38%, transparent 70%),linear-gradient(180deg, #8ec5ee33, transparent)" src="/sprite/${r.id}.png?s=8&v=${r.scorer_version}${r.form}${r.shiny}" width="192" height="192" alt="${esc(r.login)}'s Gitemon, a ${t1.name} ${SHAPE_NAME[r.shape]}">
  <div class="who">
    <h1>${esc(r.login)}</h1>
    <p class="sub">${name}${wild ? 'Wild Gitemon' : 'Claimed Gitemon'}${r.shiny ? ' · ✦ Shiny' : ''}${r.machine ? ' · Agent account' : ''}</p>
    <div><span class="lv">Lv ${r.level}</span>${bonus ? ` <span class="bonus">+${bonus} friendship</span>` : ''}</div>
    <div class="chips">
      <span class="chip" style="background:${t1.colors[2]}">${t1.name}</span>
      ${t2 ? `<span class="chip" style="background:${t2.colors[2]}">${t2.name}</span>` : ''}
      <span class="chip plain">${SHAPE_NAME[r.shape]}</span><span class="chip plain">Form ${r.form}</span>
    </div>
    <p class="sub">${wild ? `Lives in ${esc(town ?? t1.biome)}` : `Has a house in ${esc(t1.biome)}${town ? ` · ${esc(town)}` : ''}`} · caught by ${caughtBy} ${caughtBy === 1 ? 'player' : 'players'}</p>
    <div class="btns">
      <a class="btn primary" href="/map?${wild ? 'focus' : 'house'}=${encodeURIComponent(r.login)}">${wild ? 'See in the city' : 'Visit house'}</a>
      ${wild ? `<a class="btn" href="/auth/login?next=/map?focus=${encodeURIComponent(r.login)}">Is this you? Claim it</a>` : ''}
      <a class="btn" href="https://github.com/${encodeURIComponent(r.login)}" rel="nofollow">GitHub profile</a>
    </div>
  </div>
</section>
<section class="card"><h2>Stats</h2>${statRows}
<p class="sub" style="margin-top:16px">Stats come from public GitHub data only. Size never grows with volume: only work other people accepted counts, and every stat has a ceiling.</p></section>`;
  return layout({
    title: `${r.login} — Lv ${r.level} ${t1.name}${t2 ? `/${t2.name}` : ''} Gitemon`,
    description: `${r.login}'s Gitemon: a level ${r.level} ${t1.name} ${SHAPE_NAME[r.shape]} from ${t1.biome}. Catch it on gitemon.fun.`,
    path: `/${r.login}`,
    image: `https://gitemon.fun/og/${r.id}.png?v=${r.scorer_version}${r.level}${r.form}`,
    body,
  });
}

export function pendingPage(login: string) {
  return layout({
    title: `${login} — not in the world yet · Gitemon`,
    description: 'This developer has not appeared on the Gitemon map yet.',
    path: `/${login}`,
    noindex: true,
    body: `<section class="card"><h1>${esc(login)}</h1><p class="sub">This Gitemon has not hatched yet. We asked for it just now — it usually appears within a few minutes.</p>
<div class="btns"><a class="btn primary" href="/auth/login?next=/map?focus=${encodeURIComponent(login)}">Sign in with GitHub to hatch yours now</a><a class="btn" href="/map">Open the map</a></div></section>`,
  });
}

export function messagePage(status: number, title: string, text: string) {
  return layout({
    title: `${title} · Gitemon`,
    description: text,
    path: '/',
    body: `<section class="card"><h1>${esc(title)}</h1><p class="sub">${esc(text)}</p><div class="btns"><a class="btn primary" href="/map">Open the map</a><a class="btn" href="/">Home</a></div></section>`,
    status: String(status),
    noindex: true,
  });
}

export const privacyPage = () =>
  layout({
    title: 'Privacy · Gitemon',
    description: 'What Gitemon stores, why, and how to remove your Gitemon.',
    path: '/privacy',
    body: `<section class="card prose"><h1>Privacy</h1>
<p>Gitemon turns public GitHub activity into a pixel creature. This page says exactly what we keep.</p>
<h2>What we read</h2><ul>
<li>Public GitHub profile data: your login, name, account age, follower count, your public repositories (stars, language), and your public contribution counts for the last year.</li>
<li>The anonymous private-contribution count that GitHub itself shows on your profile — only if you turned that setting on in GitHub. It is a single number, with no repository names.</li>
<li>We never ask for access to private repositories, and we never read them.</li></ul>
<h2>What we store when you sign in</h2><ul>
<li>Your GitHub user id and the sign-in account id from our login provider (WorkOS), plus the email GitHub shares with it.</li>
<li>Your GitHub sign-in token, encrypted. It can only read public profile data, and we use it only to refresh your own Gitemon and to check "bonded" catches.</li>
<li>Your catches, your Dex and your town.</li></ul>
<h2>What we never store</h2><ul>
<li>Where you live. We do not read or keep your GitHub location.</li>
<li>Anything about developers who have not signed in — with one exception below.</li></ul>
<h2>Sealed legends</h2><p>The island's 500 sealed legends are ranked from public information (Wikipedia, Wikidata and public GitHub follower counts). For each one we keep only its GitHub user id, its rank and its creature — no profile, no name on the page, no link to a person. Nobody can tell whose legend is whose. If it is yours, sign in with GitHub: you can wake it (it then shows with your name) or remove it, and a removed legend is never added again.</p>
<h2>Cookies</h2><p>One cookie keeps you signed in. There is no analytics, no advertising and no tracking, so there is nothing to consent to.</p>
<h2>We never contact you</h2><p>If another player catches your Gitemon, we do not email you, mention you or open issues. You find out when you visit.</p>
<h2>Remove your Gitemon</h2><p>Sign in with GitHub and choose <b>Release</b> on your Gitemon. It disappears from the map, search, profile pages and every Dex at once. You can bring it back the same way.</p>
<h2>Questions</h2><p>Open an issue on <a href="https://github.com/gitemon-fun/gitemon/issues">github.com/gitemon-fun/gitemon</a>.</p></section>`,
  });

export const termsPage = () =>
  layout({
    title: 'Terms · Gitemon',
    description: 'The short terms for using Gitemon.',
    path: '/terms',
    body: `<section class="card prose"><h1>Terms</h1>
<p>Gitemon is a free game. By using it you agree to the following.</p><ul>
<li>Play fair. Do not automate catching, create accounts to farm buffs, or overload the service.</li>
<li>Town names must not be abusive. We may rename or remove towns and hide Gitemon that break this.</li>
<li>The service is provided as is, with no warranty. It may change or stop.</li>
<li>The source code is open under the GNU AGPL v3. The Gitemon name, logo and creature art are not covered by that licence.</li>
<li>Gitemon is not affiliated with GitHub, or with any other game or company.</li></ul></section>`,
  });

export const homePage = (count: number) =>
  layout({
    title: 'Gitemon — every developer is a creature',
    description:
      'Your GitHub work, hatched into a pixel creature on one shared island. Catch other developers, claim your own, bring it home to the town.',
    path: '/',
    body: `<section class="card"><h1>Every developer is a creature.</h1>
<a href="/map"><img src="/og-default.png" width="1200" height="630" alt="Gitemon Island: a round town full of pixel creatures, ringed by snow peaks, jungle, desert, a volcano and the sea" style="width:100%;height:auto;border-radius:14px;margin:4px 0 14px"></a>
<p class="sub">Sign in with GitHub and your public work hatches into a pixel Gitemon on Gitemon Island. Its type comes from your languages. Its power comes from work other people accepted — never from raw volume. ${count.toLocaleString('en-US')} developers have hatched so far, and 500 sealed legends are waiting for theirs.</p>
<div class="btns"><a class="btn primary" href="/auth/login?next=/map">Sign in with GitHub</a><a class="btn" href="/map">Open the island</a></div></section>
<section class="card"><h2>How it works</h2><ul>
<li><b>Hatch.</b> Sign in with GitHub and your Gitemon hatches from your public profile. Nobody else can hatch you.</li>
<li><b>Catch.</b> Catch other players' Gitemon. Worked together for real? It's a bonded catch.</li>
<li><b>Sealed legends.</b> 500 creatures belong to developers who shaped the tech world. They sleep on the island, nameless, until their own developer signs in — who can wake theirs or remove it.</li>
<li><b>Belong.</b> Every language has a home in one of nine climates. The stronger a Gitemon, the nearer the town it lives; claimed Gitemon live in town with their tamer.</li></ul>
<p class="sub">We never read private repositories, never store where you live, and never contact anyone.</p></section>`,
  });
