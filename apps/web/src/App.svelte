<script lang="ts">
  import { onMount } from 'svelte';
  import {
    COUNTRY_NAME,
    SHAPE_NAME,
    STAT_MEANING,
    TYPE_INFO,
    flag,
    type MapGitemon,
    type Stats,
  } from '@gitemon/shared';
  import { api, ERRORS, type Detail, type Me, type Town } from './lib/api';
  import { CityScene } from './city/scene';
  import { loadCity, type LoadedCity } from './city/load';
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
    const r = await api.detail(g.id);
    if (r.status === 200 && picked?.id === g.id) detail = r.data;
  }

  async function search(e?: Event, zoom = 3.2) {
    e?.preventDefault();
    const login = query.trim().replace(/^@/, '');
    if (!login) return;
    searching = true;
    try {
      const r = await api.find(login);
      if (r.status === 202) say('That Gitemon is hatching. Try again in a few minutes.');
      else if (r.data.g) {
        show(r.data.g, zoom);
        if (!town?.byId.has(r.data.g.id))
          say('Just hatched. It moves into the city within ten minutes.');
        panel = null;
        if (location.pathname !== '/map') history.replaceState({}, '', '/map');
      } else
        say(
          r.status === 400 ? 'That is not a GitHub username.' : 'No GitHub developer by that name.',
        );
    } finally {
      searching = false;
    }
  }

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

  async function setHometown(showIt: boolean) {
    busy = true;
    await api.hometown(showIt);
    busy = false;
    await loadMe();
    say(showIt ? 'Your hometown shows on your profile.' : 'Your hometown is hidden.');
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
      scene!.build(loadedCity.city, loadedCity.homes);
      scene!.setCreatures(loadedCity.placed);
      scene!.fitCity(loadedCity.city.radius);
      loaded = true;
      const qs = new URLSearchParams(location.search);
      const house = qs.get('house');
      const focus = qs.get('focus') ?? house;
      // ?at=<type> frames that type's best habitat (share links, screenshots); ?z= sets the zoom
      // ?at=<type> frames that type's nearest habitat (its best residents)
      const at = loadedCity.city.habitats.find((h) => h.t === qs.get('at'));
      if (at) scene!.flyTo(at.x, at.z, Number(qs.get('z')) || 1.6);
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
    {total.toLocaleString('en-US')} Gitemon live on the island. The most notable stand on the plaza; the
    stronger a Gitemon, the nearer the town it lives. Tap anyone.
  </div>
{/if}

{#if picked}
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
        {TYPE_INFO[picked.t1].biome}{detail.town ? ` · ${detail.town.name}` : ''} · caught by {detail.caughtCount}{detail.home
          ? ` · ${flag(detail.home.cc)} ${detail.home.city ? `${detail.home.city}, ` : ''}${COUNTRY_NAME[detail.home.cc] ?? detail.home.cc}`
          : ''}
      </p>
    {/if}
    <div class="actions">
      {#if me && picked.id === me.id}
        <span class="dim">This is you.</span>
      {:else if detail?.caughtByMe}
        <span class="done">In your Dex{detail.caughtByMe.bonded ? ' · Bonded' : ''}</span>
      {:else if !detail?.machine}
        <button class="primary" disabled={busy} onclick={doCatch}
          >{me
            ? `Catch${me.catchesLeft != null ? ` (${me.catchesLeft} left today)` : ''}`
            : 'Sign in to catch'}</button
        >
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
      <p>{me.catchesLeft} catches left today.</p>
      <p class="dim">
        You have a house in {TYPE_INFO[me.t1].biome}{me.town
          ? ` and belong to ${me.town.name}`
          : ''}.
      </p>
      {#if me.home}
        <p class="dim">
          Hometown: {flag(me.home.cc)}
          {me.home.city ? `${me.home.city}, ` : ''}{COUNTRY_NAME[me.home.cc] ?? me.home.cc}
          ({me.home.shown ? 'shown' : 'hidden'} on your profile).
          <button class="link" disabled={busy} onclick={() => setHometown(!me!.home!.shown)}
            >{me.home.shown ? 'Hide it' : 'Show it'}</button
          >
        </p>
      {/if}
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
