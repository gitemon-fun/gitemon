<script lang="ts">
  import { portraitPath, type MapGitemon } from '@gitemon/shared';
  import { sprite } from './sprites';

  /** v19 build 10: the portraits' content version (empty without the art set) */
  const PORTRAITS_V: string = typeof __PORTRAITS_V__ === 'string' ? __PORTRAITS_V__ : '';

  let {
    g,
    size = 48,
  }: {
    g: Pick<MapGitemon, 'id' | 't1' | 't2' | 'sh' | 'f' | 's' | 'login'> &
      Partial<Pick<MapGitemon, 'special'>>;
    size?: number;
  } = $props();
  let el: HTMLCanvasElement | undefined = $state();
  /** v19 build 10: the 3D portrait when there is one; the pixel sprite otherwise, or if it fails to load */
  let failed = $state(false);
  const src = $derived(failed ? null : portraitPath(g, PORTRAITS_V));

  $effect(() => {
    if (src || !el) return;
    const pix = sprite(g);
    const ctx = el.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(pix, 0, 0, el.width, el.height);
  });
</script>

{#if src}
  <img
    class="portrait"
    {src}
    width={size}
    height={size}
    alt=""
    decoding="async"
    onerror={() => (failed = true)}
  />
{:else}
  <canvas
    bind:this={el}
    width={size * 2}
    height={size * 2}
    style="width:{size}px;height:{size}px"
    aria-hidden="true"
  ></canvas>
{/if}

<style>
  canvas {
    image-rendering: pixelated;
    flex: none;
  }
  .portrait {
    flex: none;
    object-fit: contain;
  }
</style>
