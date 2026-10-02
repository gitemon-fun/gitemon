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
      .then((b) => job.done(b))
      .then(next);
  };
  for (let k = 0; k < 6; k++) void next();
}

/** the bytes of a model if its download was started early (null = load it the usual way) */
export const prefetched = (key: string) => bytes.get(key) ?? null;
