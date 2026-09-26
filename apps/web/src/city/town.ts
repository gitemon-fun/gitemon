import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BIOME_ORDER,
  CANAL_IN,
  CANAL_OUT,
  PLAZA_R,
  ROAD,
  STREET_IN,
  STREET_OUT,
  SW,
  TOWN_R,
  TOWN_Y,
  hash32,
  type Island,
  type Lot,
} from '@gitemon/shared';
import { Batch, PARTS, PITCH, PROPS, ROOFS, ROUND, type RoofId } from './kit';
import { SKINS, landmark, monument, type Skin } from './buildings';
import { dress, roads, terrain, water } from './nature';

/**
 * Builds Gitemon Island (GRANDPLAN v4): the land and its dressing (nature.ts), and the centre town
 * from the v3 kit — plaza, canal, two ring streets with rows of houses between them, the gates, the
 * machine quarter, a landmark at every region's gate. Returns the static group plus the detail
 * meshes the renderer hides at far zoom.
 */

const STOREY = 3;
const DARK_GLASS = '#3d4658';
const FLOWERS = '#e8708e';
const PAVE = '#dccfb6';
const ASPHALT = '#6e6a72';
const STONE = '#d8cfbf';

const u = (seed: number, salt: number) => ((hash32(`${seed}:${salt}`) >>> 0) % 10000) / 10000;

export interface Town {
  group: THREE.Group;
  /** windows, add-ons, small props: hidden at far zoom */
  detail: THREE.Object3D[];
}

