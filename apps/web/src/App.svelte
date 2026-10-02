<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SHAPE_NAME,
    STAT_MEANING,
    TYPE_INFO,
    evolvedFrom,
    nextForm,
    portraitPath,
    readable,
    type MapGitemon,
    type Stats,
    type TypeId,
  } from '@gitemon/shared';
  import { api, ERRORS, type Detail, type Me, type Town } from './lib/api';
  import { CityScene } from './city/scene';
  import { loadState, prefetchModels } from './city/assets';
  import { loadCity, type LoadedCity } from './city/load';
  import {
    CATCH_M,
    IDLE_MS,
    SIGHT_M,
    SIGN_TEMPLATES,
    SERVICES,
    guildOf,
    signText,
    type TownPlot,
  } from '@gitemon/shared';
  import { plotName } from './city/town';
  import { COLOUR as CLIMATE_COLOUR } from './city/minimap';
  import Sprite from './lib/Sprite.svelte';
  import Hud from './lib/Hud.svelte';
  import { sprite } from './lib/sprites';

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
  let sealed = $state(0);
  let dex = $state<(MapGitemon & { bonded: boolean })[]>([]);
  let towns = $state<Town[]>([]);
  let townName = $state('');
  let busy = $state(false);

  const statKeys = Object.keys(STAT_MEANING) as (keyof Stats)[];

  function say(msg: string) {
    toast = msg;
    setTimeout(() => (toast === msg ? (toast = null) : null), 3200);
  }

  // ---- v14: the landing (V14-D2). The welcome card and the still picture come with the page; the app
  // brings them to life: the creature row, the buttons, and the hand-over to the live island.
  const welcomeEl = () => document.getElementById('welcome');
  let welcomeOpen = $state(location.pathname === '/' && !!welcomeEl());
  /** the player touched the map before the island was shown: no drift then */
  let touched = false;
  $effect(() => {
    document.body.classList.toggle('welcoming', welcomeOpen);
    const w = welcomeEl();
    if (w) w.hidden = !welcomeOpen;
  });
  /** nine creatures, one per land: what you could hatch into (made up, not players) */
  const SHOWCASE: Pick<MapGitemon, 'id' | 't1' | 't2' | 'sh' | 'f' | 's'>[] = [
    { id: 11, t1: 'frost', t2: 'tide', sh: 'steady', f: 2, s: 0 },
    { id: 12, t1: 'bloom', t2: 'wing', sh: 'builder', f: 1, s: 0 },
    { id: 13, t1: 'forge', t2: 'iron', sh: 'maintainer', f: 3, s: 0 },
    { id: 14, t1: 'tide', t2: 'coral', sh: 'reviewer', f: 2, s: 0 },
    { id: 15, t1: 'prism', t2: 'spark', sh: 'polyglot', f: 3, s: 0 },
    { id: 16, t1: 'serpent', t2: 'moss', sh: 'steady', f: 1, s: 0 },
    { id: 17, t1: 'garnet', t2: 'quill', sh: 'builder', f: 2, s: 0 },
    { id: 18, t1: 'shade', t2: 'rune', sh: 'reviewer', f: 3, s: 0 },
    { id: 19, t1: 'wild', t2: null, sh: 'maintainer', f: 2, s: 0 },
  ];
  function wakeWelcome() {
    const w = welcomeEl();
    if (!w) return;
    w.querySelectorAll('.welcome-creatures span').forEach((el, i) => {
      const g = SHOWCASE[i];
      if (!g || el.firstChild) return;
      // v19 build 10: the 3D portrait when the art set is here; the pixel sprite otherwise
      const url = portraitPath(g, typeof __PORTRAITS_V__ === 'string' ? __PORTRAITS_V__ : '');
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.decoding = 'async';
        el.appendChild(img);
      } else {
        const src = sprite(g);
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d')!.drawImage(src, 0, 0);
        el.appendChild(c);
      }
      (el as HTMLElement).style.animationDelay = `${i * 0.2}s`;
    });
    document.getElementById('welcome-look')?.addEventListener('click', (e) => {
      e.preventDefault();
      welcomeOpen = false;
    });
  }
  /** the "Gitemon" name reopens the card on the landing (V14-Q3); elsewhere it is a link home */
  function brandClick(e: MouseEvent) {
    if (!welcomeEl() || me) return;
    e.preventDefault();
    select(null);
    if (panel) go('/');
    welcomeOpen = true;
  }
  /** V14-D5: the still picture gives way to the live island once its pieces are in (at most 8 s) */
  async function reveal(pieces: Promise<unknown>) {
    const poster = document.getElementById('poster');
    if (!poster || !scene) return;
    // v19 build 11: a loading bar on the picture, so a slow network never looks frozen
    const bar = document.createElement('div');
    bar.className = 'poster-load';
    bar.innerHTML = '<span>Loading the island…</span><i><b></b></i>';
    poster.appendChild(bar);
    const fill = bar.querySelector('b') as HTMLElement;
    const tick = setInterval(() => {
      const k = loadState.total ? loadState.done / loadState.total : 0;
      fill.style.width = `${Math.round(10 + 90 * k)}%`;
    }, 200);
    void pieces.finally(() => clearInterval(tick));
    await Promise.race([pieces, new Promise((r) => setTimeout(r, 8000))]);
    await scene.nextFrame();
    await scene.nextFrame();
    hidePoster();
    if (welcomeOpen && !touched) scene.startIntro();
  }
  function hidePoster() {
    const poster = document.getElementById('poster');
    if (!poster || poster.classList.contains('gone')) return;
    poster.classList.add('gone');
    setTimeout(() => poster.remove(), 700);
  }
  /** the first touch on the map shows the live island at once (the picture cannot be moved) */
  function firstTouch() {
    hintGone = true;
    touched = true;
    hidePoster();
  }

  function route() {
    const p = location.pathname;
    panel = p === '/dex' ? 'dex' : p === '/towns' ? 'towns' : p === '/me' ? 'me' : null;
    if (panel) welcomeOpen = false;
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
    if (g) {
      building = null;
      welcomeOpen = false;
    }
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

  // ---- v9: the town's buildings (GRANDPLAN v9) ----------------------------------------------------

  let building = $state<number | null>(null);
  let guildWeek = $state<Record<
    string,
    { members: number; active: number; legends: number }
  > | null>(null);
  const plotAt = (k: number): TownPlot | null => town?.city.town[k] ?? null;
  const plot = $derived<TownPlot | null>(building != null ? plotAt(building) : null);
  async function openBuilding(k: number) {
    picked = null;
    detail = null;
    scene?.select(null);
    building = k;
    const p = town?.city.town[k];
    if (p?.kind === 'hall' && !guildWeek) {
      try {
        const r = await api.guilds();
        guildWeek = Object.fromEntries(r.data.types.map((x) => [x.t, x]));
      } catch {
        /* the week's numbers are extra: the hall still shows its members */
      }
    }
  }
  /** a guild's joined players (its region's types), best merit first */
  function guildMembers(region: number) {
    if (!town) return [];
    return town.placed
      .map((p) => p.g)
      .filter((g) => g.st === 'c' && !g.special?.sealed && guildOf(g.t1) === region)
      .sort((a, b) => (b.m ?? 0) - (a.m ?? 0));
  }
  function guildTotals(region: number) {
    const types = town?.city.regions[region]?.types ?? [];
    const t = { members: 0, active: 0, legends: 0 };
    for (const ty of types) {
      const x = guildWeek?.[ty];
      if (x) {
        t.members += x.members;
        t.active += x.active;
        t.legends += x.legends;
      }
    }
    return t;
  }
  /** the guild's place this week, by active members (V9-D7) */
  function guildRank(region: number) {
    if (!town || !guildWeek) return null;
    const all = town.city.regions.map((_, i) => guildTotals(i).active);
    return 1 + all.filter((a) => a > all[region]!).length;
  }
  /** every Merit House sign, for the Notice Board (V9-D4) */
  function boardSigns() {
    if (!town) return [];
    const out: { g: MapGitemon; title: string; project: string | null; region: string }[] = [];
    town.city.town.forEach((p, k) => {
      const h = town!.homes.get(k);
      if (p.kind !== 'house' || !h?.sign) return;
      const [tpl, project] = h.sign.split('|');
      const text = signText(tpl ?? '', project || null);
      const g = town!.byId.get(h.id)?.g;
      const title = SIGN_TEMPLATES[tpl as keyof typeof SIGN_TEMPLATES];
      if (text && g && title)
        out.push({
          g,
          title,
          project: project || null,
          region: town!.city.regions[p.region]!.name,
        });
    });
    return out;
  }

  // ---- v6: walking (V6-D1…D6) ------------------------------------------------------------------

  let walked = $state(0); // metres walked away from home today (walking home is free)
  let walking = $state(false);
  /** v13.1: the welcome hint goes once you touch the map (on a phone it sat over the controls) */
  let hintGone = $state(false);
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
      if (!toHome && tryingId == null && len > budgetLeft()) {
        say(
          `Not enough steps today: ${Math.round(budgetLeft())} m left. Real GitHub work earns more.`,
        );
        return true;
      }
      scene!.walkTo(x, z);
      if (!toHome && tryingId == null) walked += len;
      armIdle();
      return true;
    };
    // v8: steering (keys / thumb stick) spends the same step budget as tapped walks
    // (v19 try mode spends no steps and logs nothing)
    scene.canSteer = (m) => tryingId != null || budgetLeft() >= m;
    scene.onSteer = (m) => {
      if (tryingId == null) walked += m;
      armIdle();
    };
    scene.onWalk = (x, z) => {
      if (tryingId == null) void checkLegends(x, z);
    };
    armIdle();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) scene?.snapHome();
    });
    void maybeEvolve();
  }
  /**
   * v19 build 02 (V19-D3): your Gitemon evolved since you last looked — the moment plays once, on any device
   * (the server remembers the last form you saw), then the mascot says so.
   */
  /**
   * v19 try mode (admins only): control another Gitemon — a player or a legend — in this browser only. Nothing
   * is sent to the server: no steps spent, no sightings, no blessings.
   */
  let tryingId = $state<number | null>(null);
  let tryingName = $state('');
  async function tryPicked(g: MapGitemon) {
    if (!me?.admin || !town || !scene) return;
    const i = town.placed.findIndex((p) => p.g.id === g.id);
    if (i < 0 || !(await scene.tryAs(i))) return;
    tryingId = g.id;
    tryingName = g.special
      ? (g.special.title ?? `${TIER_NAME[g.special.tier]} legend`)
      : g.login || 'this Gitemon';
    picked = null;
    detail = null;
  }
  function stopTrying() {
    scene?.stopTry();
    tryingId = null;
  }
  /** v19 build 02: the way to your next form (Me panel) */
  const nf = $derived(me ? nextForm(me.f, me.m ?? 0, me.lv) : null);
  let evolveShown = false;
  async function maybeEvolve() {
    // ?walkdemo&evolve: the moment on the stand-in walker (Form 1 → 2), to try it without an account
    const from = me
      ? evolvedFrom(me.f, me.seenForm)
      : demo && location.search.includes('evolve')
        ? 1
        : null;
    if (!from || evolveShown || !scene) return;
    evolveShown = true;
    // let the island settle and the 3D bodies arrive first
    await new Promise((r) => setTimeout(r, 2500));
    await scene.evolve(from);
    if (me) await api.seenForm();
    say(
      `Your Gitemon evolved — Form ${me?.f ?? 2}! It looks different now, and it shows on the island.`,
    );
    if (me) me = { ...me, seenForm: me.f };
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

  // ---- v7: signs (V7-D5) ----------------------------------------------------------------------
  let signTpl = $state('work');
  let signProject = $state('');
  async function saveSign() {
    busy = true;
    const r = await api.setSign(signTpl, signProject);
    busy = false;
    say(
      r.data.ok
        ? 'Sign saved. It shows on your house from the next map refresh.'
        : r.data.error === 'bad-project'
          ? 'Project names: up to 32 letters, digits, spaces and . - _ — no links.'
          : 'Could not save the sign.',
    );
  }
  async function clearSign() {
    busy = true;
    await api.clearSign();
    busy = false;
    say('Sign removed.');
  }
  async function reportSign(id: number) {
    await api.reportSign(id);
    say('Thanks — the sign is reported.');
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
      // v14.1: the HUD's soundscape plays the catch (when sound is on)
      window.dispatchEvent(new CustomEvent('gitemon:sound', { detail: 'catch' }));
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
    // v19 build 11: the 3D files start downloading now, while the island's data loads
    prefetchModels();
    wakeWelcome();
    scene = new CityScene(host, (p) => select(p ? p.g : null));
    scene.onBuilding = (k) => void openBuilding(k);
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
      sealed = loadedCity.placed.filter((p) => p.g.special?.sealed).length;
      scene!.build(loadedCity.city, loadedCity.homes);
      // ?walkdemo: a stand-in walker at the first town door, to try walking before signing in
      if (demo && !me) {
        const door = loadedCity.city.town.find((p) => p.kind === 'house')!.door;
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
      // v8: the sculpted pieces arrive after the first view (build file 05)
      const lc = loadedCity;
      const pieces = new Promise<void>((done) =>
        setTimeout(
          () => void scene?.addPieces(lc.city, lc.placed, lc.homes).finally(() => done()),
          400,
        ),
      );
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
      // v19 build 11: the picture lifts when the island's heart stands; far pieces fade in after
      void reveal(Promise.race([pieces, scene!.core]));
    })();
    return () => scene?.destroy();
  });

  const typeLine = (g: MapGitemon) =>
    g.t2 ? `${TYPE_INFO[g.t1].name} / ${TYPE_INFO[g.t2].name}` : TYPE_INFO[g.t1].name;

  // ---- v15 Island UI (GRANDPLAN v15): skins, type colours, the page-turn sound ----------------------
  /** a type chip's fill and text colour, measured (V15-D10) */
  const chip = (t: TypeId) => {
    const c = readable(TYPE_INFO[t].colors[0]);
    return `background:${c.bg};color:${c.fg}`;
  };
  /** a trading card's frame: its two type colours (one type: its two shades) */
  const cardFrame = (g: MapGitemon) =>
    `--c1:${TYPE_INFO[g.t1].colors[0]};--c2:${g.t2 ? TYPE_INFO[g.t2].colors[0] : TYPE_INFO[g.t1].colors[1]}`;
  /** the card window's ground: the colour of its land on the minimap */
  const groundOf = (t: TypeId) => {
    const climate = town?.city.regions.find((r) => r.types.includes(t))?.climate;
    return climate ? CLIMATE_COLOUR[climate] : '#a9cf7c';
  };
  /** a guild hall's banner: its region's first type colour, with text that reads */
  const bannerOf = (region: number) => {
    const t = town?.city.regions[region]?.types[0];
    const c = readable(t ? TYPE_INFO[t].colors[0] : '#5fa8d8');
    return `--banner:${c.bg};--banner-text:${c.fg}`;
  };
  const SKIN: Record<string, string> = {
    'legend-hall': 'skin-stone',
    'dex-library': 'skin-book',
    'notice-board': 'skin-board',
    'gate-office': 'skin-ticket',
    market: 'skin-market',
    inn: 'skin-inn',
  };
  const skinOf = (p: TownPlot) =>
    p.kind === 'hall'
      ? 'skin-banner'
      : p.kind === 'house'
        ? 'skin-plaque'
        : SKIN[SERVICES[p.slot]!]!;
  /** each building's pixel icon (v15 build 07); a missing file simply hides */
  const iconOf = (p: TownPlot) =>
    `/ui/b-${p.kind === 'hall' ? 'guild' : p.kind === 'house' ? 'house' : SERVICES[p.slot]}.png`;
  const dropImg = (e: Event) => (e.currentTarget as HTMLElement).remove();
  // V15-D9: a soft page turn whenever a sheet or panel opens (the HUD plays it only with sound on)
  let lastOpen = '';
  $effect(() => {
    const open =
      building != null ? `b${building}` : picked ? `g${picked.id}` : panel ? `p${panel}` : '';
    if (open && open !== lastOpen)
      window.dispatchEvent(new CustomEvent('gitemon:sound', { detail: 'paper' }));
    lastOpen = open;
  });
