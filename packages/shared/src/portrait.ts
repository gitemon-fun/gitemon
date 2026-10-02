import type { MapGitemon } from './types.js';

/**
 * v19 build 10: which 3D portrait shows a Gitemon in a card, a list or a page. A player (or a rank earned on
 * merit) → its type, form and gem colour; a woken top-10 legend → its own model; a sealed legend or any other
 * special → null (it keeps its pixel sprite, so a sealed one still shows nothing of who it is).
 * The files are rendered from the game's own models (.claude/tools/toys/portraits.py) and served under
 * /portraits/; `v` is their content version (empty = no art set: no portraits).
 */
export function portraitPath(
  g: Pick<MapGitemon, 't1' | 't2' | 'f' | 'special'>,
  v: string,
): string | null {
  if (!v) return null;
  const sp = g.special;
  if (sp && !sp.earned)
    return !sp.sealed && sp.rank <= 10 ? `/portraits/legend-${sp.rank}.webp?v=${v}` : null;
  const gem = g.t2 && g.t2 !== g.t1 ? g.t2 : 'none';
  return `/portraits/${g.t1}-${g.f}-${gem}.webp?v=${v}`;
}
