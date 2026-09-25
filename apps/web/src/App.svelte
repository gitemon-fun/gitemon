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
  import { WorldView } from './lib/world';
  import Sprite from './lib/Sprite.svelte';

  let canvas: HTMLCanvasElement;
  let view: WorldView | null = null;
  let me = $state<Me | null>(null);
  let loaded = $state(false);
  let band = $state<'world' | 'town' | 'street'>('world');
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
    if (view) view.me = me?.id ?? null;
  }
  async function loadDex() {
    if (!me) return;
    dex = (await api.dex()).data.dex ?? [];
  }
  async function loadTowns() {
    towns = (await api.towns()).data.towns ?? [];
  }

  async function select(g: MapGitemon | null) {
    picked = g;
    detail = null;
    if (!g) return;
    const r = await api.detail(g.id);
    if (r.status === 200 && picked?.id === g.id) detail = r.data;
  }

  async function search(e?: Event) {
    e?.preventDefault();
    const login = query.trim().replace(/^@/, '');
    if (!login) return;
    searching = true;
    try {
      const r = await api.find(login);
      if (r.status === 202) say('That Gitemon is hatching. Try again in a few minutes.');
      else if (r.data.g) {
        view?.upsert(r.data.g);
        view?.flyTo(r.data.g.x, r.data.g.y, 22);
        if (view) view.selected = r.data.g;
        select(r.data.g);
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
    view?.invalidate();
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
    const n = await api.notable();
    view?.invalidate();
    view?.setNotable(n.data.g, n.data.towns, n.data.pops);
    if (me) view?.flyTo(me.x, me.y, 18);
  }

  async function signOut() {
    await api.logout();
    me = null;
    if (view) view.me = null;
    go('/map');
  }

  onMount(() => {
    view = new WorldView(
      canvas,
      (g) => select(g),
      (b) => (band = b),
    );
    band = view.band;
    window.addEventListener('popstate', route);
    route();
    (async () => {
      const [n] = await Promise.all([api.notable(), loadMe()]);
      total = n.data.total;
      view!.setNotable(n.data.g, n.data.towns, n.data.pops);
      loaded = true;
      const focus = new URLSearchParams(location.search).get('focus');
      if (focus) {
        query = focus;
        await search();
      } else if (me && !me.hidden) {
        view!.flyTo(me.x, me.y, 18);
      }
    })();
    return () => view?.destroy();
  });

  const typeLine = (g: MapGitemon) =>
    g.t2 ? `${TYPE_INFO[g.t1].name} / ${TYPE_INFO[g.t2].name}` : TYPE_INFO[g.t1].name;
</script>

<canvas bind:this={canvas} class="map" aria-label="The Gitemon world map"></canvas>

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
  <button onclick={() => view?.zoomBy(1.8)} aria-label="Zoom in">+</button>
  <button onclick={() => view?.zoomBy(1 / 1.8)} aria-label="Zoom out">−</button>
  <button onclick={() => view?.fit()} aria-label="Whole world" class="fit">◱</button>
</div>

{#if loaded && band !== 'street' && !picked && !panel}
  <div class="hint">
    {band === 'world'
      ? `${total.toLocaleString('en-US')} Gitemon. Only the notable ones are visible from here — zoom in to see everyone.`
      : 'Zoom in further to see each Gitemon.'}
  </div>
{/if}

{#if picked}
  <section class="sheet" aria-label="Selected Gitemon">
    <button
      class="close"
      onclick={() => {
        picked = null;
        detail = null;
        if (view) view.selected = null;
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
        {TYPE_INFO[picked.t1].biome}{detail.town ? ` · ${detail.town.name}` : ''} · caught by {detail.caughtCount}
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
                view?.flyTo(d.x, d.y, 22);
                if (view) view.selected = d;
                select(d);
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
      <p class="dim">Your home is your language's biome. A town is a group you choose.</p>
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
        {me.town
          ? `You live in ${me.town.name}.`
          : `You live in the ${TYPE_INFO[me.t1].biome} starter village.`}
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
