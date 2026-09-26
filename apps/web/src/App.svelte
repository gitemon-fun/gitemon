<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SHAPE_NAME,
    STAT_MEANING,
    TYPE_INFO,
    type MapGitemon,
    type Stats,
  } from '@gitemon/shared';
  import { api, ERRORS, type Detail, type Me, type Town } from './lib/api';
  import { CityScene } from './city/scene';
  import { loadCity, type LoadedCity } from './city/load';
  import { CATCH_M, IDLE_MS, SIGHT_M } from '@gitemon/shared';
  import Sprite from './lib/Sprite.svelte';

  // Gitemon Island is the map (GRANDPLAN v4): a centre town and nine climate regions.
  let host: HTMLDivElement;
  let scene: CityScene | null = null;
  let town: LoadedCity | null = null;
  let me = $state<Me | null>(null);
  let loaded = $state(false);
  let failed = $state(false);
  let picked = $state<MapGitemon | null>(null);
  let detail = $state<Detail | null>(null);
  let panel = $state<'dex' | 'towns' | 'me' | null>(null);
  let query = $state('');
  let searching = $state(false);
  let toast = $state<string | null>(null);
  let total = $state(0);
  let sealed = $state(0);
  let players = $derived(total - sealed);
  let dex = $state<(MapGitemon & { bonded: boolean })[]>([]);
  let towns = $state<Town[]>([]);
  let townName = $state('');
  let busy = $state(false);

  const statKeys = Object.keys(STAT_MEANING) as (keyof Stats)[];

  function say(msg: string) {
    toast = msg;
    setTimeout(() => (toast === msg ? (toast = null) : null), 3200);
  }

  function route() {
    const p = location.pathname;
    panel = p === '/dex' ? 'dex' : p === '/towns' ? 'towns' : p === '/me' ? 'me' : null;
    if (panel === 'dex') loadDex();
    if (panel === 'towns') loadTowns();
  }
  function go(path: string) {
    history.pushState({}, '', path);
    route();
  }

  async function loadMe() {
    const r = await api.me();
    me = r.data.player;
  }
  async function loadDex() {
    if (!me) return;
    dex = (await api.dex()).data.dex ?? [];
  }
  async function loadTowns() {
    towns = (await api.towns()).data.towns ?? [];
  }

  /** the opening view: the town plus the inner edge of every region (G1), on any screen shape */
  const homeZoom = () =>
    Math.min(0.8, Math.max(0.42, (150 * (host.clientWidth / host.clientHeight)) / 220));

  /** Fly to a Gitemon in the city, stop it walking, ring it and open its sheet. */
  function show(g: MapGitemon, zoom = 3.2) {
    const p = town?.byId.get(g.id);
    if (p && scene) {
      const held = scene.hold(p);
      scene.flyTo(held.spot.x, held.spot.z, zoom);
      scene.select(held);
    }
    select(g);
  }

  async function select(g: MapGitemon | null) {
    picked = g;
    detail = null;
    if (!g) {
      scene?.select(null);
      return;
    }
    // a sealed legend has no person behind it on the page: nothing to fetch (V5-D4)
    if (g.special?.sealed) return;
    const r = await api.detail(g.id);
    if (r.status === 200 && picked?.id === g.id) detail = r.data;
  }

  const TIER_NAME = {
    legendary: 'Legendary',
    mythic: 'Mythic',
    epic: 'Epic',
    rare: 'Rare',
  } as const;
  const regionOf = (t: MapGitemon['t1']) =>
    town?.city.regions.find((r) => r.types.includes(t))?.name ?? TYPE_INFO[t].biome;

  async function wakeLegend() {
    busy = true;
    await api.wake();
    busy = false;
    await loadMe();
    say('Your legend is awake. It shows with your name from the next map refresh.');
  }
  async function removeLegend() {
    if (!confirm('Remove your sealed legend for good? It will not come back.')) return;
    busy = true;
    await api.removeLegend();
    busy = false;
    await loadMe();
    say('Your legend is removed and will not be added again.');
  }

  async function search(e?: Event, zoom = 3.2) {
    e?.preventDefault();
    const login = query.trim().replace(/^@/, '');
    if (!login) return;
    searching = true;
    try {
      const r = await api.find(login);
      if (r.data.g) {
        show(r.data.g, zoom);
        panel = null;
        if (location.pathname !== '/map') history.replaceState({}, '', '/map');
      } else
        say(
          r.status === 400
            ? 'That is not a GitHub username.'
            : 'Not on the island yet. Every Gitemon hatches when its own developer signs in.',
        );
    } finally {
      searching = false;
    }
  }

  // ---- v6: walking (V6-D1…D6) ------------------------------------------------------------------

  let walked = $state(0); // metres walked away from home today (walking home is free)
  let walking = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const sightAsked = new Set<string>();
  let blessedToday = false;
  const demo = typeof location !== 'undefined' && location.search.includes('walkdemo');

  const budgetLeft = () => (me ? Math.max(0, me.walk.budget - walked) : demo ? 400 - walked : 0);
  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => scene?.walkHome(), IDLE_MS);
  }
  function startWalking(city: LoadedCity) {
    const id = me?.id ?? (demo ? -999 : null);
    if (id == null) return;
    const i = city.placed.findIndex((p) => p.g.id === id);
    if (i < 0 || !scene) return;
    walking = true;
    walked = me?.walk.walked ?? 0;
    scene.enableWalker(city.city, i);
    scene.onGround = (x, z) => {
      const home = scene!.walkerHome!;
      const toHome = Math.hypot(x - home.x, z - home.z) < 6;
      const len = scene!.planWalk(x, z);
      if (len == null) {
        say('No way there on foot.');
        return true;
      }
      if (!toHome && len > budgetLeft()) {
        say(
          `Not enough steps today: ${Math.round(budgetLeft())} m left. Real GitHub work earns more.`,
        );
        return true;
      }
      scene!.walkTo(x, z);
      if (!toHome) walked += len;
      armIdle();
      return true;
    };
    scene.onWalk = (x, z) => checkLegends(x, z);
    armIdle();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) scene?.snapHome();
    });
  }
  /** near a legend: log it (V6-D3); near the legend of the day: be blessed (V6-D4) */
  async function checkLegends(x: number, z: number) {
    if (!town) return;
    for (const p of town.placed) {
      const sp = p.g.special;
      if (!sp || Math.hypot(p.spot.x - x, p.spot.z - z) > SIGHT_M) continue;
      if (demo) {
        if (!sightAsked.has(sp.key)) say(`Seen: a ${sp.tier} legend (demo).`);
        sightAsked.add(sp.key);
        continue;
      }
      if (!me) return;
      if (!me.walk.seen.includes(sp.key) && !sightAsked.has(sp.key)) {
        sightAsked.add(sp.key);
        const r = await api.sight(sp.key, x, z, walked);
        if (r.data.ok && r.data.new) {
          me.walk.seen = [...me.walk.seen, sp.key];
          me.walk.tally = { ...me.walk.tally, [sp.tier]: (me.walk.tally[sp.tier] ?? 0) + 1 };
          say(
            `Seen: ${sp.title ?? `a ${sp.tier} legend`} — ${r.data.seen} of 500 in your Legend Log.`,
          );
        }
      }
      if (sp.key === town.today && !blessedToday) {
        blessedToday = true;
        const r = await api.bless(sp.key, x, z, walked);
        if (r.data.ok) {
          me.walk.streak = r.data.streak ?? me.walk.streak;
          say('Blessed by the legend of the day — your Gitemon glows for 6 hours.');
        }
      }
    }
  }
  /** how far the player's walker is from a resident (catching needs ≤ 8 m, V6-D2) */
  const distanceTo = (g: MapGitemon) => {
    const w = scene?.walkerPos;
    const p = town?.byId.get(g.id);
    return w && p ? Math.hypot(w[0] - p.spot.x, w[1] - p.spot.z) : Infinity;
  };

  async function doCatch() {
    if (!picked) return;
    if (!me) {
      location.href = `/auth/login?next=${encodeURIComponent('/map?focus=' + picked.login)}`;
      return;
    }
    busy = true;
    const r = await api.catch(picked.id);
    busy = false;
    if (r.data.ok) {
      say(
        r.data.n && r.data.n <= 10
          ? `Caught! You are catcher #${r.data.n} — an early scout.`
          : 'Caught! Added to your Dex.',
      );
      if (me) me.catchesLeft = r.data.left ?? me.catchesLeft;
      select(picked);
    } else say(ERRORS[r.data.error ?? 'server'] ?? 'Could not catch.');
  }

  async function release(hidden: boolean) {
    busy = true;
    await api.release(hidden);
    busy = false;
    await loadMe();
    say(
      hidden ? 'Released. Your Gitemon is hidden everywhere.' : 'Your Gitemon is back on the map.',
    );
  }

  async function found(e: Event) {
    e.preventDefault();
    busy = true;
    const r = await api.found(townName.trim());
    busy = false;
    if (r.data.ok) {
      say(`You founded ${townName.trim()}.`);
      townName = '';
      await afterMove();
    } else say(ERRORS[r.data.error ?? 'server'] ?? 'Could not found the town.');
  }
  async function join(t: Town) {
    busy = true;
    const r = await api.join(t.id);
    busy = false;
    if (r.data.ok) {
      say(`You moved to ${t.name}.`);
      await afterMove();
    } else say(ERRORS[r.data.error ?? 'server'] ?? 'Could not join.');
  }
  async function leave() {
    busy = true;
    await api.leave();
    busy = false;
    say('You moved back to your starter village.');
    await afterMove();
  }
  async function afterMove() {
    await Promise.all([loadMe(), loadTowns()]);
  }

  async function signOut() {
    await api.logout();
    me = null;
    go('/map');
  }

  onMount(() => {
    scene = new CityScene(host, (p) => select(p ? p.g : null));
    if (location.search.includes('debug')) (window as unknown as { city: CityScene }).city = scene;
    window.addEventListener('popstate', route);
    route();
    (async () => {
      const tl = performance.now();
      const [loadedCity] = await Promise.all([loadCity(), loadMe()]);
      if (scene) scene.stats.layoutMs = Math.round(performance.now() - tl);
      if (!loadedCity) {
        failed = true;
        return;
      }
      town = loadedCity;
      total = loadedCity.placed.length;
      sealed = loadedCity.placed.filter((p) => p.g.special?.sealed).length;
      scene!.build(loadedCity.city, loadedCity.homes);
      // ?walkdemo: a stand-in walker at the first town door, to try walking before signing in
      if (demo && !me) {
        const door = loadedCity.city.doors[0]!;
        loadedCity.placed.push({
          g: {
            id: -999,
            login: 'you',
            x: 0,
            y: 0,
            t1: 'wild',
            t2: null,
            sh: 'steady',
            f: 2,
            s: 0,
            lv: 1,
            st: 'c',
            a: 0,
          },
          spot: { ...door },
        });
        loadedCity.byId.set(-999, loadedCity.placed.at(-1)!);
      }
      scene!.setCreatures(loadedCity.placed);
      scene!.stage(loadedCity.city, loadedCity.placed, loadedCity.today ?? null);
      startWalking(loadedCity);
      scene!.fitCity(loadedCity.city.radius);
      loaded = true;
      const qs = new URLSearchParams(location.search);
      const house = qs.get('house');
      const focus = qs.get('focus') ?? house;
      // ?at=<type> frames that type's mini plaza (share links, screenshots); ?z= sets the zoom
      // ?at=<type> frames that type's nearest habitat (its best residents)
      // ?turn=0..3 sets the camera rotation (screenshots of every side)
      for (let k = 0; k < (Number(qs.get('turn')) || 0) % 4; k++) scene!.rotate(1);
      const atType = qs.get('at');
      const region = loadedCity.city.regions.findIndex((r) => r.types.includes(atType as never));
      // v5: a type's mini plaza (its specials) first, else its nearest habitat
      const at =
        loadedCity.city.miniPlazas.find((m) => m.region === region) ??
        loadedCity.city.habitats.find((h) => h.t === atType);
      if (at) scene!.flyTo(at.x, at.z, Number(qs.get('z')) || 1.6);
      else if (qs.get('z')) scene!.flyTo(0, 0, Number(qs.get('z')));
      else if (focus) {
        query = focus;
        // ?house=<login> (profile "Visit house", V3-D2): the same flight, closer, onto the door
        await search(undefined, house ? 4 : 3.2);
      } else if (me && !me.hidden && town.byId.has(me.id)) show(me, 2.6);
      else scene!.flyTo(0, 0, homeZoom());
    })();
    return () => scene?.destroy();
  });

  const typeLine = (g: MapGitemon) =>
    g.t2 ? `${TYPE_INFO[g.t1].name} / ${TYPE_INFO[g.t2].name}` : TYPE_INFO[g.t1].name;
