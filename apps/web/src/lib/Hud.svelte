<script lang="ts">
  import { onMount } from 'svelte';
  import type { Island } from '@gitemon/shared';
  import type { CityScene, Placed } from '../city/scene';
  import { fromMap, islandPicture, toMap } from '../city/minimap';
  import { Soundscape } from '../city/sound';
  import { gridRegion } from '@gitemon/shared';

  /**
   * The game HUD (GRANDPLAN v8 §0 V8-D5, V8-D9): a minimap you can tap to fly, a compass that turns
   * with the camera, and — for a player out walking — keys (WASD / arrows) and a thumb stick.
   * v13.1: every round button sits in one rail, so none can cover another on a short screen.
   */
  let {
    scene,
    isl,
    placed,
    walking,
    home,
  }: {
    scene: CityScene;
    isl: Island;
    placed: Placed[];
    walking: boolean;
    home: () => void;
  } = $props();

  const SIZE = 150;
  let base: HTMLCanvasElement;
  let dots: HTMLCanvasElement;
  let needle = $state(0);
  /** v13 (V13-D4): the walk camera is on; the minimap then turns heading-up */
  let following = $state(false);
  let mapTurn = $state(0);
  let open = $state(true);
  /** island north points at Frost Peaks (the top of the opening view) */
  const NORTH = (-3 * Math.PI) / 4;

  // ---- sound (V8-D10): off by default; a saved "on" starts at the player's first tap (G7) ----
  const sound = new Soundscape();
  let soundOn = $state(false);
  function setSound(on: boolean) {
    soundOn = on;
    if (on) sound.enable();
    else sound.disable();
    try {
      localStorage.setItem('gitemon.sound', on ? 'on' : 'off');
    } catch {
      /* private window */
    }
  }
  let lastPos: [number, number] | null = null;

  onMount(() => {
    try {
      if (localStorage.getItem('gitemon.sound') === 'on')
        window.addEventListener('pointerdown', () => setSound(true), { once: true });
    } catch {
      /* private window: stays off */
    }
    const pic = islandPicture(isl, SIZE * 2);
    base.getContext('2d')!.drawImage(pic, 0, 0, SIZE * 2, SIZE * 2);
    try {
      open = localStorage.getItem('gitemon.map') !== 'off';
    } catch {
      /* private window: keep the default */
    }
    const legends = placed.filter((p) => p.g.special && !p.g.special.sealed);
    const t = setInterval(() => {
      const yaw = scene.heading;
      const f = [-Math.cos(yaw), -Math.sin(yaw)];
      const r = [Math.sin(yaw), -Math.cos(yaw)];
      const n = [Math.cos(NORTH), Math.sin(NORTH)];
      needle =
        (Math.atan2(n[0]! * r[0]! + n[1]! * r[1]!, n[0]! * f[0]! + n[1]! * f[1]!) * 180) / Math.PI;
      following = scene.following;
      // heading-up while following: the way the camera looks points to the top of the minimap
      mapTurn = following ? -90 - (Math.atan2(f[1]!, f[0]!) * 180) / Math.PI : 0;
      if (sound.on) {
        const v0 = scene.view;
        const reg = gridRegion(isl.grid, v0.x, v0.z);
        sound.at(reg >= 0 ? isl.regions[reg]!.climate : reg === -1 ? 'town' : 'sea');
        const p = scene.walkerPos;
        if (p && lastPos && Math.hypot(p[0] - lastPos[0], p[1] - lastPos[1]) > 0.5) sound.step();
        lastPos = p ? [p[0], p[1]] : null;
      }
      if (!open || !dots) return;
      const ctx = dots.getContext('2d')!;
      const k = 2;
      ctx.clearRect(0, 0, SIZE * k, SIZE * k);
      // woken legends: gold dots
      ctx.fillStyle = '#ffcf5a';
      for (const p of legends) {
        const [x, y] = toMap(isl, SIZE * k, p.spot.x, p.spot.z);
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      // where the camera looks, and which way
      const v = scene.view;
      const [cx, cy] = toMap(isl, SIZE * k, v.x, v.z);
      const s = Math.max(6, (v.span / (2 * (isl.radius + 20))) * SIZE * k * 0.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, s, Math.atan2(f[1]!, f[0]!) - 0.5, Math.atan2(f[1]!, f[0]!) + 0.5);
      ctx.closePath();
      ctx.stroke();
      // you
      const me = scene.walkerPos;
      if (me) {
        const [x, y] = toMap(isl, SIZE * k, me[0], me[1]);
        ctx.fillStyle = '#ff4d6d';
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }, 200);
    return () => (clearInterval(t), sound.disable());
  });

  function flyFromMap(e: MouseEvent) {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // undo the heading-up turn: the click is measured round the centre, turned back
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const t = (-mapTurn * Math.PI) / 180;
    const ux = e.clientX - cx;
    const uy = e.clientY - cy;
    const [x, z] = fromMap(
      isl,
      SIZE,
      SIZE / 2 + ux * Math.cos(t) - uy * Math.sin(t),
      SIZE / 2 + ux * Math.sin(t) + uy * Math.cos(t),
    );
    scene.flyTo(x, z, Math.max(1.2, scene.zoom));
  }
  function toggle() {
    open = !open;
    try {
      localStorage.setItem('gitemon.map', open ? 'on' : 'off');
    } catch {
      /* private window */
    }
  }

  // ---- steering: keys + thumb stick ----
  const keys = new Set<string>();
  const KEYMAP: Record<string, [number, number]> = {
    w: [0, 1],
    arrowup: [0, 1],
    s: [0, -1],
    arrowdown: [0, -1],
    a: [-1, 0],
    arrowleft: [-1, 0],
    d: [1, 0],
    arrowright: [1, 0],
  };
  function fromKeys() {
    let x = 0;
    let y = 0;
    for (const k of keys) {
      const v = KEYMAP[k];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    // v13 (V13-D3): walking, the keys steer your Gitemon; otherwise they move the map
    if (walking) scene.steer(x, y);
    else scene.pan(Math.sign(x), Math.sign(y));
  }
  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }
  function down(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    // v12: Q / E turn the camera; v13: R / F tilt it, + / − zoom
    if (k === 'q' || k === 'e') {
      if (!e.repeat) scene.spin(k === 'q' ? -1 : 1);
      return;
    }
    if (k === 'r' || k === 'f') {
      if (!e.repeat) scene.tiltKey(k === 'r' ? -1 : 1);
      return;
    }
    if (k === '+' || k === '=' || k === '-' || k === '_') {
      scene.zoomBy(k === '-' || k === '_' ? 1 / 1.25 : 1.25);
      return;
    }
    if (!KEYMAP[k]) return;
    e.preventDefault();
    keys.add(k);
    fromKeys();
  }
  function up(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'e') return scene.spin(0);
    if (k === 'r' || k === 'f') return scene.tiltKey(0);
    if (!keys.delete(k)) return;
    fromKeys();
  }

  let knob = $state({ x: 0, y: 0 });
  let stickId: number | null = null;
  let stickEl = $state<HTMLElement>();
  const R = 44;
  function stickMove(e: PointerEvent) {
    if (e.pointerId !== stickId) return;
    const b = stickEl!.getBoundingClientRect();
    let x = e.clientX - (b.left + b.width / 2);
    let y = e.clientY - (b.top + b.height / 2);
    const l = Math.hypot(x, y);
    if (l > R) {
      x = (x / l) * R;
      y = (y / l) * R;
    }
    knob = { x, y };
    scene.steer(x / R, -y / R);
  }
  function stickDown(e: PointerEvent) {
    stickId = e.pointerId;
    stickEl!.setPointerCapture(e.pointerId);
    stickMove(e);
  }
  function stickUp(e: PointerEvent) {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob = { x: 0, y: 0 };
    scene.steer(0, 0);
  }
</script>

<svelte:window
  onkeydown={down}
  onkeyup={up}
  onblur={() => (keys.clear(), scene.steer(0, 0), scene.spin(0), scene.pan(0, 0), scene.tiltKey(0))}
/>

<div class="rail">
  <div class="rail-group">
    {#if walking}
      <button
        class="hud-btn hud-follow"
        class:on={following}
        onclick={() => scene.setFollow(!following)}
        aria-label={following ? 'Free camera' : 'Follow my Gitemon'}
        title={following ? 'Free camera' : 'Follow my Gitemon'}>{following ? '⤢' : '◎'}</button
      >
    {/if}
    <button
      class="hud-btn hud-sound"
      onclick={() => setSound(!soundOn)}
      aria-label={soundOn ? 'Sound off' : 'Sound on'}
      title={soundOn ? 'Sound off' : 'Sound on'}
    >
      <img
        src={soundOn ? '/ui/sound-on.png' : '/ui/sound-off.png'}
        alt=""
        onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
      /><span class="glyph">{soundOn ? '♪' : '×'}</span>
    </button>
    <div class="hud-btn hud-compass" title="Compass: the needle points to Frost Peaks">
      <img
        src="/ui/compass.png"
        alt=""
        style="transform: rotate({needle}deg)"
        onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
      />
    </div>
  </div>
  <div class="rail-group" aria-label="Zoom">
    <button class="hud-btn" onclick={() => scene.zoomBy(1.6)} aria-label="Zoom in">+</button>
    <button class="hud-btn" onclick={() => scene.zoomBy(1 / 1.6)} aria-label="Zoom out">−</button>
    <button class="hud-btn" onclick={() => scene.rotate(1)} aria-label="Turn the city">⟳</button>
    <button class="hud-btn hud-home" onclick={home} aria-label="Back to the town"
      ><img
        class="ico"
        src="/ui/home.png"
        alt=""
        onerror={(e) => (e.currentTarget as HTMLElement).remove()}
      /><span class="glyph">⌂</span></button
    >
  </div>
</div>

<div class="hud-map" class:closed={!open}>
  <button
    class="hud-map-toggle"
    onclick={toggle}
    aria-label={open ? 'Hide the map' : 'Show the map'}
  >
    <img
      src="/ui/map.png"
      alt=""
      onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
    />
  </button>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="hud-map-body"
    onclick={flyFromMap}
    style="width:{SIZE}px;height:{SIZE}px;transform:rotate({mapTurn}deg);transition:transform 0.3s"
  >
    <canvas bind:this={base} width={SIZE * 2} height={SIZE * 2}></canvas>
    <canvas bind:this={dots} width={SIZE * 2} height={SIZE * 2}></canvas>
  </div>
</div>

{#if walking}
  <div
    class="hud-stick"
    bind:this={stickEl}
    onpointerdown={stickDown}
    onpointermove={stickMove}
    onpointerup={stickUp}
    onpointercancel={stickUp}
    role="slider"
    aria-label="Walk: drag to steer"
    aria-valuenow={0}
    tabindex="-1"
  >
    <div class="hud-knob" style="transform: translate({knob.x}px, {knob.y}px)"></div>
  </div>
{/if}
