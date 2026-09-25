<script lang="ts">
  import { onMount } from 'svelte';
  import {
    BIOME_ORDER,
    SHAPE_NAME,
    STAT_MEANING,
    TYPE_INFO,
    layout,
    type MapGitemon,
    type Shape,
    type Stats,
    type TypeId,
  } from '@gitemon/shared';
  import { api, type Detail } from '../lib/api';
  import { CityScene, type Placed } from './scene';

  let host: HTMLDivElement;
  let scene: CityScene | null = null;
  let picked = $state<Placed | null>(null);
  let detail = $state<Detail | null>(null);
  let status = $state('Building the city…');
  let count = $state(0);
  const statKeys = Object.keys(STAT_MEANING) as (keyof Stats)[];

  async function select(p: Placed | null) {
    picked = p;
    detail = null;
    if (!p) return;
    const r = await api.detail(p.g.id);
    if (r.status === 200 && picked?.g.id === p.g.id) detail = r.data;
  }

  /** [id, login, t1, t2, shape, form, shiny, level, claimed, aura] from /api/city */
  type Row = [
    number,
    string,
    TypeId,
    TypeId | null,
    Shape,
    1 | 2 | 3,
    number,
    number,
    number,
    number,
  ];
  const fromRow = (r: Row): MapGitemon => ({
    id: r[0],
    login: r[1],
    x: 0,
    y: 0,
    t1: r[2],
    t2: r[3],
    sh: r[4],
    f: r[5],
    s: r[6] ? 1 : 0,
    lv: r[7],
    st: r[8] ? 'c' : 'w',
    a: r[9] ? 1 : 0,
  });

  /**
   * Placement (GRANDPLAN v2 §5): the world's most notable stand on the central plaza; each
   * district's own best fill its square; claimed players live at a house door; everyone else
   * lines the streets outward by rank. Agents never stand on the plaza.
   */
  function place(all: MapGitemon[]) {
    const pops: Partial<Record<TypeId, number>> = {};
    for (const g of all) pops[g.t1] = (pops[g.t1] ?? 0) + 1;
    const plazaN = Math.max(24, Math.min(190, Math.round(all.length / 40)));
    const city = layout(pops, plazaN);
    const placed: Placed[] = [];
    let onPlaza = 0;
    const next = new Map<TypeId, number>();
    const nextDoor = new Map<TypeId, number>();
    for (const g of all) {
      if (onPlaza < plazaN && g.t1 !== 'machine' && city.plaza[onPlaza]) {
        placed.push({ g, spot: city.plaza[onPlaza++]! });
        continue;
      }
      const d = BIOME_ORDER.indexOf(g.t1);
      if (g.st === 'c') {
        const k = nextDoor.get(g.t1) ?? 0;
        const door = city.doors[d]?.[k];
        if (door) {
          nextDoor.set(g.t1, k + 1);
          placed.push({ g, spot: door });
          continue;
        }
      }
      const k = next.get(g.t1) ?? 0;
      const spot = city.spots[d]?.[k];
      if (!spot) continue;
      next.set(g.t1, k + 1);
      placed.push({ g, spot });
    }
    return { city, placed };
  }

  onMount(() => {
    scene = new CityScene(host, (p) => select(p));
    (async () => {
      const r = await fetch('/api/city');
      if (!r.ok) {
        status = 'The city could not load. Try again in a minute.';
        return;
      }
      const all = ((await r.json()) as { g: Row[] }).g.map(fromRow);
      const { city, placed } = place(all);
      scene!.build(city);
      scene!.setCreatures(placed);
      scene!.fitCity(city.radius);
      count = placed.length;
      status = '';
      const focus = new URLSearchParams(location.search).get('focus');
      const hit = focus
        ? placed.find((p) => p.g.login.toLowerCase() === focus.toLowerCase())
        : null;
      if (hit) {
        const held = scene!.hold(hit);
        scene!.flyTo(held.spot.x, held.spot.z, 3.2);
        scene!.select(held);
        select(held);
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
  <span class="dim small">{count ? `${count.toLocaleString('en')} Gitemon live here` : ''}</span>
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
          : picked.spot.kind === 'door'
            ? `Lives in ${TYPE_INFO[picked.g.t1].biome}`
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
