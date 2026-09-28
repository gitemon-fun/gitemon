/**
 * One pass of the trusted fetcher: hatch requested logins, then refresh the stalest Gitemon.
 * Runs every few minutes from a timer (see RUNBOOK.md). Needs GITHUB_TOKEN + GITEMON_INTERNAL_KEY.
 */
import { internal, pump } from './lib.ts';
import { daily } from './daily.ts';
import { watch } from './watch.ts';

// v11 (V11-D10): watch the site first, so an outage is reported even when the pass below fails
await watch().catch((e) => console.error('watch failed', e));

const pending = await internal<{ logins: string[] }>('/internal/pending');
if (pending.logins.length) await pump(pending.logins, () => undefined);
const stale = await internal<{ logins: string[] }>('/internal/stale?limit=40');
if (stale.logins.length) await pump(stale.logins, () => undefined);
console.log(`drain: hatched ${pending.logins.length}, refreshed ${stale.logins.length}`);
// v6: once a UTC day, freeze the layout + legend spots (a no-op the rest of the day)
await daily();
