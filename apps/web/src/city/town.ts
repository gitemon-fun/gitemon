import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AVENUE,
  BAND,
  CANAL_IN,
  CANAL_OUT,
  PLAZA_R,
  RING0,
  ROAD,
  SW,
  hash32,
  type City,
  type Lot,
} from '@gitemon/shared';
import { Batch, PARTS, PITCH, PROPS, ROOFS, ROUND, type RoofId } from './kit';
import { SKINS, landmark, monument, type Skin } from './buildings';

/**
 * Builds the town from the layout (GRANDPLAN v3 §4–§7): rows of kit buildings, streets with
 * paving, crosswalks and lamps, courts with a tree or fountain, one landmark per district square,
 * the plaza with its canal and bridges. Returns the static group plus the detail meshes the
 * renderer hides at far zoom (LOD, v3 build file 08).
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
  /** windows, add-ons, props: hidden at far zoom */
  detail: THREE.Object3D[];
}

export function buildTown(city: City, homes: Map<number, string>): Town {
  const group = new THREE.Group();
  const detail: THREE.Object3D[] = [];
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });

  const add = (meshes: THREE.Object3D[], isDetail = false) => {
    group.add(...meshes);
    if (isDetail) detail.push(...meshes);
  };

  add(ground(city));
  add(streets(city));

  const main = new Batch(); // bodies, roofs: cast + receive
  const facade = new Batch(); // windows, doors, add-ons: detail
  const lights = new Batch(); // glowing windows, lamp heads: unlit
  const props = new Batch(); // street furniture + trees: detail
  buildings(city, homes, main, facade, lights);
  furniture(city, props, lights);

  add(main.meshes(lit, { cast: true, receive: true }));
  add(facade.meshes(lit, { receive: true }), true);
  add(lights.meshes(glow), true);
  add(props.meshes(lit, { cast: true, receive: true }), true);

  // landmarks on every district square, the monument on the plaza
  for (const d of city.districts) {
    const m = new THREE.Mesh(landmark(d.t), lit);
    m.position.set(d.square.x, 0, d.square.z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  const mon = new THREE.Mesh(monument(), lit);
  mon.castShadow = mon.receiveShadow = true;
  group.add(mon);
  return { group, detail };
}

// ---- ground: districts, squares, courts, plaza, canal ------------------------------------------------

function sector(r0: number, r1: number, a0: number, a1: number, y: number, seg = 8) {
  // RingGeometry lies in XY with theta counter-clockwise; after rotating flat, angle → -angle
  return new THREE.RingGeometry(r0, r1, seg, 1, -a1, a1 - a0)
    .rotateX(-Math.PI / 2)
    .translate(0, y, 0);
}
function coloured(geo: THREE.BufferGeometry, colour: string) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(colour);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.getAttribute('normal')) g.deleteAttribute('normal');
  return g;
}
function mesh(parts: THREE.BufferGeometry[], receive = true, cast = false) {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = receive;
  m.castShadow = cast;
  return m;
}

