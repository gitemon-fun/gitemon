import type * as THREE from 'three';
/**
 * v19 build 11: the 3D files start downloading the moment the page starts, most needed first, instead of after
 * the island is built (they started at 6.9 s on a phone network). Their addresses carry the art set's content
 * version, so the Worker can let browsers keep them for a year (a new art set = new addresses).
 */

/** the content version of /models (scripts/models.sh writes it; vite.config.ts passes it in) */
export const MODELS_V: string = typeof __MODELS_V__ === 'string' ? __MODELS_V__ : '';
export const modelUrl = (key: string) => `/models/${key}.glb${MODELS_V ? `?v=${MODELS_V}` : ''}`;

/**
 * what to fetch first: the creatures you see up close, the town's heart, the legends, then the far pieces.
 * Keys not in the art set simply 404 and are skipped.
 */
const ORDER = [
  'toy-1',
  'toy-2',
  'toy-3',
  'monument',
  'origin',
  'guardian-a',
  'guardian-b',
  'gate',
  'bridge',
  'house-1',
  'house-2',
  'house-3',
  'svc-inn',
  'svc-dex-library',
  'svc-gate-office',
  'svc-legend-hall',
  'svc-notice-board',
  'svc-market',
  ...[4, 5, 6, 7, 8, 9, 10].map((r) => `legend-${r}`),
  ...[
    'town',
    'frost',
    'marsh',
    'bloom',
    'tide',
    'jungle',
    'volcano',
    'canyon',
    'crystal',
    'savanna',
  ].map((r) => `wonder-${r}`),
  ...[
    'frost',
    'marsh',
    'bloom',
    'tide',
    'jungle',
    'volcano',
    'canyon',
    'crystal',
    'savanna',
  ].flatMap((r) => [`lm-${r}`, `set-${r}`]),
  'props',
];

const bytes = new Map<string, Promise<ArrayBuffer | null>>();
let started = false;

/**
 * start every download now, at most 6 at once (Chrome fails ~50 at once), in ORDER. Every key gets its promise
 * at once, so a loader that asks before its turn waits for this download instead of starting a second one.
 */
export function prefetchModels() {
  if (started || !MODELS_V) return;
  started = true;
  const queue: { key: string; done: (b: ArrayBuffer | null) => void }[] = [];
  loadState.total = ORDER.length;
  for (const key of ORDER) {
    let done!: (b: ArrayBuffer | null) => void;
    bytes.set(key, new Promise<ArrayBuffer | null>((r) => (done = r)));
    queue.push({ key, done });
  }
  const next = (): Promise<void> => {
    const job = queue.shift();
    if (!job) return Promise.resolve();
    return fetch(modelUrl(job.key))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
      .then((b) => {
        loadState.done++;
        job.done(b);
      })
      .then(next);
  };
  for (let k = 0; k < 6; k++) void next();
}

/** v19 build 11: how many of the early downloads have finished, for the loading bar on the still picture */
export const loadState = { done: 0, total: 0 };

/** the bytes of a model if its download was started early (null = load it the usual way) */
export const prefetched = (key: string) => bytes.get(key) ?? null;

/**
 * v19 build 11: pieces fade in as they arrive instead of popping. A material fades (all copies of one model
 * together, since they arrive together); the scene's loop moves each from 0 to 1 over FADE_MS.
 */
export const FADE_MS = 450;
export const fading = new Map<THREE.Material, { t0: number; wasTransparent: boolean }>();
export function fadeIn(o: THREE.Object3D) {
  const now = performance.now();
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (fading.has(mat) || mat.userData.faded) continue;
      fading.set(mat, { t0: now, wasTransparent: mat.transparent });
      mat.transparent = true;
      mat.opacity = 0;
      mat.needsUpdate = true;
    }
  });
}
/** one frame of every fade: [still running, how many finished this frame] */
export function stepFades(now: number): [boolean, number] {
  let finished = 0;
  for (const [mat, f] of fading) {
    const k = Math.min(1, (now - f.t0) / FADE_MS);
    mat.opacity = k * k * (3 - 2 * k);
    if (k >= 1) {
      mat.opacity = 1;
      mat.transparent = f.wasTransparent;
      mat.userData.faded = true;
      mat.needsUpdate = true;
      fading.delete(mat);
      finished++;
    }
  }
  return [fading.size > 0, finished];
}
