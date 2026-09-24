<script lang="ts">
  import type { MapGitemon } from '@gitemon/shared';
  import { sprite } from './sprites';

  let {
    g,
    size = 48,
  }: { g: Pick<MapGitemon, 'id' | 't1' | 't2' | 'sh' | 'f' | 's' | 'login'>; size?: number } =
    $props();
  let el: HTMLCanvasElement;

  $effect(() => {
    const src = sprite(g);
    const ctx = el.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(src, 0, 0, el.width, el.height);
  });
</script>

<canvas
  bind:this={el}
  width={size * 2}
  height={size * 2}
  style="width:{size}px;height:{size}px"
  aria-hidden="true"
></canvas>

<style>
  canvas {
    image-rendering: pixelated;
    flex: none;
  }
</style>
