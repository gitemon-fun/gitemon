/**
 * v11 (V11-D8): after a deploy, a page opened earlier can ask for a code chunk that no longer exists
 * ("Importing a module script failed" on Safari). The fix is one reload — never a loop.
 */
const CHUNK_FAILURE =
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk .+ failed/i;

export const isChunkFailure = (msg: string) => CHUNK_FAILURE.test(msg);

/** reload at most once a minute, so a real outage never turns into a reload loop */
export const shouldReload = (msg: string, lastReload: number | null, now: number) =>
  isChunkFailure(msg) && (lastReload === null || now - lastReload > 60_000);
