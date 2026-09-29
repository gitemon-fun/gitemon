# Gitemon

Every GitHub developer, hatched into a pixel creature on one shared island — **[gitemon.fun](https://gitemon.fun)**.
The site opens on the island itself: look around first, or sign in with GitHub to hatch yours.

- **Hatch.** Sign in with GitHub and your Gitemon hatches from your public profile. Nobody else can hatch you. No two look the same: your main language picks the creature, your second language colours its markings, and each one moves in its own way (it hops, waddles, trots, slithers or floats).
- **Walk.** Tap the map, or steer with WASD, the arrow keys or a thumb stick. Real GitHub work earns more steps each day.
- **Look around.** Two separate views. The **map view** works like a city builder: drag to pan (it glides when you let go), the wheel zooms toward the pointer, right-drag or Shift + drag turns and tilts. On a phone, pinch to zoom, twist two fingers to turn, and push two fingers up or down to tilt. Keys: WASD or the arrows pan, Q / E turn, R / F tilt, + / − zoom. Double-click puts the tilt back.
- **Walk view.** Press the footsteps button or V and the camera drops in behind your Gitemon, like a third-person game: WASD or the thumb stick walks where the camera looks, drag looks round, the wheel or a pinch brings the camera closer or further. The map button or V goes back to the map.
- **Catch.** Walk up to another player's Gitemon and catch it. Worked together for real? It's a _bonded_ catch.
- **Find the legends.** 500 sealed legends sleep on the island, nameless, until their own developer signs in and wakes or removes theirs. Every legend you pass goes into your Legend Log.
- **Belong.** Nine climate lands round a centre town. Your language decides your land and your guild hall; guilds compete each week on active members.
- **Earn a house.** The top 3 players by merit in each land live in its Merit Houses, with a sign for what they build or who they hire.

## The rules, in one paragraph

Power is not size. A Gitemon never grows because of raw volume. Only work other people confirmed
counts — pull requests merged into _their_ repos, reviews you gave, stars others gave you — and
every stat is log-scaled with a ceiling. Commits to your own repos count for nothing on their own,
so AI-generated volume changes nothing either. The whole scorer is a pure function in
[`packages/scorer`](packages/scorer/src/index.ts); read it, and send a PR if you think it's unfair.

**Status is earned, not handed out.** Standing comes from _merit_: steady work over time, not volume.
The plaza round the monument holds only the top 1 % of players, and only at merit 75 or more. A Merit
House needs merit 50, a mini-plaza seat 40, and a seat nobody has earned stays empty. Steady work also
evolves your Gitemon (Form 2 at merit 40, Form 3 at 70), and it never evolves back. The numbers live in
[`packages/shared/src/standing.ts`](packages/shared/src/standing.ts).

**Privacy:** Gitemon never requests access to private repositories and never contacts anyone. Your
private work counts only through the anonymous number GitHub itself shows on your profile, and only
if you turned that setting on.

## Layout

| Path                    | What                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `packages/shared`       | types, the island layout, walking + town rules, deterministic hashing |
| `packages/ingest`       | fetches a public GitHub snapshot (GraphQL)                            |
| `packages/scorer`       | snapshot → stats, level, type, species, form, merit (pure, tested)    |
| `packages/creature-gen` | deterministic pixel sprites + a tiny PNG encoder; CC0 placeholder art |
| `apps/api`              | Cloudflare Worker (Hono): pages, API, auth, images — D1 + R2          |
| `apps/web`              | Gitemon Island (Svelte + Three.js; pixel sprites in a 3D world)       |
| `scripts`               | trusted-fetcher jobs: seed, drain, daily layout; deploy + art copy    |

## Run it

```bash
pnpm install
pnpm check          # format, lint, typecheck, test
pnpm --filter @gitemon/web build
cd apps/api && npx wrangler dev   # needs a D1 database; see wrangler.toml
```

A fresh clone builds with the placeholder art and without the 3D models (the map falls back to
simple shapes). See [TRADEMARK.md](TRADEMARK.md) before you deploy a copy.

## Licence

Code: [AGPL-3.0](LICENSE). Name, logo, creature art, 3D models and icons: not licensed — see
[TRADEMARK.md](TRADEMARK.md).
