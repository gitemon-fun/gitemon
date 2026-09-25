<script lang="ts">
  import { onMount } from 'svelte';
  import {
    BIOME_ORDER,
    SHAPE_NAME,
    STAT_MEANING,
    TYPE_INFO,
    layout,
    type MapGitemon,
    type Stats,
  } from '@gitemon/shared';
  import { api, type Detail } from '../lib/api';
  import { CityScene, type Placed } from './scene';

  let host: HTMLDivElement;
  let scene: CityScene | null = null;
  let picked = $state<Placed | null>(null);
  let detail = $state<Detail | null>(null);
  let status = $state('Building the city…');
  let placedAll: Placed[] = [];
  const statKeys = Object.keys(STAT_MEANING) as (keyof Stats)[];
  // the slice shows the plaza + one district (GRANDPLAN v2, build file 02)
  const SLICE: (typeof BIOME_ORDER)[number] = 'forge';

  async function select(p: Placed | null) {
    picked = p;
    detail = null;
    if (!p) return;
    const r = await api.detail(p.g.id);
    if (r.status === 200 && picked?.g.id === p.g.id) detail = r.data;
  }

  onMount(() => {
    scene = new CityScene(host, (p) => select(p));
    (async () => {
      const [n, top, dist] = await Promise.all([
        api.notable(),
        fetch('/api/top?limit=60').then((r) => r.json() as Promise<{ g: MapGitemon[] }>),
        fetch(`/api/district/${SLICE}?limit=1500`).then(
          (r) => r.json() as Promise<{ g: MapGitemon[] }>,
        ),
      ]);
      const city = layout(n.data.pops as Record<string, number>);
      scene!.build(city);
      const placed: Placed[] = [];
      const inPlaza = new Set<number>();
      top.g.forEach((g, i) => {
        const spot = city.plaza[i];
        if (!spot) return;
        placed.push({ g, spot });
        inPlaza.add(g.id);
      });
      const d = BIOME_ORDER.indexOf(SLICE);
      const spots = city.spots[d];
      dist.g
        .filter((g) => !inPlaza.has(g.id))
        .forEach((g, i) => {
          if (spots[i]) placed.push({ g, spot: spots[i] });
        });
      placedAll = placed;
      scene!.setCreatures(placed);
      scene!.fitCity(city.radius);
      status = '';
      const focus = new URLSearchParams(location.search).get('focus');
      const hit = focus
        ? placed.find((p) => p.g.login.toLowerCase() === focus.toLowerCase())
        : null;
      if (hit) {
        scene!.flyTo(hit.spot.x, hit.spot.z, 3.2);
        scene!.select(hit);
        select(hit);
      } else scene!.flyTo(0, 0, 1.3);
    })();
    return () => scene?.destroy();
  });

  function close() {
    picked = null;
    detail = null;
    scene?.select(null);
  }
  const typeLine = (g: MapGitemon) =>
    g.t2 ? `${TYPE_INFO[g.t1].name} / ${TYPE_INFO[g.t2].name}` : TYPE_INFO[g.t1].name;
</script>

<div class="city" bind:this={host}></div>

<header class="bar">
  <a class="brand" href="/">Gitemon City</a>
  <span class="dim small">Preview · the plaza and Magma Fields</span>
  <a class="btn" href="/map">Old map</a>
</header>

<div class="zoom">
  <button onclick={() => scene?.zoomBy(1.6)} aria-label="Zoom in">+</button>
  <button onclick={() => scene?.zoomBy(1 / 1.6)} aria-label="Zoom out">−</button>
  <button onclick={() => scene?.rotate(1)} aria-label="Rotate">⟳</button>
  <button onclick={() => scene?.flyTo(0, 0, 1.3)} aria-label="Back to the plaza">⌂</button>
</div>

{#if status}<div class="hint">{status}</div>{/if}

{#if picked}
  <section class="sheet" aria-label="Selected Gitemon">
    <button class="close" onclick={close} aria-label="Close">×</button>
    <h2>{picked.g.login}</h2>
    <p class="dim">
      {detail?.name ? detail.name + ' · ' : ''}{picked.spot.kind === 'plaza'
        ? 'On the central plaza'
        : picked.spot.kind === 'square'
          ? `${TYPE_INFO[picked.g.t1].biome} square`
          : TYPE_INFO[picked.g.t1].biome}
    </p>
    <p class="lv">Lv {picked.g.lv}</p>
    <p class="chips">
      <span class="chip" style="background:{TYPE_INFO[picked.g.t1].colors[2]}"
        >{typeLine(picked.g)}</span
      >
      <span class="chip plain">{SHAPE_NAME[picked.g.sh]}</span><span class="chip plain"
        >Form {picked.g.f}</span
      >
      {#if picked.g.s}<span class="chip plain">✦ Shiny</span>{/if}
    </p>
    {#if detail}
      <div class="stats">
        {#each statKeys as k (k)}
          <div class="stat">
            <span>{k}</span>
            <div class="barbg"><i style="width:{detail.stats[k]}%"></i></div>
            <b>{detail.stats[k]}</b>
          </div>
        {/each}
      </div>
    {/if}
    <div class="actions"><a class="btn" href={'/' + picked.g.login}>Profile</a></div>
  </section>
{/if}

<style>
  .city {
    position: fixed;
    inset: 0;
  }
  .small {
    font-size: 13px;
  }
</style>