</script>

<div
  bind:this={host}
  class="map"
  role="application"
  aria-label="Gitemon City"
  onpointerdown={firstTouch}
  onwheel={firstTouch}
></div>

<header class="bar px-frame">
  <a class="brand" href="/" title="Gitemon home" onclick={brandClick}
    ><img class="brand-mark" src="/favicon.png" alt="" /><span class="brand-name">Gitemon</span></a
  >
  <form class="search" onsubmit={search} role="search">
    <input
      class="field"
      bind:value={query}
      placeholder="Find a user"
      aria-label="GitHub username"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button disabled={searching} aria-label="Find" class="findbtn sky"
      >{#if !searching}<img class="ico" src="/ui/find.png" alt="" onerror={dropImg} />{/if}<span
        class="label">{searching ? '…' : 'Find'}</span
      ></button
    >
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
      <button class:on={panel === 'towns'} onclick={() => go(panel === 'towns' ? '/map' : '/towns')}
        >Towns</button
      >
      <a class="btn primary" href="/auth/login?next=/map">Sign in</a>
    {/if}
  </nav>
</header>

{#if loaded && scene && town}
  <Hud
    {scene}
    isl={town.city}
    placed={town.placed}
    {walking}
    home={() => scene?.flyTo(0, 0, homeZoom())}
  />
{/if}

{#if tryingId != null}
  <!-- v19 try mode banner (admins only) -->
  <div class="trying px-frame">
    <span>Trying <b>{tryingName}</b> — only you see this.</span>
    <button class="gold" onclick={stopTrying}>Stop</button>
  </div>
{/if}

{#if failed}
  <div class="hint px-frame dialogue">
    <img src="/favicon.png" alt="" /><span>The island could not load. Try again in a minute.</span>
  </div>
{:else if !loaded}
  <div class="hint px-frame dialogue">
    <img src="/favicon.png" alt="" /><span>Building the island…</span>
  </div>
{:else if !picked && !panel && building == null && !hintGone}
  <div class="hint px-frame dialogue" class:raised={walking}>
    <img src="/favicon.png" alt="" /><span
      >{sealed.toLocaleString('en-US')} sealed legends sleep on the island. The stronger a Gitemon, the
      nearer the town it lives.{me ? '' : ' Sign in with GitHub to hatch yours.'} Tap anyone.</span
    >
  </div>
{/if}

{#if plot && town && building != null}
  {@const name = plotName(town.city, plot)}
  <section class="sheet px-frame pop {skinOf(plot)}" aria-label={name}>
    <button class="close" onclick={() => (building = null)} aria-label="Close">×</button>
    {#if plot.kind === 'hall'}
      {@const members = guildMembers(plot.region)}
      {@const tot = guildTotals(plot.region)}
      {@const rank = guildRank(plot.region)}
      {@const types = town.city.regions[plot.region]!.types}
      <div class="banner" style={bannerOf(plot.region)}>
        <div class="skin-head">
          <img class="icon" src={iconOf(plot)} alt="" onerror={dropImg} />
          <h2>{name}</h2>
        </div>
        {#each types as t (t)}<span class="chip" style={chip(t)}>{TYPE_INFO[t].name}</span>{/each}
      </div>
      <p class="dim">
        Every {types.map((t) => TYPE_INFO[t].name).join(' and ')} Gitemon belongs here.
      </p>
      <div class="tiles">
        <div class="tile"><b>{members.length}</b><span>members on the map</span></div>
        <div class="tile"><b>{guildWeek ? tot.active : '–'}</b><span>active this week</span></div>
        <div class="tile">
          <b>{rank ? `#${rank}` : '–'}</b><span>of 9 guilds</span>
        </div>
      </div>
      {#if guildWeek}<p class="small">
          <b>{tot.legends}</b> legends logged by members this week.
        </p>{/if}
      <p class="dim small">
        Guilds compete on how many members walk or log a legend each week — not on raw volume.
      </p>
      {#if members.length}
        <ol class="guild-top">
          {#each members.slice(0, 10) as g (g.id)}
            <li>
              <button class="bare linkish" onclick={() => ((building = null), show(g, 3))}
                ><Sprite {g} size={28} /> {g.login}</button
              >
              <span class="dim">merit {(g.m ?? 0).toFixed(0)}</span>
            </li>
          {/each}
        </ol>
      {:else if !me}
        <a class="btn primary btn-big" style="width:100%" href="/auth/login?next=/map"
          >Sign in with GitHub to join</a
        >
      {:else}
        <p class="dim">No members on the map yet.</p>
      {/if}
    {:else}
      {#if plot.kind === 'service' && SERVICES[plot.slot] === 'market'}<div
          class="awning"
        ></div>{/if}
      <div class="skin-head">
        <img class="icon" src={iconOf(plot)} alt="" onerror={dropImg} />
        <h2>{name}</h2>
      </div>
      {#if plot.kind === 'house'}
        {@const h = town.homes.get(building)}
        {@const g = h ? town.byId.get(h.id)?.g : undefined}
        {#if g}
          <div class="plaque">
            <Sprite {g} size={56} />
            <p>
              The home of <b>{g.login}</b>, one of the top 3 in {town.city.regions[plot.region]!
                .name}
              by merit.
            </p>
          </div>
          <button class="primary" onclick={() => ((building = null), show(g, 3))}
            >See their Gitemon</button
          >
        {:else}
          <div class="plaque">
            <p>
              <b>Empty for now.</b> It goes to one of the top 3 players by merit in {town.city
                .regions[plot.region]!.name} — consistent GitHub work: active days, merged pull requests,
              reviews. You keep it while you stay in the top 5.
            </p>
          </div>
        {/if}
      {:else}
        {@const svc = SERVICES[plot.slot]}
        {#if svc === 'legend-hall'}
          <div class="menu">
            <p>
              The island's 500 sealed legends. Walk near one to log it; stand near the legend of the
              day to be blessed for 6 hours.
            </p>
            {#if me}<p><b>Your Legend Log:</b> {me.walk.seen.length} of 500 seen.</p>{:else}<p
                class="dim"
              >
                Sign in to keep a Legend Log.
              </p>{/if}
          </div>
        {:else if svc === 'dex-library'}
          <p>Every Gitemon you catch goes into your Dex.</p>
          {#if me}<button class="primary" onclick={() => ((building = null), go('/dex'))}
              >Open your Dex</button
            >{:else}<p class="dim">Sign in to start a Dex.</p>{/if}
        {:else if svc === 'notice-board'}
          {@const signs = boardSigns()}
          {@const blanks = signs.length === 0 ? 3 : signs.length < 27 ? 1 : 0}
          <p>
            Signs from the Merit Houses — what the island's best are working on, and who is hiring.
          </p>
          <ul class="notes board-notes">
            {#each signs as sg (sg.g.id)}
              <li class="note">
                <b>{sg.title}</b>{#if sg.project}{sg.project}{/if}
                <span class="who"><Sprite g={sg.g} size={20} /> {sg.g.login} · {sg.region}</span>
              </li>
            {/each}
            {#each Array.from({ length: blanks }) as _, i (i)}
              <li class="note blank">
                <b>Empty spot</b>Earn a Merit House to pin a sign here.
              </li>
            {/each}
          </ul>
        {:else if svc === 'gate-office'}
          {#if me}
            <p>
              <b>Steps today:</b>
              {Math.round(Math.max(0, me.walk.budget - walked))} of {me.walk.budget} m left{#if me.walk.streak}
                · <b>Streak:</b> {me.walk.streak} {me.walk.streak === 1 ? 'day' : 'days'}{/if}
            </p>
          {/if}
          <p class="dim">
            Real GitHub work — merged pull requests, reviews, active weeks — earns more steps.
            Walking home is free.
          </p>
        {:else if svc === 'market'}
          <span class="tag">Closed</span>
          <div class="menu" style="margin-top:12px">
            <p>
              Cosmetic skins for your Gitemon will be sold here later — looks only, never power.
            </p>
          </div>
        {:else}
          <div class="menu">
            <p>
              Welcome to Gitemon Island. Sign in with GitHub and your Gitemon hatches. Tap the map
              to walk, or steer with WASD, the arrow keys or the stick. Find the sealed legends;
              catch other developers.
            </p>
          </div>
          {#if !me}<a
              class="btn primary btn-big"
              href="/auth/login?next=/map"
              style="margin-top:12px">Sign in with GitHub</a
            >{/if}
        {/if}
      {/if}
    {/if}
  </section>
{:else if picked?.special?.sealed}
  <section class="sheet px-frame pop skin-tablet" aria-label="A sealed legend">
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
    {#if me?.admin && walking && picked.id !== tryingId}
      <div class="actions">
        <!-- v19 try mode: only for admins, only in this browser -->
        <button class="sky" onclick={() => tryPicked(picked!)}>Try this legend</button>
      </div>
    {/if}
  </section>
{:else if picked}
  <section
    class="sheet px-frame pop skin-card"
    style={cardFrame(picked)}
    aria-label="Selected Gitemon"
  >
    <button
      class="close"
      onclick={() => {
        picked = null;
        detail = null;
        scene?.select(null);
      }}
      aria-label="Close">×</button
    >
    <div class="card-face">
      <div class="card-name">
        <h2>{picked.login}</h2>
        <span class="lv"
          >Lv {picked.lv}{#if detail?.bonus}<span class="bonus"> +{detail.bonus}</span>{/if}</span
        >
      </div>
      <p class="dim small">
        {detail?.name ? detail.name + ' · ' : ''}{picked.st === 'c' ? 'Claimed' : 'Wild'}{picked.s
          ? ' · ✦ Shiny'
          : ''}{#if picked.special}
          · {picked.special.earned
            ? `Earned ${TIER_NAME[picked.special.tier]} rank · earned on merit, not a legend`
            : `${picked.special.title ?? `${TIER_NAME[picked.special.tier]} legend`} · awake`}{/if}
      </p>
      <div class="card-window" style="--ground:{groundOf(picked.t1)}">
        <Sprite g={picked} size={104} />
      </div>
      <div class="chips">
        <span class="chip" style={chip(picked.t1)}>{TYPE_INFO[picked.t1].name}</span>
        {#if picked.t2}<span class="chip" style={chip(picked.t2)}>{TYPE_INFO[picked.t2].name}</span
          >{/if}
        <span class="chip">{SHAPE_NAME[picked.sh]}</span>
        <span class="form-text">Form {picked.f} of 3</span>
      </div>
      {#if detail?.sign}<p class="signline">
          <b>{signText(detail.sign.template, detail.sign.project)}</b>{#if detail.website}
            · <a href={detail.website} rel="nofollow noopener" target="_blank">website</a>{/if}
          {#if me && me.id !== picked.id}<button
              class="bare link"
              onclick={() => reportSign(picked!.id)}>report</button
            >{/if}
        </p>{/if}
      {#if detail}
        <div class="stats">
          {#each statKeys as k (k)}
            <div class="stat" title={STAT_MEANING[k]}>
              <span>{k}</span>
              <div class="meter"><i style="width:{detail.stats[k]}%"></i></div>
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
          <span class="done">This is you.</span>
        {:else if detail?.caughtByMe}
          <span class="done">In your Dex{detail.caughtByMe.bonded ? ' · Bonded' : ''}</span>
        {:else if !detail?.machine}
          {#if me && walking && distanceTo(picked) > CATCH_M}
            <button class="gold" disabled
              >Walk closer to catch ({Math.round(distanceTo(picked))} m away)</button
            >
          {:else}
            <button class="gold" disabled={busy} onclick={doCatch}
              >{me
                ? `Catch${me.catchesLeft != null ? ` (${me.catchesLeft} left today)` : ''}`
                : 'Sign in to catch'}</button
            >
          {/if}
        {/if}
        <a class="btn sky" href={'/' + picked.login}>Profile</a>
        {#if me?.admin && walking && picked.id !== tryingId}
          <!-- v19 try mode: only for admins, only in this browser -->
          <button class="sky" onclick={() => tryPicked(picked!)}>Try it</button>
        {/if}
      </div>
    </div>
  </section>
{/if}

{#if panel}
  <section
    class="panel px-frame pop"
    class:skin-book={panel === 'dex'}
    class:skin-ledger={panel === 'towns'}
    aria-label={panel}
  >
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
            <button class="bare link" onclick={leave} disabled={busy}
              >Move back to the village</button
            >
          </p>
        {:else}
          <form class="found" onsubmit={found}>
            <input
              class="field"
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
        <a class="btn primary" href="/auth/login?next=/towns">Sign in to found or join a town</a>
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
            {#if me && me.town?.id !== t.id}<button
                class="primary"
                disabled={busy}
                onclick={() => join(t)}>Join</button
              >{/if}
          </li>
        {:else}
          <li class="dim">No towns yet. Be the first.</li>
        {/each}
      </ul>
    {:else if panel === 'me' && me}
      <div class="head">
        <div
          class="card-window"
          style="--ground:{groundOf(me.t1)};width:112px;height:112px;margin:0"
        >
          <Sprite g={me} size={88} />
        </div>
        <div>
          <h2>{me.login}</h2>
          <p class="lv" style="font:700 17px var(--pixel)">
            Lv {me.lv}{#if me.bonus}<span class="bonus"> +{me.bonus} friendship</span>{/if}
          </p>
          <div class="chips">
            <span class="chip" style={chip(me.t1)}>{TYPE_INFO[me.t1].name}</span>
            {#if me.t2}<span class="chip" style={chip(me.t2)}>{TYPE_INFO[me.t2].name}</span>{/if}
          </div>
          <p class="dim small">
            {SHAPE_NAME[me.sh]} · <span class="form-text">Form {me.f} of 3</span>
          </p>
          {#if nf}
            <!-- v19 build 02: the way to the next form — the nearer of the two paths (V19-D3) -->
            <div class="evo" title="Steady work (merit) or your level — whichever gets there first">
              <div class="evo-bar"><span style="width:{Math.round(nf.share * 100)}%"></span></div>
              <p class="dim small">
                To Form {nf.to}: merit {Math.round(nf.merit.have)} / {nf.merit.need} · level {nf
                  .level.have}
                / {nf.level.need}
              </p>
              <p class="dim small"><a href="/ladder">What steady work earns</a></p>
            </div>
          {/if}
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
            <button class="gold" disabled={busy} onclick={wakeLegend}>Wake it</button>
            <button disabled={busy} onclick={removeLegend}>Remove it</button>
          </div>
        </div>
      {/if}
      <div class="walkstats">
        <p>
          <img class="ico" src="/ui/log.png" alt="" onerror={dropImg} /><span class="glyph"
          ></span><b>Legend Log:</b>
          {me.walk.seen.length} of 500 seen{#each ['legendary', 'mythic', 'epic', 'rare'] as t}{#if me.walk.tally[t]}
              · {TIER_NAME[t as keyof typeof TIER_NAME]} {me.walk.tally[t]}{/if}{/each}
        </p>
        <p>
          <img class="ico" src="/ui/steps.png" alt="" onerror={dropImg} /><span class="glyph"
          ></span><b>Steps today:</b>
          {Math.round(Math.max(0, me.walk.budget - walked))} of {me.walk.budget} m left{#if me.walk.streak}
            · <img class="ico" src="/ui/streak.png" alt="" onerror={dropImg} /><span class="glyph"
            ></span><b>Streak:</b>
            {me.walk.streak}
            {me.walk.streak === 1 ? 'day' : 'days'}{/if}
        </p>
        <p class="dim small">
          Tap the map to walk, or steer with WASD, the arrow keys or the stick. Walking home is
          free. Real GitHub work — merged pull requests, reviews, active weeks — earns more steps.
        </p>
      </div>
      <div class="walkstats">
        <p>
          <b>Merit:</b>
          {(town?.byId.get(me.id)?.g.m ?? 0).toFixed(0)} / 100 — your own work, counted by active days,
          merged pull requests, reviews, stars and issues. The best take champion seats on the plazas.
        </p>
        <p><b>Sign on your house</b></p>
        <div class="actions">
          <select bind:value={signTpl} aria-label="Sign">
            {#each Object.entries(SIGN_TEMPLATES) as [k, label]}<option value={k}>{label}</option
              >{/each}
          </select>
          {#if signTpl === 'building'}<input
              class="field"
              bind:value={signProject}
              maxlength="32"
              placeholder="Project name"
              aria-label="Project name"
            />{/if}
          <button class="primary" disabled={busy} onclick={saveSign}>Save</button>
          <button disabled={busy} onclick={clearSign}>Remove</button>
        </div>
        <p class="dim small">
          The only link is the website on your GitHub profile. Signs can be reported.
        </p>
      </div>
      <p>{me.catchesLeft} catches left today.</p>
      <p class="dim">
        You have a house in {TYPE_INFO[me.t1].biome}{me.town
          ? ` and belong to ${me.town.name}`
          : ''}.
      </p>
      <div class="actions">
        <a class="btn sky" href={'/' + me.login}>Public profile</a>
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

{#if toast}<div class="toast px-frame dialogue pop" role="status">
    <img src="/favicon.png" alt="" /><span>{toast}</span>
  </div>{/if}