</script>

<div bind:this={host} class="map" role="application" aria-label="Gitemon City"></div>

<header class="bar">
  <a class="brand" href="/" title="Gitemon home">Gitemon</a>
  <form class="search" onsubmit={search} role="search">
    <input
      bind:value={query}
      placeholder="Find a GitHub username"
      aria-label="GitHub username"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button disabled={searching} aria-label="Find">{searching ? '…' : 'Find'}</button>
  </form>
  <nav>
    {#if me}
      <button class:on={panel === 'dex'} onclick={() => go(panel === 'dex' ? '/map' : '/dex')}
        >Dex</button
      >
      <button class:on={panel === 'towns'} onclick={() => go(panel === 'towns' ? '/map' : '/towns')}
        >Towns</button
      >
      <button
        class="mine"
        class:on={panel === 'me'}
        onclick={() => go(panel === 'me' ? '/map' : '/me')}
        aria-label="My Gitemon"
      >
        <Sprite g={me} size={28} />
      </button>
    {:else}
      <button onclick={() => go(panel === 'towns' ? '/map' : '/towns')}>Towns</button>
      <a class="signin" href="/auth/login?next=/map">Sign in</a>
    {/if}
  </nav>
</header>

<div class="zoom" aria-label="Zoom">
  <button onclick={() => scene?.zoomBy(1.6)} aria-label="Zoom in">+</button>
  <button onclick={() => scene?.zoomBy(1 / 1.6)} aria-label="Zoom out">−</button>
  <button onclick={() => scene?.rotate(1)} aria-label="Turn the city">⟳</button>
  <button onclick={() => scene?.flyTo(0, 0, homeZoom())} aria-label="Back to the town" class="fit"
    >⌂</button
  >
</div>

{#if failed}
  <div class="hint">The city could not load. Try again in a minute.</div>
{:else if !loaded}
  <div class="hint">Building the island…</div>
{:else if !picked && !panel}
  <div class="hint">
    {#if players}{players.toLocaleString('en-US')} Gitemon and
    {/if}{sealed.toLocaleString('en-US')} sealed legends live on the island. The stronger a Gitemon, the
    nearer the town it lives. Sign in with GitHub to hatch yours. Tap anyone.
  </div>
{/if}

{#if picked?.special?.sealed}
  <section class="sheet sealed" aria-label="A sealed legend">
    <button
      class="close"
      onclick={() => {
        picked = null;
        scene?.select(null);
      }}
      aria-label="Close">×</button
    >
    <div class="head">
      <div class="silhouette tier-{picked.special.tier}"><Sprite g={picked} size={96} /></div>
      <div>
        <h2>{picked.special.title ?? `${TIER_NAME[picked.special.tier]} legend`}</h2>
        <p class="dim">{TIER_NAME[picked.special.tier]} · sealed · {regionOf(picked.t1)}</p>
      </div>
    </div>
    <p>
      {#if me?.walk.seen.includes(picked.special.key)}<b>In your Legend Log.</b>{/if}
      {#if town?.today === picked.special.key}<b>Legend of the day</b> — stand near it to be blessed.{/if}
      A sealed legend. It belongs to a developer who shaped the tech world. It wakes only when they sign
      in.
    </p>
  </section>
{:else if picked}
  <section class="sheet" aria-label="Selected Gitemon">
    <button
      class="close"
      onclick={() => {
        picked = null;
        detail = null;
        scene?.select(null);
      }}
      aria-label="Close">×</button
    >
    <div class="head">
      <Sprite g={picked} size={96} />
      <div>
        <h2>{picked.login}</h2>
        <p class="dim">
          {detail?.name ? detail.name + ' · ' : ''}{picked.st === 'c' ? 'Claimed' : 'Wild'}{picked.s
            ? ' · ✦ Shiny'
            : ''}
        </p>
        {#if picked.special}<p class="dim">
            {picked.special.title ?? `${TIER_NAME[picked.special.tier]} legend`} · awake
          </p>{/if}
        <p class="lv">
          Lv {picked.lv}{#if detail?.bonus}<span class="bonus"> +{detail.bonus}</span>{/if}
        </p>
        <p class="chips">
          <span class="chip" style="background:{TYPE_INFO[picked.t1].colors[2]}"
            >{TYPE_INFO[picked.t1].name}</span
          >
          {#if picked.t2}<span class="chip" style="background:{TYPE_INFO[picked.t2].colors[2]}"
              >{TYPE_INFO[picked.t2].name}</span
            >{/if}
          <span class="chip plain">{SHAPE_NAME[picked.sh]}</span><span class="chip plain"
            >Form {picked.f}</span
          >
        </p>
      </div>
    </div>
    {#if detail}
      <div class="stats">
        {#each statKeys as k (k)}
          <div class="stat" title={STAT_MEANING[k]}>
            <span>{k}</span>
            <div class="barbg"><i style="width:{detail.stats[k]}%"></i></div>
            <b>{detail.stats[k]}</b>
          </div>
        {/each}
      </div>
      <p class="dim small">
        {TYPE_INFO[picked.t1].biome}{detail.town ? ` · ${detail.town.name}` : ''} · caught by {detail.caughtCount}
      </p>
    {/if}
    <div class="actions">
      {#if me && picked.id === me.id}
        <span class="dim">This is you.</span>
      {:else if detail?.caughtByMe}
        <span class="done">In your Dex{detail.caughtByMe.bonded ? ' · Bonded' : ''}</span>
      {:else if !detail?.machine}
        {#if me && walking && distanceTo(picked) > CATCH_M}
          <button class="primary" disabled
            >Walk closer to catch ({Math.round(distanceTo(picked))} m away)</button
          >
        {:else}
          <button class="primary" disabled={busy} onclick={doCatch}
            >{me
              ? `Catch${me.catchesLeft != null ? ` (${me.catchesLeft} left today)` : ''}`
              : 'Sign in to catch'}</button
          >
        {/if}
      {/if}
      <a class="btn" href={'/' + picked.login}>Profile</a>
    </div>
  </section>
{/if}

{#if panel}
  <section class="panel" aria-label={panel}>
    <button class="close" onclick={() => go('/map')} aria-label="Close">×</button>
    {#if panel === 'dex'}
      <h2>Your Dex</h2>
      {#if !me}
        <p class="dim">Sign in with GitHub to start catching.</p>
      {:else if dex.length === 0}
        <p class="dim">
          Empty so far. Tap any Gitemon on the map and catch it. You have {me.catchesLeft} catches left
          today.
        </p>
      {:else}
        <p class="dim">{dex.length} caught · {dex.filter((d) => d.bonded).length} bonded</p>
        <div class="grid">
          {#each dex as d (d.id)}
            <button
              class="cell"
              onclick={() => {
                panel = null;
                history.pushState({}, '', '/map');
                show(d);
              }}
            >
              <Sprite g={d} size={56} />
              <span>{d.login}</span>
              <small>{typeLine(d)}{d.bonded ? ' · bonded' : ''}</small>
            </button>
          {/each}
        </div>
      {/if}
    {:else if panel === 'towns'}
      <h2>Towns</h2>
      <p class="dim">
        Wild Gitemon live in their climate region; claimed ones live in the town with their tamer. A
        town is a group you choose.
      </p>
      {#if me}
        {#if me.town}
          <p>
            You live in <b>{me.town.name}</b>.
            <button class="link" onclick={leave} disabled={busy}>Move back to the village</button>
          </p>
        {:else}
          <form class="found" onsubmit={found}>
            <input
              bind:value={townName}
              maxlength="24"
              placeholder="Name a new town"
              aria-label="Town name"
            />
            <button class="primary" disabled={busy || townName.trim().length < 3}>Found town</button
            >
          </form>
        {/if}
      {:else}
        <p><a href="/auth/login?next=/towns">Sign in</a> to found or join a town.</p>
      {/if}
      <ul class="towns">
        {#each towns as t (t.id)}
          <li>
            <div>
              <b>{t.name}</b>{#if t.kind === 'official'}<span class="official">official</span
                >{/if}<br /><small class="dim"
                >{TYPE_INFO[t.biome].biome} · {t.members}
                {t.members === 1 ? 'member' : 'members'}</small
              >
            </div>
            {#if me && me.town?.id !== t.id}<button disabled={busy} onclick={() => join(t)}
                >Join</button
              >{/if}
          </li>
        {:else}
          <li class="dim">No towns yet. Be the first.</li>
        {/each}
      </ul>
    {:else if panel === 'me' && me}
      <div class="head">
        <Sprite g={me} size={96} />
        <div>
          <h2>{me.login}</h2>
          <p class="lv">
            Lv {me.lv}{#if me.bonus}<span class="bonus"> +{me.bonus} friendship</span>{/if}
          </p>
          <p class="dim">{typeLine(me)} · {SHAPE_NAME[me.sh]} · Form {me.f}</p>
        </div>
      </div>
      {#if me.legend && !me.legend.woken}
        <div class="legend-offer">
          <p>
            <b>You have a sealed legend</b> — {me.legend.title ??
              TIER_NAME[me.legend.tier as keyof typeof TIER_NAME]}, #{me.legend.rank} on the island. Nobody
            can see it is yours. Wake it to show it with your name, or remove it for good.
          </p>
          <div class="actions">
            <button class="primary" disabled={busy} onclick={wakeLegend}>Wake it</button>
            <button disabled={busy} onclick={removeLegend}>Remove it</button>
          </div>
        </div>
      {/if}
      <div class="walkstats">
        <p>
          <b>Legend Log:</b>
          {me.walk.seen.length} of 500 seen{#each ['legendary', 'mythic', 'epic', 'rare'] as t}{#if me.walk.tally[t]}
              · {TIER_NAME[t as keyof typeof TIER_NAME]} {me.walk.tally[t]}{/if}{/each}
        </p>
        <p>
          <b>Steps today:</b>
          {Math.round(Math.max(0, me.walk.budget - walked))} of {me.walk.budget} m left{#if me.walk.streak}
            · <b>Streak:</b>
            {me.walk.streak}
            {me.walk.streak === 1 ? 'day' : 'days'}{/if}
        </p>
        <p class="dim small">
          Tap the map to walk. Walking home is free. Real GitHub work — merged pull requests,
          reviews, active weeks — earns more steps.
        </p>
      </div>
      <p>{me.catchesLeft} catches left today.</p>
      <p class="dim">
        You have a house in {TYPE_INFO[me.t1].biome}{me.town
          ? ` and belong to ${me.town.name}`
          : ''}.
      </p>
      <div class="actions">
        <a class="btn" href={'/' + me.login}>Public profile</a>
        {#if me.hidden}
          <button class="primary" disabled={busy} onclick={() => release(false)}
            >Bring my Gitemon back</button
          >
        {:else}
          <button disabled={busy} onclick={() => release(true)}>Release (hide me everywhere)</button
          >
        {/if}
        <button onclick={signOut}>Sign out</button>
      </div>
    {/if}
  </section>
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}