function ground(city: City): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [
    coloured(
      new THREE.CircleGeometry(city.radius + 60, 96).rotateX(-Math.PI / 2).translate(0, -0.2, 0),
      '#d9d2c3',
    ),
  ];
  for (const d of city.districts) {
    const s = SKINS[d.t];
    parts.push(
      coloured(sector(CANAL_OUT, RING0 + d.bands * BAND + 4, d.a0, d.a1, -0.1, 12), s.ground),
    );
    // the square: paved in the court tone, with a stone edge
    const { x, z, r } = d.square;
    parts.push(
      coloured(
        new THREE.PlaneGeometry(r * 2 + 3, r * 2 + 3).rotateX(-Math.PI / 2).translate(x, -0.02, z),
        STONE,
      ),
      coloured(
        new THREE.PlaneGeometry(r * 2 + 1.6, r * 2 + 1.6).rotateX(-Math.PI / 2).translate(x, 0, z),
        s.court,
      ),
    );
  }
  for (const c of city.courts)
    parts.push(
      coloured(sector(c.r0, c.r1, c.a0, c.a1, -0.04, 4), SKINS[city.districts[c.d]!.t].court),
    );
  // plaza: concentric paving rings (concept 08), canal and its stone banks
  parts.push(coloured(new THREE.CircleGeometry(PLAZA_R + 2, 64).rotateX(-Math.PI / 2), '#ece4d4'));
  for (let r = 8; r < PLAZA_R; r += 6)
    parts.push(
      coloured(
        new THREE.RingGeometry(r, r + 1.2, 64).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
        '#d6ccb8',
      ),
    );
  parts.push(
    coloured(
      new THREE.RingGeometry(CANAL_IN, CANAL_OUT, 96).rotateX(-Math.PI / 2).translate(0, -0.15, 0),
      '#6fb4d8',
    ),
    coloured(
      new THREE.RingGeometry(PLAZA_R + 2, CANAL_IN, 96).rotateX(-Math.PI / 2).translate(0, 0.01, 0),
      STONE,
    ),
  );
  const flatGround = mesh(parts);
  // raised stone banks along the canal
  const banks = mesh(
    [
      coloured(
        new THREE.CylinderGeometry(CANAL_IN, CANAL_IN, 0.6, 96, 1, true).translate(0, -0.1, 0),
        '#c8bda8',
      ),
      coloured(
        new THREE.CylinderGeometry(CANAL_OUT, CANAL_OUT, 0.6, 96, 1, true).translate(0, -0.1, 0),
        '#c8bda8',
      ),
    ],
    true,
  );
  return [flatGround, banks];
}

// ---- streets: sidewalks, asphalt, crosswalks, bridges -------------------------------------------------

function strip(
  pts: [number, number][],
  w: number,
  y: number,
  colour: string,
  out: THREE.BufferGeometry[],
) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i]!;
    const [x1, z1] = pts[i + 1]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.PlaneGeometry(len + w * 0.3, w)
      .rotateX(-Math.PI / 2)
      .rotateY(-Math.atan2(z1 - z0, x1 - x0))
      .translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    out.push(coloured(geo, colour));
  }
}