export function buildTown(isl: Island, homes: Map<number, string>, onLater?: () => void): Town {
  const group = new THREE.Group();
  const detail: THREE.Object3D[] = [];
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const add = (meshes: THREE.Object3D[], isDetail = false) => {
    if (!meshes.length) return;
    group.add(...meshes);
    if (isDetail) detail.push(...meshes);
  };

  add([terrain(isl), water(isl), roads(isl)]);
  add(townGround(isl));

  const main = new Batch();
  const facade = new Batch();
  const lights = new Batch();
  const props = new Batch();
  buildings(isl, homes, main, facade, lights);
  townFurniture(isl, props, lights, main);
  add(main.meshes(lit, { cast: true, receive: true }));
  add(facade.meshes(lit, { receive: true }), true);
  add(lights.meshes(glow), true);
  add(props.meshes(lit, { cast: true, receive: true }), true);

  // props come one frame later: the town, land and crowd show first (G1), trees follow
  const later = () => {
    const nat = dress(isl, lit, glow);
    add(nat.props);
    add(nat.glow);
    onLater?.();
  };
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() => setTimeout(later, 0));
  else later();

  for (const l of isl.landmarks) {
    const m = new THREE.Mesh(landmark(l.t), lit);
    m.position.set(l.x, l.y - 0.3, l.z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  const mon = new THREE.Mesh(monument(), lit);
  mon.position.y = TOWN_Y;
  mon.castShadow = mon.receiveShadow = true;
  group.add(mon);
  return { group, detail };
}

// ---- town ground: plaza rings, ring streets, canal banks, bridges, the low wall ---------------------

function coloured(geo: THREE.BufferGeometry, colour: string) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const c = new THREE.Color(colour);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function mesh(parts: THREE.BufferGeometry[], cast = false) {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = true;
  m.castShadow = cast;
  return m;
}
const ring = (r0: number, r1: number, y: number, colour: string, seg = 96) =>
  coloured(new THREE.RingGeometry(r0, r1, seg).rotateX(-Math.PI / 2).translate(0, y, 0), colour);

function townGround(isl: Island): THREE.Object3D[] {
  const Y = TOWN_Y;
  const flat = [
    coloured(
      new THREE.CircleGeometry(PLAZA_R + 2, 64).rotateX(-Math.PI / 2).translate(0, Y + 0.03, 0),
      '#ece4d4',
    ),
    ring(PLAZA_R + 2, CANAL_IN, Y + 0.03, STONE),
  ];
  for (let r = 8; r < PLAZA_R; r += 6) flat.push(ring(r, r + 1.2, Y + 0.05, '#d6ccb8', 64));
  for (const r of [STREET_IN, STREET_OUT]) {
    flat.push(ring(r - ROAD / 2 - SW, r + ROAD / 2 + SW, Y + 0.04, PAVE));
    flat.push(ring(r - ROAD / 2, r + ROAD / 2, Y + 0.07, ASPHALT));
  }
  // gate streets: from the outer ring street to the town edge, one per region
  for (const g of isl.regions) {
    const len = TOWN_R + 2 - STREET_OUT;
    const r = (TOWN_R + 2 + STREET_OUT) / 2;
    flat.push(
      coloured(
        new THREE.PlaneGeometry(len, ROAD)
          .rotateX(-Math.PI / 2)
          .rotateY(-g.mid)
          .translate(Math.cos(g.mid) * r, Y + 0.07, Math.sin(g.mid) * r),
        '#cdb28a',
      ),
    );
  }
  const stone: THREE.BufferGeometry[] = [
    coloured(
      new THREE.CylinderGeometry(CANAL_IN, CANAL_IN, 1.2, 96, 1, true).translate(0, Y - 0.5, 0),
      '#c8bda8',
    ),
    coloured(
      new THREE.CylinderGeometry(CANAL_OUT, CANAL_OUT, 1.2, 96, 1, true).translate(0, Y - 0.5, 0),
      '#c8bda8',
    ),
  ];
  // arched bridges: over the canal at every gate, and over each river on both ring streets
  const bridge = (x: number, z: number, a: number, span: number, w: number) => {
    for (const p of [
      new THREE.BoxGeometry(span, 0.45, w).translate(0, Y + 0.25, 0),
      new THREE.BoxGeometry(span * 0.5, 0.4, w).translate(0, Y + 0.6, 0),
      new THREE.BoxGeometry(span, 0.8, 0.35).translate(0, Y + 0.85, w / 2),
      new THREE.BoxGeometry(span, 0.8, 0.35).translate(0, Y + 0.85, -w / 2),
    ])
      stone.push(coloured(p.rotateY(-a).translate(x, 0, z), STONE));
  };
  for (const g of isl.regions) {
    const r = (CANAL_IN + CANAL_OUT) / 2;
    bridge(Math.cos(g.mid) * r, Math.sin(g.mid) * r, g.mid, CANAL_OUT - CANAL_IN + 3, 4.2);
  }
  for (const b of isl.bridges) bridge(b.x, b.z, b.a + Math.PI / 2, 7.5, ROAD + 1);
  // a low stone wall round the town, open at the gates and the rivers
  const open = [...isl.regions.map((g) => g.mid), ...isl.bridges.map((b) => b.a)];
  const WR = TOWN_R - 1.2;
  const segs = 180;
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    if (open.some((o) => Math.abs(((a - o + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * WR < 4.2))
      continue;
    const len = ((Math.PI * 2) / segs) * WR + 0.05;
    stone.push(
      coloured(
        new THREE.BoxGeometry(0.7, 1.1, len)
          .translate(0, Y + 0.55, 0)
          .rotateY(-a)
          .translate(Math.cos(a) * WR, 0, Math.sin(a) * WR),
        k % 9 === 0 ? '#c4b8a2' : '#d2c7b2',
      ),
    );
  }
  // v5: the Guardians' plinths beside the monument
  for (const p of isl.plinths) {
    stone.push(
      coloured(
        new THREE.CylinderGeometry(1.7, 1.9, 1.2, 10).translate(p.x, Y + 0.6, p.z),
        '#e4dccc',
      ),
    );
    stone.push(
      coloured(
        new THREE.CylinderGeometry(1.9, 1.9, 0.18, 10).translate(p.x, Y + 1.12, p.z),
        '#e0b040',
      ),
    );
  }
  // v5: one paved mini plaza per region, in the region's own stone (V5-D6)
  for (const m of isl.miniPlazas) {
    const pave = MINI_PAVE[isl.regions[m.region]!.climate];
    flat.push(
      coloured(
        new THREE.CircleGeometry(m.r + 1.2, 40)
          .rotateX(-Math.PI / 2)
          .translate(m.x, m.y + 0.04, m.z),
        '#c8bda8',
      ),
      coloured(
        new THREE.CircleGeometry(m.r, 40).rotateX(-Math.PI / 2).translate(m.x, m.y + 0.07, m.z),
        pave,
      ),
    );
    for (let rr = 7.4; rr < m.r - 1; rr += 4.8)
      flat.push(
        coloured(
          new THREE.RingGeometry(rr, rr + 0.5, 40)
            .rotateX(-Math.PI / 2)
            .translate(m.x, m.y + 0.09, m.z),
          '#a89e8c',
        ),
      );
  }
  return [mesh(flat), mesh(stone, true)];
}

const MINI_PAVE: Record<string, string> = {
  frost: '#eef3f8',
  marsh: '#bdb7cc',
  bloom: '#efe3d0',
  tide: '#f1e6cc',
  jungle: '#cfc8ae',
  volcano: '#6e666a',
  canyon: '#e4b88e',
  crystal: '#ebe6f6',
  savanna: '#e8d8ac',
};

// ---- town furniture: lamps along the ring streets, trees on the lawn inside the wall -----------------

function townFurniture(isl: Island, props: Batch, lights: Batch, main: Batch) {
  const m = new THREE.Matrix4();
  const at = (b: Batch, geo: THREE.BufferGeometry, x: number, z: number, colour: string, s = 1) => {
    m.makeScale(s, s, s).setPosition(x, TOWN_Y, z);
    b.add(geo, m, colour);
  };
  const gaps = [...isl.regions.map((g) => g.mid), ...isl.bridges.map((b) => b.a)];
  const clear = (a: number, r: number, w: number) =>
    !gaps.some((o) => Math.abs(((a - o + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * r < w);
  for (const r of [STREET_IN, STREET_OUT])
    for (const side of [-1, 1]) {
      const rr = r + side * (ROAD / 2 + 0.3);
      const n = Math.floor((Math.PI * 2 * rr) / 13);
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI * 2;
        if (!clear(a, rr, 4)) continue;
        at(props, PROPS.lampPost, Math.cos(a) * rr, Math.sin(a) * rr, '#4a4a52');
        at(lights, PROPS.lampHead, Math.cos(a) * rr, Math.sin(a) * rr, '#fff3d0');
      }
    }
  // lawn trees between the outer street and the wall
  const tr = (STREET_OUT + ROAD / 2 + SW + TOWN_R - 1.2) / 2 + 0.6;
  const n = Math.floor((Math.PI * 2 * tr) / 7);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    if (!clear(a, tr, 5)) continue;
    const q = isl.quarter;
    const inQ =
      (a - q.a0 + Math.PI * 4) % (Math.PI * 2) < (q.a1 - q.a0 + Math.PI * 4) % (Math.PI * 2);
    if (inQ) {
      at(main, PROPS.tank, Math.cos(a) * tr, Math.sin(a) * tr, '#8a929c', 1.3);
      continue;
    }
    at(props, PROPS.trunk, Math.cos(a) * tr, Math.sin(a) * tr, '#6b4a2e', 0.9);
    at(props, PROPS.crown, Math.cos(a) * tr, Math.sin(a) * tr, '#6fae50', 0.9);
  }
  // trees in the stone ring between plaza and canal
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2 + 0.05;
    if (!clear(a, PLAZA_R + 3, 4)) continue;
    const x = Math.cos(a) * (PLAZA_R + 3.2);
    const z = Math.sin(a) * (PLAZA_R + 3.2);
    at(props, PROPS.trunk, x, z, '#6b4a2e', 0.9);
    at(props, PROPS.crown, x, z, '#5fa84a', 0.9);
  }
}

// ---- buildings (the kit, v3 §4) ---------------------------------------------------------------------

function pickRoof(
  s: Skin,
  lot: Lot,
  prevRoof: RoofId | undefined,
  prevLot: Lot | undefined,
): RoofId {
  const r = u(lot.seed, 1);
  let roof: RoofId;
  if (r < s.sigP) roof = s.sig;
  else {
    const q = (r - s.sigP) / (1 - s.sigP);
    roof = s.roofSet[q < 0.5 ? 0 : q < 0.8 ? 1 : 2] ?? s.roofSet[0]!;
  }
  // G1: a neighbour with the same body must not also have the same roof
  if (
    prevRoof === roof &&
    prevLot &&
    prevLot.storeys === lot.storeys &&
    widthClass(prevLot) === widthClass(lot)
  ) {
    const set = [...s.roofSet, s.sig];
    roof = set[(set.indexOf(roof) + 1) % set.length]!;
  }
  return roof;
}
const widthClass = (l: Lot) => (l.w < 4.2 ? 0 : l.w < 5.3 ? 1 : 2);

function buildings(
  isl: Island,
  homes: Map<number, string>,
  main: Batch,
  facade: Batch,
  lights: Batch,
) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const roofs: RoofId[] = [];

  isl.lots.forEach((lot, li) => {
    const s = SKINS[BIOME_ORDER[lot.d]!];
    const owner = homes.get(li);
    const theta = Math.atan2(lot.fx, lot.fz);
    q.setFromAxisAngle(up, theta);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // a small seeded setback breaks the flat street wall (corners stay on the line)
    const back = lot.corner ? 0 : [0, 0, 0.35, 0.6][Math.floor(u(lot.seed, 2) * 4)]!;
    const cx = lot.x - lot.fx * back;
    const cz = lot.z - lot.fz * back;
    const put = (
      b: Batch,
      geo: THREE.BufferGeometry,
      lx: number,
      ly: number,
      lz: number,
      sx: number,
      sy: number,
      sz: number,
      colour: THREE.ColorRepresentation,
    ) => {
      pos.set(cx + lx * cos + lz * sin, lot.y + ly, cz - lx * sin + lz * cos);
      m.compose(pos, q, scl.set(sx, sy, sz));
      b.add(geo, m, colour);
    };

    const H = lot.storeys * STOREY;
    const w = lot.w;
    const dp = lot.depth;
    col.set(s.walls[Math.floor(u(lot.seed, 3) * s.walls.length)]!);
    col.offsetHSL(0, 0, (u(lot.seed, 4) - 0.5) * 0.12);
    const wall = col.getHex();
    put(main, PARTS.body, 0, 0, 0, w, H, dp, wall);

    // roof
    const prev = lot.prev >= 0 ? isl.lots[lot.prev] : undefined;
    const roof = pickRoof(s, lot, lot.prev >= 0 ? roofs[lot.prev] : undefined, prev);
    roofs[li] = roof;
    const roofCol = s.roofs[Math.floor(u(lot.seed, 5) * s.roofs.length)]!;
    let roofTop: number;
    if (ROUND.has(roof)) {
      // a round roof sits as a turret on a flat roof
      put(main, ROOFS.flat, 0, H, 0, w, 1.4, dp, s.trim);
      const k = Math.min(w, dp) * 0.82;
      const rh = PITCH[roof] * k;
      put(main, ROOFS[roof], 0, H + 0.15, 0, k, rh, k, roofCol);
      roofTop = H + rh;
    } else if (roof === 'flat') {
      put(main, ROOFS.flat, 0, H, 0, w, 1.6, dp, roofCol);
      roofTop = H + 0.5;
    } else {
      const rh = PITCH[roof] * Math.min(w, dp) * 1.15;
      put(main, ROOFS[roof], 0, H, 0, w * 1.06, rh, dp * 1.08, roofCol);
      roofTop = H + rh;
    }

    // facade: windows per storey, a door on the ground floor
    const n = w < 3.9 ? 1 : w < 5.4 ? 2 : 3;
    for (let i = 0; i < lot.storeys; i++) {
      const geo =
        i === 0
          ? w >= 4
            ? PARTS.win2
            : null
          : n === 1
            ? PARTS.win1
            : n === 2
              ? PARTS.win2
              : PARTS.win3;
      if (!geo) continue;
      const lamp = s.glow && u(lot.seed, 10 + i) < 0.6;
      put(
        lamp ? lights : facade,
        geo,
        0,
        i * STOREY,
        0,
        w,
        STOREY,
        dp,
        lamp ? s.glow! : DARK_GLASS,
      );
    }
    put(facade, PARTS.door, 0, 0, 0, Math.min(w, 5), STOREY, dp, owner ?? s.accent);

    // add-ons, each with the skin's odds
    const o = s.odds;
    if (u(lot.seed, 20) < o.chimney && roof !== 'flat' && !ROUND.has(roof))
      put(
        facade,
        PARTS.chimney,
        (u(lot.seed, 21) < 0.5 ? -1 : 1) * w * 0.28,
        H + (roofTop - H) * 0.3,
        -dp * 0.2,
        1,
        1,
        1,
        s.trim,
      );
    if (!lot.corner && u(lot.seed, 22) < o.awning)
      put(facade, PARTS.awning, 0, 2.55, dp / 2, w * 0.64, 1, 1, s.accent);
    if (lot.storeys >= 2 && u(lot.seed, 23) < o.balcony)
      put(facade, PARTS.balcony, 0, STOREY + 0.05, dp / 2, w * 0.46, 1, 1, s.trim);
    for (let i = 1; i < lot.storeys; i++)
      if (u(lot.seed, 30 + i) < o.flowers)
        put(facade, PARTS.flowers, 0, i * STOREY + 1.02, dp / 2, w * 0.5, 1, 1, FLOWERS);
    if ((roof === 'gable' || roof === 'mansard') && u(lot.seed, 24) < o.dormer)
      put(
        facade,
        PARTS.dormer,
        (u(lot.seed, 25) - 0.5) * w * 0.4,
        H + 0.2,
        dp * 0.12,
        1,
        1,
        1,
        roofCol,
      );

    // a claimed player's house: door and flag in the owner's colour (V3-D2)
    if (owner) {
      put(main, PARTS.pole, 0, roofTop - 0.4, 0, 1, 1, 1, '#6b6b70');
      // lighter than the district's own roofs, so the flag reads against them
      put(
        main,
        PARTS.flag,
        0,
        roofTop - 0.4,
        0,
        1,
        1,
        1,
        col.set(owner).offsetHSL(0, 0.1, 0.18).getHex(),
      );
    }
  });
}
