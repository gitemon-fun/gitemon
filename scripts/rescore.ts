/** Re-score every Gitemon from its stored snapshot after a scorer version bump. */
import { internal } from './lib.ts';

let after = 0;
let total = 0;
for (;;) {
  const r = await internal<{ done: number; last: number }>(`/internal/rescore?after=${after}`, {});
  if (!r.done) break;
  total += r.done;
  after = r.last;
  if (total % 400 < 4) process.stderr.write(`${total} `);
}
console.log(`rescored ${total}`);