function streets(city: City): THREE.Object3D[] {
  const flat: THREE.BufferGeometry[] = [];
  for (const r of city.roads) strip(r.pts, r.w + SW * 2, 0.02, PAVE, flat);
  for (const r of city.roads) strip(r.pts, r.w, 0.05, ASPHALT, flat);
  const ground = mesh(flat);
  // arched stone bridges over the canal on every avenue (concept 08)
  const stone: THREE.BufferGeometry[] = [];
  const span = CANAL_OUT - CANAL_IN + 3;
  for (const d of city.districts) {
    const parts = [
      new THREE.BoxGeometry(span, 0.5, AVENUE).translate(0, 0.3, 0),
      new THREE.BoxGeometry(span * 0.5, 0.5, AVENUE).translate(0, 0.7, 0),
      new THREE.BoxGeometry(span, 0.9, 0.4).translate(0, 0.9, AVENUE / 2),
      new THREE.BoxGeometry(span, 0.9, 0.4).translate(0, 0.9, -AVENUE / 2),
    ];
    const r = (CANAL_IN + CANAL_OUT) / 2;
    for (const p of parts)
      stone.push(
        coloured(p.rotateY(-d.a0).translate(Math.cos(d.a0) * r, 0, Math.sin(d.a0) * r), STONE),
      );
  }
  return [ground, mesh(stone, true, true)];
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
  city: City,
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

  city.lots.forEach((lot, li) => {
    const s = SKINS[city.districts[lot.d]!.t];
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
      pos.set(cx + lx * cos + lz * sin, ly, cz - lx * sin + lz * cos);
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
    const prev = lot.prev >= 0 ? city.lots[lot.prev] : undefined;
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

// ---- street furniture, court trees, district props ------------------------------------------------------

function furniture(city: City, props: Batch, lights: Batch) {
  const m = new THREE.Matrix4();
  const at = (
    b: Batch,
    geo: THREE.BufferGeometry,
    x: number,
    z: number,
    colour: string,
    s = 1,
    rot = 0,
  ) => {
    m.makeRotationY(rot)
      .scale(new THREE.Vector3(s, s, s))
      .setPosition(x, 0, z);
    b.add(geo, m, colour);
  };
  const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

  city.districts.forEach((d) => {
    const s = SKINS[d.t];
    // lamps along both sides of every ring road, every ~13 m
    for (let k = 0; k <= d.bands; k++) {
      const r = RING0 + k * BAND;
      for (const side of [-1, 1]) {
        const rr = r + side * (ROAD / 2 + 0.3);
        const n = Math.max(1, Math.floor((rr * (d.a1 - d.a0)) / 13));
        for (let i = 0; i < n; i++) {
          const a = d.a0 + ((i + 0.5) / n) * (d.a1 - d.a0);
          const [x, z] = polar(rr, a);
          at(props, PROPS.lampPost, x, z, '#4a4a52');
          at(lights, PROPS[s.lamp], x, z, s.lampColor);
        }
      }
      // crosswalks where the border avenue meets the ring road
      if (k > 0) {
        for (const side of [-1, 1]) {
          const rr = r + side * (ROAD / 2 + 1.4);
          for (let j = -2; j <= 2; j++) {
            const [x, z] = polar(rr, d.a0 + (j * 0.95) / rr);
            at(props, PROPS.stripe, x, z, '#f4f0e8', 1, -d.a0 + Math.PI / 2);
          }
        }
      }
    }
    // street trees along the border avenue
    for (let r = RING0 + 6; r < RING0 + d.bands * BAND; r += 11) {
      if (Math.abs(((r - RING0) % BAND) - 0) < 4 || Math.abs(((r - RING0) % BAND) - BAND) < 4)
        continue;
      for (const side of [-1, 1]) {
        const perp = side * (AVENUE / 2 + 0.5);
        const [x0, z0] = polar(r, d.a0);
        const x = x0 - Math.sin(d.a0) * perp;
        const z = z0 + Math.cos(d.a0) * perp;
        at(props, PROPS.trunk, x, z, s.tree[0], 0.8);
        at(props, PROPS.crown, x, z, s.tree[1], 0.8);
      }
    }
    // square corners: trees
    const { x, z, r } = d.square;
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      at(props, PROPS.trunk, x + sx * (r + 0.2), z + sz * (r + 0.2), s.tree[0]);
      at(props, PROPS.crown, x + sx * (r + 0.2), z + sz * (r + 0.2), s.tree[1]);
    }
  });

  // courts: a tree or a fountain in the middle of wide courts, the district prop and a bench
  city.courts.forEach((c, i) => {
    const s = SKINS[city.districts[c.d]!.t];
    const rm = (c.r0 + c.r1) / 2;
    const am = (c.a0 + c.a1) / 2;
    const [x, z] = polar(rm, am);
    const h = hash32(`court${i}`);
    if (c.tree) {
      if (h % 3 === 0) {
        at(props, PROPS.fountain, x, z, STONE);
        at(props, PROPS.water, x, z, '#7fc4e4');
      } else if (s.prop === 'pine') at(props, PROPS.pine, x, z, s.propColor);
      else {
        at(props, PROPS.trunk, x, z, s.tree[0]);
        at(props, PROPS.crown, x, z, s.tree[1]);
      }
    }
    const width = (c.a1 - c.a0) * rm;
    if (width > 6) {
      for (const side of [-1, 1]) {
        const a = am + (side * (width / 2 - 1.2)) / rm;
        const [px, pz] = polar(rm + ((h >>> 4) % 2 ? 1 : -1) * ((c.r1 - c.r0) / 2 - 0.9), a);
        if (side < 0) at(props, PROPS[s.prop], px, pz, s.propColor, 0.9, h % 7);
        else at(props, PROPS.bench, px, pz, '#8a6a4a', 1, -am);
      }
    }
  });

  // plaza: trees in the stone ring between plaza and canal
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2 + 0.05;
    const nearAvenue = city.districts.some((d) => {
      const x = Math.abs(a - d.a0) % (Math.PI * 2);
      return Math.min(x, Math.PI * 2 - x) < 0.1;
    });
    if (nearAvenue) continue;
    const [x, z] = polar(PLAZA_R + 3.2, a);
    at(props, PROPS.trunk, x, z, '#6b4a2e', 0.9);
    at(props, PROPS.crown, x, z, '#5fa84a', 0.9);
  }
}
