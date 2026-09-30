import * as THREE from 'three';
import {
  PLAZA_R,
  TP_DIST,
  TP_FOV,
  TP_PITCH,
  TP_SIDE,
  clampTpDist,
  clampTpPitch,
  envLighting,
  springArm,
  TWIST_START,
  TOWN_Y,
  WATER_Y,
  approach,
  approachAngle,
  clampPitch,
  decay,
  followYaw,
  twoFingerMode,
  wrapAngle,
  bridgeLift,
  bridgesOf,
  gridHeight,
  type Bridge,
  type Island,
  type Spot,
} from '@gitemon/shared';
import { Walk, Walkable } from './walker';
import type { Home } from './load';
import { Crowd, type Placed } from './crowd';
import { buildTown, plotHeight, type Town } from './town';
import { airField } from './air';
import { recoverFromSkew, report } from '../lib/clientlog';

/**
 * Gitemon Island renderer (GRANDPLAN v2 §3, v3 §3, v8 §0 V8-D4): a perspective camera with 4 snap
 * rotations that tilts toward the ground as it zooms in, so close up the sky and the horizon show
 * (v8 build 03). The kit-built town comes from town.ts. One shadow map, rendered once when the city is built — the
 * city never moves. The crowd is one instanced draw of pixel sprites (crowd.ts). Frames are capped
 * at 30 fps, and the loop idles when nothing moves on screen or the tab is hidden.
 */

export type { Placed };

/** the view widens as the camera comes down, so the horizon enters the frame (V8-D4) */
const FOV_HIGH = 35;
const FOV_LOW = 50;
/** tilt-zoom: at zoom ≤ TILT_FROM the camera looks down at PITCH_HIGH; by TILT_TO it is at PITCH_LOW */
const TILT_FROM = 0.5;
const TILT_TO = 3.2;
const PITCH_HIGH = (58 * Math.PI) / 180;
const PITCH_LOW = (18 * Math.PI) / 180;
/** golden hour (V8-D7, V8-D11): the horizon colour is the haze colour, so the sea melts into the sky */
const HORIZON = '#f1e4cc';
/** v14.1: how strongly the sky's environment map lights the PBR pieces (tuned on the town and a wonder) */
const ENV_INTENSITY = 0.5;
const ZENITH = '#78aee0';

/** a gradient sky sphere that travels with the camera (no texture, never fogged) */
function skyDome() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(ZENITH) },
      bottom: { value: new THREE.Color(HORIZON) },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 bottom;
      varying float vY;
      void main() {
        float t = pow(clamp(vY, 0.0, 1.0), 0.55);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sky: THREE.Mesh;
  private target = new THREE.Vector3(0, 0, 0);
  private turn = 0; // 0..3 snap rotations
  private yaw = Math.PI / 4;
  zoom = 1;
  private dirty = true;
  private raf = 0;
  private crowd: Crowd | null = null;
  private clock = 0;
  private last = 0;
  private ring: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private detail: THREE.Object3D[] = [];
  private town: Town | null = null;
  private cityRef: Island | null = null;
  private bob: { obj: THREE.Object3D; y: number }[] = [];
  private air: ReturnType<typeof airField> | null = null;
  private labels = new THREE.Group();
  private detailOn = true;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: {
    d: number;
    z: number;
    /** the walk view's distance and height when the fingers landed */
    td: number;
    tp: number;
    a: number;
    yaw: number;
    my: number;
    pitch: number;
    gx: number;
    gy: number;
    gz: number;
    /** where the two fingers started, to tell a tilt from a zoom (v13.1) */
    a0: { x: number; y: number };
    b0: { x: number; y: number };
    mode: 'tilt' | 'zoom' | null;
    /** the twist at which turning began (null: not turning yet) */
    rot: number | null;
  } | null = null;
  /** v13.1: the height of the ground the finger grabbed, so a drag keeps it under the finger */
  private grabY = 0;
  /** v14 (V14-D9): the landing's slow drift round the island, until the first input */
  private intro = false;
  /** callers waiting for the next drawn frame (the landing's still picture waits for one) */
  private frameWaiters: (() => void)[] = [];
  private moved = 0;
  private anim: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    z0: number;
    z1: number;
    t0: number;
  } | null = null;

  constructor(
    private host: HTMLElement,
    private onPick: (p: Placed | null) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setClearColor(HORIZON);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.camera = new THREE.PerspectiveCamera(FOV_HIGH, 1, 1, 4000);
    // haze by distance (V8-D7): its range follows the camera (placeCamera), its colour is the horizon
    this.scene.fog = new THREE.Fog(HORIZON, 1500, 2800);
    this.sky = skyDome();
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#7f8aa0', 1.75));
    const sun = new THREE.DirectionalLight('#fff1d6', 1.9);
    sun.position.set(-160, 300, 110);
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // static city: the shadow map is drawn once after build (v3 §3, G5), never per frame
    // v11 (V11-D9): a phone gets the 2048 map — the one frame that redraws it stays cheap
    const phone =
      Math.min(screen.width, screen.height) < 700 && matchMedia('(pointer: coarse)').matches;
    const big = this.renderer.capabilities.maxTextureSize >= 4096 && !phone;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    sun.castShadow = true;
    sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.12, 6, 24),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.resize();
    this.bind();
    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }

  // ---- camera ------------------------------------------------------------------------------------

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.dirty = true;
  }

  /** world units visible vertically at the target at zoom 1 */
  private get span() {
    return 150 / this.zoom;
  }

  /** 0 over the whole island … 1 down near the ground (V8-D4 tilt-zoom) */
  private get tilt() {
    const t = Math.min(
      1,
      Math.max(0, Math.log(this.zoom / TILT_FROM) / Math.log(TILT_TO / TILT_FROM)),
    );
    return t * t * (3 - 2 * t);
  }
  /** camera elevation (radians): automatic with zoom unless the player tilted it (v13, V13-D2) */
  private get pitch() {
    return this.pitchOverride ?? PITCH_HIGH + (PITCH_LOW - PITCH_HIGH) * this.tilt;
  }
  private pitchOverride: number | null = null;

  /** the island's height grid, so the camera never dips under a hill */
  private groundGrid: Island['grid'] | null = null;

  private placeCamera() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    // ---- the map view (the city-builder camera) ----
    const fovM = FOV_HIGH + (FOV_LOW - FOV_HIGH) * this.tilt;
    const d = this.span / (2 * Math.tan(((fovM / 2) * Math.PI) / 180));
    const e = this.pitch;
    const dir = new THREE.Vector3(
      Math.cos(this.yaw) * Math.cos(e),
      Math.sin(e),
      Math.sin(this.yaw) * Math.cos(e),
    );
    // aim at the real ground (the volcano is 50 m up), then lift the camera until no hill is in the way
    if (this.groundGrid) {
      const g = gridHeight(this.groundGrid, this.target.x, this.target.z);
      // (settles at once while flying or zooming to the cursor, so the anchored point holds still)
      this.target.y +=
        (Math.max(TOWN_Y, g) - this.target.y) * (this.anim || this.anchor ? 1 : 0.25);
    }
    const pos = this.target.clone().addScaledVector(dir, d);
    if (this.groundGrid) {
      const t = this.target;
      let y = pos.y;
      for (let k = 1; k <= 10; k++) {
        const f = k / 10;
        const gh =
          gridHeight(this.groundGrid, t.x + (pos.x - t.x) * f, t.z + (pos.z - t.z) * f) + 2.5;
        y = Math.max(y, t.y + (gh - t.y) / f);
      }
      pos.y = y;
    }
    // low down, aim a little above the target so the land ahead fills the frame, not the ground at our feet
    const low = Math.min(1, Math.max(0, (PITCH_HIGH - e) / (PITCH_HIGH - PITCH_LOW)));
    const look = new THREE.Vector3(this.target.x, this.target.y + d * 0.14 * low, this.target.z);
    let fov = fovM;
    let near = Math.max(0.5, d * 0.02);
    let far = d * 4 + 1500;
    let fogNear = d * 0.9;
    let fogFar = d * 4.2 + 300;
    // ---- the walk view (v13.2, V13-D10): the camera glides between the two ----
    const k = this.modeT;
    if (k > 0 && this.walker && this.walkCity) {
      const b = k * k * (3 - 2 * k);
      const tp = this.thirdPerson();
      pos.lerp(tp.pos, b);
      look.lerp(tp.look, b);
      fov += (TP_FOV - fov) * b;
      near += (0.25 - near) * b;
      far = Math.max(far, 900);
      fogNear += (70 - fogNear) * b;
      fogFar += (440 - fogFar) * b;
    }
    this.camera.fov = fov;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = fogNear;
    fog.far = fogFar;
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.camera.far * 0.9);
  }

  /** the walk view's camera keeps out of the ground, the town's buildings and the big 3D pieces */
  private camGround(x: number, z: number): number {
    let h = this.groundY(x, z);
    const city = this.walkCity;
    if (city && Math.hypot(x, z) < 80)
      city.town.forEach((p, k) => {
        const dx = x - p.x;
        const dz = z - p.z;
        const across = dx * p.fx + dz * p.fz;
        const along = -dx * p.fz + dz * p.fx;
        if (Math.abs(along) < p.w / 2 + 0.6 && Math.abs(across) < p.d / 2 + 0.6)
          h = Math.max(h, p.y + (this.plotH[k] ?? 8));
      });
    // a solid's walking radius is its inner base (0.55 of the half-width): the camera keeps to all of it
    for (const s of this.solids)
      if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.r / 0.55 + 0.4) ** 2) h = Math.max(h, s.top);
    return h;
  }
  /** entering the walk view: the camera's way nearest the map's own that is not blocked close by */
  private clearYaw(yaw: number): number {
    const f = this.tpFocus;
    const p = this.tpPitch;
    let best = yaw;
    let bestD = -1;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
      const y = yaw + (k * Math.PI) / 6;
      const d = springArm(
        f.x,
        f.y,
        f.z,
        Math.cos(y) * Math.cos(p),
        Math.sin(p),
        Math.sin(y) * Math.cos(p),
        this.tpDist,
        (x, z) => this.camGround(x, z),
        0.6,
        0,
      );
      if (d >= this.tpDist * 0.8) return y;
      if (d > bestD) {
        bestD = d;
        best = y;
      }
    }
    return best;
  }
  /**
   * The walk view's camera: behind your Gitemon at its own distance and height, looking a little above
   * its head so the horizon shows. The spring arm brings it closer rather than into a hill.
   */
  private thirdPerson(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const f = this.tpFocus;
    const p = this.tpPitch;
    const dx = Math.cos(this.yaw) * Math.cos(p);
    const dy = Math.sin(p);
    const dz = Math.sin(this.yaw) * Math.cos(p);
    const ground = (x: number, z: number) => this.camGround(x, z);
    const dist = springArm(f.x, f.y, f.z, dx, dy, dz, this.tpDist, ground, 0.6, 1.2);
    const pos = new THREE.Vector3(f.x + dx * dist, f.y + dy * dist, f.z + dz * dist);
    // right against a wall: over the roof rather than inside the house
    pos.y = Math.max(pos.y, ground(pos.x, pos.z) + 0.6);
    const look = f.clone();
    look.y += this.walkerHeight * 0.45;
    return { pos, look };
  }

  /** the ⟳ button: a quarter turn, eased (it used to jump) */
  rotate(step: number) {
    this.turn = (this.turn + step + 4) % 4;
    this.yawTo = (this.yawTo ?? this.yaw) + (step * Math.PI) / 2;
    this.dirty = true;
  }
  /** v12: free rotation — by an angle now (drag, twist), or steadily while Q / E are held */
  rotateBy(rad: number) {
    this.yawTo = null;
    this.yaw += rad;
    this.dirty = true;
  }
  spin(dir: -1 | 0 | 1) {
    this.spinning = dir;
    if (dir) this.yawTo = null;
    this.dirty = true;
  }
  private yawTo: number | null = null;
  private spinning: -1 | 0 | 1 = 0;
  private turning: { id: number; x: number; y: number; t: number } | null = null;
  private lastMove = 0;

  /** the + / − buttons and keys: an eased zoom at the centre */
  zoomBy(f: number) {
    this.dirty = true;
    // the walk view: + / − bring the camera closer or further
    if (this.follow) {
      this.tpDist = clampTpDist(this.tpDist / f);
      return;
    }
    this.zoomGoal = Math.max(0.12, Math.min(6, (this.zoomGoal ?? this.zoom) * f));
    this.anchor = null;
  }

  // ---- v13 camera: goals, inertia, keys, the walk camera ------------------------------------------
  private zoomGoal: number | null = null;
  /** zoom to the cursor (V13-D2): this ground point (on the real terrain) stays under this screen point */
  private anchor: { px: number; py: number; x: number; y: number; z: number } | null = null;
  private panVel = { x: 0, z: 0 };
  private yawVel = 0;
  private panKeys = { x: 0, y: 0 };
  private tiltKeys = 0;
  /** v13.2 (V13-D10): the walk view is on — a third-person camera behind your Gitemon */
  private follow = false;
  private orbitAt = 0;
  private lastWalk: { x: number; z: number } | null = null;
  /** the walk view's own distance and height; the map view keeps its zoom and tilt meanwhile */
  private tpDist = TP_DIST;
  private tpPitch = TP_PITCH;
  /** where the walk view looks (your Gitemon, smoothed) */
  private tpFocus = new THREE.Vector3();
  /** 0 = map view … 1 = walk view: the camera glides between the two */
  private modeT = 0;
  private mapSaved: { zoom: number; pitch: number | null } | null = null;
  /** set by the HUD: the walk view turned on or off */
  onFollow: ((on: boolean) => void) | null = null;
  get following() {
    return this.follow;
  }
  /** the walk view's starting distance: a tall phone screen is narrow, so it starts further back */
  private get tpHome() {
    return this.host.clientWidth / Math.max(1, this.host.clientHeight) < 0.8
      ? TP_DIST * 1.35
      : TP_DIST;
  }
  private get walkerHeight() {
    return this.walker && this.crowd ? this.crowd.heightOf(this.walker.i, 1) : 2;
  }
  /**
   * v13.2 (V13-D10): two separate views. The map view is the city-builder camera and never moves on its
   * own; the walk view is a third-person camera behind your Gitemon. Only the button or V switches.
   */
  setFollow(on: boolean) {
    if (on === this.follow || (on && !this.walker)) return;
    const w = this.walker;
    this.follow = on;
    this.anim = null;
    this.zoomGoal = null;
    this.anchor = null;
    this.intro = false;
    this.panVel = { x: 0, z: 0 };
    this.yawVel = 0;
    if (on && w) {
      this.mapSaved = { zoom: this.zoom, pitch: this.pitchOverride };
      this.tpDist = this.tpHome;
      this.tpPitch = TP_PITCH;
      this.orbitAt = 0;
      this.tpFocus.set(w.x, this.groundY(w.x, w.z) + this.walkerHeight * 0.7, w.z);
      // turn (eased) to the nearest way the camera is not blocked by a house
      this.yawTo = this.clearYaw(this.yaw);
    } else if (this.mapSaved) {
      // back to the map at the zoom and tilt you left it, centred on your Gitemon
      this.zoom = this.mapSaved.zoom;
      this.pitchOverride = this.mapSaved.pitch;
      this.mapSaved = null;
      if (w) {
        this.target.x = w.x;
        this.target.z = w.z;
      }
    }
    this.onFollow?.(on);
    this.dirty = true;
  }
  /** WASD / arrows when not walking (V13-D3): screen-relative pan, x right, y up */
  pan(x: number, y: number) {
    this.panKeys = { x, y };
    if (x || y) this.anim = null;
    this.dirty = true;
  }
  /** R / F: tilt down (1) or up (-1) while held */
  tiltKey(dir: -1 | 0 | 1) {
    this.tiltKeys = dir;
    this.dirty = true;
  }
  /** double-click: back to the automatic tilt (or, walking, back behind your Gitemon) */
  resetView() {
    if (this.follow) {
      this.orbitAt = 0;
      this.tpDist = this.tpHome;
      this.tpPitch = TP_PITCH;
      const d = this.walker && this.lastTravel;
      if (d) this.yawTo = followYaw(Math.atan2(d.z, d.x), this.yaw, TP_SIDE);
    } else this.pitchOverride = null;
    this.dirty = true;
  }
  /** the way your Gitemon last walked (the walk view's double-click puts the camera behind it) */
  private lastTravel: { x: number; z: number } | null = null;
  /** v14: drift slowly round the island (the landing); any input stops it */
  startIntro() {
    this.intro = true;
    this.dirty = true;
  }
  /** resolves after the next frame is drawn */
  nextFrame(): Promise<void> {
    this.dirty = true;
    return new Promise((done) => this.frameWaiters.push(done));
  }
  private get moving() {
    return (
      this.intro ||
      this.modeT !== (this.follow ? 1 : 0) ||
      this.zoomGoal !== null ||
      Math.abs(this.panVel.x) + Math.abs(this.panVel.z) > 0.02 ||
      Math.abs(this.yawVel) > 0.002 ||
      this.panKeys.x !== 0 ||
      this.panKeys.y !== 0 ||
      this.tiltKeys !== 0
    );
  }
  private stepCamera(dt: number) {
    const held = this.pointers.size > 0 || this.turning !== null;
    // v14: about 2° a second, a full turn in three minutes
    if (this.intro) this.yaw += 0.035 * dt;
    // keys: pan relative to the screen, tilt
    if (this.panKeys.x || this.panKeys.y) {
      const v = this.span * 0.9 * dt;
      const fx = -Math.cos(this.yaw);
      const fz = -Math.sin(this.yaw);
      const rx = Math.sin(this.yaw);
      const rz = -Math.cos(this.yaw);
      this.target.x += (fx * this.panKeys.y + rx * this.panKeys.x) * v;
      this.target.z += (fz * this.panKeys.y + rz * this.panKeys.x) * v;
    }
    if (this.tiltKeys) {
      if (this.follow) this.tpPitch = clampTpPitch(this.tpPitch + this.tiltKeys * 0.9 * dt);
      else this.pitchOverride = clampPitch(this.pitch + this.tiltKeys * 0.9 * dt);
    }
    // inertia: a released drag glides and settles (G2)
    if (!held) {
      this.target.x += this.panVel.x * dt;
      this.target.z += this.panVel.z * dt;
      this.panVel.x = decay(this.panVel.x, dt, 7);
      this.panVel.z = decay(this.panVel.z, dt, 7);
      this.yaw += this.yawVel * dt;
      this.yawVel = decay(this.yawVel, dt, 7);
    }
    // eased zoom; to the cursor when there is an anchor (G1)
    if (this.zoomGoal !== null) {
      this.zoom = approach(this.zoom, this.zoomGoal, dt, 12);
      if (Math.abs(this.zoom - this.zoomGoal) < 0.0005) {
        this.zoom = this.zoomGoal;
        this.zoomGoal = null;
      }
      if (this.anchor) this.keepAnchor();
      if (this.zoomGoal === null) this.anchor = null;
    }
    // v13.2: the glide between the map view and the walk view
    const goal = this.follow ? 1 : 0;
    this.modeT = approach(this.modeT, goal, dt, 5);
    if (Math.abs(this.modeT - goal) < 0.002) this.modeT = goal;
    // the walk view follows your Gitemon closely; on a tapped walk it swings round behind it
    const w = this.walker;
    if (this.follow && w) {
      this.tpFocus.x = approach(this.tpFocus.x, w.x, dt, 12);
      this.tpFocus.z = approach(this.tpFocus.z, w.z, dt, 12);
      this.tpFocus.y = approach(
        this.tpFocus.y,
        this.groundY(w.x, w.z) + this.walkerHeight * 0.7,
        dt,
        8,
      );
      // the map view's pivot keeps up, so leaving the walk view lands over your Gitemon
      this.target.x = approach(this.target.x, w.x, dt, 6);
      this.target.z = approach(this.target.z, w.z, dt, 6);
      const last = this.lastWalk;
      if (w.walk && last && performance.now() - this.orbitAt > 2500) {
        const dx = w.x - last.x;
        const dz = w.z - last.z;
        if (Math.hypot(dx, dz) > 0.02)
          this.yaw = approachAngle(
            this.yaw,
            followYaw(Math.atan2(dz, dx), this.yaw, TP_SIDE),
            dt,
            1 / 1.2,
          );
      }
    }
    if (w) {
      const last = this.lastWalk;
      if (last && Math.hypot(w.x - last.x, w.z - last.z) > 0.02)
        this.lastTravel = { x: w.x - last.x, z: w.z - last.z };
      this.lastWalk = { x: w.x, z: w.z };
    }
  }
  /**
   * Move the pivot so the anchored ground point sits under its screen point again (G1). The camera
   * lifts itself over hills, so a pivot move does not shift the view evenly: solve it with Newton's
   * method on the measured screen error (a numeric Jacobian, a few steps). A step is only kept when it
   * lowers the error, else it is halved: near a hill the lift bends the error sharply, and full steps
   * bounced between two wrong views.
   */
  private keepAnchor() {
    const a = this.anchor!;
    const P = new THREE.Vector3();
    const err = (): [number, number] => {
      this.placeCamera();
      // the projection reads the camera's world matrix, which three.js only refreshes when it renders
      this.camera.updateMatrixWorld();
      const r = this.renderer.domElement.getBoundingClientRect();
      P.set(a.x, a.y, a.z).project(this.camera);
      return [((P.x + 1) / 2) * r.width + r.left - a.px, ((1 - P.y) / 2) * r.height + r.top - a.py];
    };
    const t = this.target;
    const h = Math.max(0.05, this.span * 0.002);
    for (let k = 0; k < 5; k++) {
      const e0 = err();
      if (Math.hypot(e0[0], e0[1]) < 0.25) return;
      t.x += h;
      const ex = err();
      t.x -= h;
      t.z += h;
      const ez = err();
      t.z -= h;
      const j11 = (ex[0] - e0[0]) / h;
      const j12 = (ez[0] - e0[0]) / h;
      const j21 = (ex[1] - e0[1]) / h;
      const j22 = (ez[1] - e0[1]) / h;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-9) return;
      let dx = (-e0[0] * j22 + e0[1] * j12) / det;
      let dz = (-e0[1] * j11 + e0[0] * j21) / det;
      const lim = this.span * 0.5;
      const l = Math.hypot(dx, dz);
      if (l > lim) {
        dx *= lim / l;
        dz *= lim / l;
      }
      const n0 = Math.hypot(e0[0], e0[1]);
      let kept = false;
      for (let s = 0; s < 8 && !kept; s++) {
        t.x += dx;
        t.z += dz;
        const e1 = err();
        if (Math.hypot(e1[0], e1[1]) < n0) kept = true;
        else {
          t.x -= dx;
          t.z -= dz;
          dx /= 2;
          dz /= 2;
        }
      }
      if (!kept) break;
    }
    this.placeCamera();
  }
  /** where the pointer's ray meets a level sheet at height y */
  private planeAt(px: number, py: number, y: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1),
      this.camera,
    );
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)
      ? hit
      : null;
  }
  /** where the pointer's ray first meets the land (or the water surface) */
  terrainAt(px: number, py: number): THREE.Vector3 | null {
    const grid = this.groundGrid;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    this.camera.updateMatrixWorld();
    ray.setFromCamera(
      new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1),
      this.camera,
    );
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const floor = (x: number, z: number) =>
      grid ? Math.max(WATER_Y, Math.hypot(x, z) < 72 ? TOWN_Y : gridHeight(grid, x, z)) : 0;
    let prev = 0;
    for (let t = 1; t < this.camera.far; t *= 1.04) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y <= floor(x, z)) {
        // bisect between the last step above and this one below
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 20; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m <= floor(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prev = t;
    }
    return null;
  }

  flyTo(x: number, z: number, zoom = 2.6) {
    this.intro = false;
    this.setFollow(false);
    this.zoomGoal = null;
    this.anchor = null;
    this.panVel = { x: 0, z: 0 };
    this.anim = {
      from: this.target.clone(),
      to: new THREE.Vector3(x, 0, z),
      z0: this.zoom,
      z1: zoom,
      t0: performance.now(),
    };
  }

  fitCity(radius: number) {
    this.target.set(0, 0, 0);
    this.zoom = 150 / (radius * 1.9);
    this.dirty = true;
  }

  // ---- input -------------------------------------------------------------------------------------

  private groundAt(px: number, py: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((px - r.left) / r.width) * 2 - 1,
      -((py - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  private bind() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', () => this.resetView());
    // v14: any input ends the landing's drift
    window.addEventListener('keydown', () => (this.intro = false));
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.anim = null;
      this.intro = false;
      // a new touch catches the glide
      this.panVel = { x: 0, z: 0 };
      this.yawVel = 0;
      // v12/v13: right-drag (or Shift + drag) turns and tilts the camera
      if (e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey)) {
        this.turning = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
        this.yawTo = null;
        return;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      this.lastMove = performance.now();
      if (this.pointers.size === 1)
        this.grabY = this.terrainAt(e.clientX, e.clientY)?.y ?? this.target.y;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const g = this.terrainAt((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.pinch = {
          d: Math.hypot(a.x - b.x, a.y - b.y),
          z: this.zoom,
          td: this.tpDist,
          tp: this.tpPitch,
          a: Math.atan2(b.y - a.y, b.x - a.x),
          yaw: this.yaw,
          my: (a.y + b.y) / 2,
          pitch: this.pitch,
          gx: g?.x ?? this.target.x,
          gy: g?.y ?? this.target.y,
          gz: g?.z ?? this.target.z,
          a0: { ...a },
          b0: { ...b },
          mode: null,
          rot: null,
        };
        this.yawTo = null;
        this.zoomGoal = null;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (this.turning && e.pointerId === this.turning.id) {
        const t = this.turning;
        const dyaw = (e.clientX - t.x) * 0.006;
        this.rotateBy(dyaw);
        // v13 (V13-D2): up and down tilts
        if (this.follow) this.tpPitch = clampTpPitch(this.tpPitch + (e.clientY - t.y) * 0.004);
        else this.pitchOverride = clampPitch(this.pitch + (e.clientY - t.y) * 0.004);
        this.yawVel = dyaw / Math.max(0.008, (now - t.t) / 1000);
        t.x = e.clientX;
        t.y = e.clientY;
        t.t = now;
        if (this.follow) this.orbitAt = now;
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2 && this.pinch) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...this.pointers.values()];
        const pc = this.pinch;
        // v13.1: decide once whether this is a tilt or a zoom, so one never leaks into the other
        pc.mode ??= twoFingerMode(pc.a0, pc.b0, a, b);
        const dy = ((a.y + b.y) / 2 - pc.my) * 0.004;
        const spread = Math.hypot(a.x - b.x, a.y - b.y) / pc.d;
        if (pc.mode === 'tilt') {
          // both fingers up or down: tilt only, like R / F
          if (this.follow) this.tpPitch = clampTpPitch(pc.tp + dy);
          else this.pitchOverride = clampPitch(pc.pitch + dy);
        } else if (pc.mode === 'zoom') {
          // the walk view: a pinch brings the camera closer to your Gitemon
          if (this.follow) this.tpDist = clampTpDist(pc.td / spread);
          else this.zoom = Math.max(0.12, Math.min(6, pc.z * spread));
          // a clear twist turns the island with the fingers (v12); a small one while pinching does not
          const twist = wrapAngle(Math.atan2(b.y - a.y, b.x - a.x) - pc.a);
          if (pc.rot === null && Math.abs(twist) > TWIST_START) pc.rot = twist;
          if (pc.rot !== null) this.yaw = pc.yaw - (twist - pc.rot);
          // the ground under the fingers stays under them, and moves with them (V13-D2)
          if (!this.follow) {
            this.anchor = {
              px: (a.x + b.x) / 2,
              py: (a.y + b.y) / 2,
              x: pc.gx,
              y: pc.gy,
              z: pc.gz,
            };
            this.keepAnchor();
            this.anchor = null;
          }
        }
        this.moved += 10;
        this.dirty = true;
        return;
      }
      // the walk view: a drag looks round your Gitemon instead of moving the map
      if (this.follow) {
        this.rotateBy((e.clientX - p.x) * 0.006);
        this.tpPitch = clampTpPitch(this.tpPitch + (e.clientY - p.y) * 0.004);
        this.moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
        this.orbitAt = now;
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      // v13.1: on the grabbed ground's own height, so on a hill the land follows the finger
      const g0 = this.planeAt(p.x, p.y, this.grabY);
      const g1 = this.planeAt(e.clientX, e.clientY, this.grabY);
      p.x = e.clientX;
      p.y = e.clientY;
      if (g0 && g1) {
        const dx = g1.x - g0.x;
        const dz = g1.z - g0.z;
        this.target.x -= dx;
        this.target.z -= dz;
        // v13: remember how fast it moved, so a release glides (inertia, G2)
        const dts = Math.max(0.008, (now - this.lastMove) / 1000);
        this.panVel = {
          x: this.panVel.x * 0.4 + (-dx / dts) * 0.6,
          z: this.panVel.z * 0.4 + (-dz / dts) * 0.6,
        };
        this.lastMove = now;
        this.moved += Math.abs(e.movementX) + Math.abs(e.movementY) + 1;
        this.dirty = true;
      }
    });
    const up = (e: PointerEvent) => {
      if (this.turning && e.pointerId === this.turning.id) {
        // a slow release does not keep turning
        if (performance.now() - this.turning.t > 80) this.yawVel = 0;
        this.turning = null;
        return;
      }
      const was = this.pointers.size;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      // one finger left after a pinch: it drags from where it is now
      if (was === 2 && this.pointers.size === 1) {
        const rest = [...this.pointers.values()][0]!;
        this.grabY = this.terrainAt(rest.x, rest.y)?.y ?? this.target.y;
        this.lastMove = performance.now();
        this.panVel = { x: 0, z: 0 };
      }
      // a drag that stopped before letting go does not glide
      if (performance.now() - this.lastMove > 80) this.panVel = { x: 0, z: 0 };
      if (was === 1 && this.moved < 6 && e.type === 'pointerup') this.pick(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.anim = null;
        this.intro = false;
        // the walk view: the wheel brings the camera closer to your Gitemon or further back
        if (this.follow) {
          this.tpDist = clampTpDist(this.tpDist * Math.exp(e.deltaY * 0.0015));
          this.dirty = true;
          return;
        }
        const goal = Math.max(
          0.12,
          Math.min(6, (this.zoomGoal ?? this.zoom) * Math.exp(-e.deltaY * 0.0018)),
        );
        // v13 (V13-D2): zoom toward the ground under the pointer
        const g = this.terrainAt(e.clientX, e.clientY);
        this.anchor = g ? { px: e.clientX, py: e.clientY, x: g.x, y: g.y, z: g.z } : null;
        this.zoomGoal = goal;
        this.dirty = true;
      },
      { passive: false },
    );
  }

  private pick(px: number, py: number) {
    const c = this.crowd;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (c) {
      // nearest resident on screen whose sprite covers the tap (sprites are upright standees)
      const v = new THREE.Vector3();
      const top = new THREE.Vector3();
      let best = -1;
      let bestD = Infinity;
      const grow = this.grow;
      for (let i = 0; i < c.size; i++) {
        c.positionOf(i, this.clock, v);
        const h = c.heightOf(i, grow) * this.upScale * 0.55;
        top.copy(v).setY(v.y + h);
        v.setY(v.y + h * 0.45).project(this.camera);
        top.project(this.camera);
        const sx = ((v.x + 1) / 2) * r.width + r.left;
        const sy = ((1 - v.y) / 2) * r.height + r.top;
        const rad = Math.max(14, Math.abs(((top.y - v.y) / 2) * r.height) * 1.3);
        const d = Math.hypot(sx - px, sy - py);
        // prefer the one nearest the camera when sprites overlap
        const score = d / rad - v.z * 0.001;
        if (d < rad && score < bestD) {
          bestD = score;
          best = i;
        }
      }
      if (best >= 0) {
        c.stop(best, this.clock);
        const p = c.at(best);
        this.select(p);
        this.onPick(p);
        return;
      }
    }
    // v9: a town building opens its panel
    const k = this.buildingAt(px, py);
    if (k >= 0 && this.onBuilding) {
      this.onBuilding(k);
      return;
    }
    // tapping the ground zooms toward it (v13.2: the real ground — the walk view looks along hills)
    const g = this.terrainAt(px, py) ?? this.groundAt(px, py);
    // v6: a signed-in player's tap on the ground walks their Gitemon there
    if (g && this.onGround?.(g.x, g.z)) return;
    if (g) this.flyTo(g.x, g.z, Math.min(4, this.zoom * 2.2));
  }

  /** v9: set by the app — a town building was tapped (index into island.town) */
  onBuilding: ((k: number) => void) | null = null;
  private plotH: number[] = [];
  /** which town building is under the tap: the tap's ray, tested at several heights of each one */
  private buildingAt(px: number, py: number): number {
    const city = this.walkCity ?? this.cityRef;
    if (!city) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1),
      this.camera,
    );
    const hit = new THREE.Vector3();
    let best = -1;
    let bestD = Infinity;
    city.town.forEach((p, k) => {
      const h = this.plotH[k] ?? 8;
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.y + h * t));
        if (!ray.ray.intersectPlane(plane, hit)) continue;
        const dx = hit.x - p.x;
        const dz = hit.z - p.z;
        const across = dx * p.fx + dz * p.fz;
        const along = -dx * p.fz + dz * p.fx;
        if (Math.abs(along) < p.w / 2 + 0.4 && Math.abs(across) < p.d / 2 + 0.4) {
          const d = hit.distanceTo(this.camera.position);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
          break;
        }
      }
    });
    return best;
  }

  /** stop a resident where it is (used for ?focus=login) and return where it stopped */
  hold(p: Placed): Placed {
    const c = this.crowd;
    if (!c) return p;
    for (let i = 0; i < c.size; i++)
      if (c.at(i) === p) {
        c.stop(i, this.clock);
        return c.at(i);
      }
    return p;
  }

  select(p: Placed | null) {
    this.ring.visible = !!p;
    if (p) this.ring.position.set(p.spot.x, p.spot.y + 0.08, p.spot.z);
    this.dirty = true;
  }

  // ---- building the city ---------------------------------------------------------------------------

  /** homes: lot index → the owner's house (claimed players, V2-D5 / V3-D2 / V7-D6) */
  build(city: Island, homes = new Map<number, Home>()) {
    const t0 = performance.now();
    const town = buildTown(city, homes, () => {
      // props arrived: they cast shadows too, so the static map is drawn once more
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
    });
    this.stats.townMs = Math.round(performance.now() - t0);
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.stats.homes = homes.size;
    this.scene.add(town.group);
    this.town = town;
    this.detail = town.detail;
    this.air = airField(city, town.grid);
    this.scene.add(this.air.points);
    this.buildLabels(city);
    this.groundGrid = city.grid;
    this.cityRef = city;
    this.plotH = city.town.map((p, k) => plotHeight(p.kind, homes.get(k)?.band ?? 0));
    const cam = this.sun.shadow.camera;
    const r = city.radius + 40;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 1200;
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
    const env = this.addEnvironment();
    // the frame check (v10 debugging) now runs only on request: ?diag (after the environment map, v14.1)
    if (location.search.includes('diag'))
      void env.finally(() =>
        setTimeout(() => {
          this.probeDue = true;
          this.dirty = true;
        }, 1500),
      );
  }

  // ---- v14.1: the sky's light on the 3D pieces ----------------------------------------------------
  /** on when the environment map is in place (the frame check reports it) */
  private envOn = false;
  private envMap: THREE.Texture | null = null;
  /** the Meshy pieces (their PBR materials take the environment map) */
  private piecesGroup: THREE.Object3D | null = null;
  /**
   * Only the PBR materials (the Meshy pieces) take the sky's light: in this three.js the scene-wide
   * environment also lights Lambert materials, which washed the terrain and the town out.
   */
  private lightPieces() {
    const env = this.envMap;
    if (!env || !this.piecesGroup) return;
    this.piecesGroup.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : [])
        if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial && !mat.userData.noEnv) {
          const std = mat as THREE.MeshStandardMaterial;
          std.envMap = env;
          std.envMapIntensity = ENV_INTENSITY;
          std.needsUpdate = true;
        }
    });
    this.dirty = true;
  }
  /**
   * A small CC0 sky (Poly Haven, 256 × 128, overcast so there is no hard sun) lights the Meshy pieces as
   * an environment map. It is never shown: the sky dome and the haze stay as they are, and the pixel
   * creatures, the terrain and the town are not touched. Off on the blank-map GPUs.
   */
  private async addEnvironment() {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    if (!envLighting(location.search, gpu)) return;
    try {
      const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
      const sky = await new HDRLoader().loadAsync('/env/sky-overcast-256.hdr');
      sky.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.envMap = pm.fromEquirectangular(sky).texture;
      pm.dispose();
      sky.dispose();
      this.envOn = true;
      this.lightPieces();
    } catch (e) {
      this.envMap = null;
      report('warn', `environment map: ${String(e)}`);
    }
  }

  // ---- frame check (debugging a blank map on some GPUs) ------------------------------------------------

  private probeDue = false;
  /** once per visit, after the island is built: did anything draw? Sent to the client log. */
  private probe() {
    this.probeDue = false;
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const pts: number[][] = [];
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.3, 0.4],
      [0.7, 0.4],
      [0.35, 0.65],
      [0.65, 0.65],
    ]) {
      gl.readPixels(Math.floor(w * fx!), Math.floor(h * fy!), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      pts.push([...px]);
    }
    // the clear colour as the canvas shows it (sRGB bytes), which is also the fog colour
    const clear = [1, 3, 5].map((i) => parseInt(HORIZON.slice(i, i + 2), 16));
    const same = pts.filter((p) => p.slice(0, 3).every((v, i) => Math.abs(v - clear[i]!) <= 4));
    const r = (v: number) => Math.round(v * 10) / 10;
    const cam = this.camera;
    const fog = this.scene.fog as THREE.Fog;
    const bad = this.renderer.info.programs
      ?.filter(
        (p) => (p as { diagnostics?: { runnable: boolean } }).diagnostics?.runnable === false,
      )
      .map((p) => p.name);
    report(
      'frame',
      JSON.stringify({
        blank: same.length === pts.length,
        env: this.envOn,
        pts,
        calls: this.renderer.info.render.calls,
        tris: this.renderer.info.render.triangles,
        programs: this.renderer.info.programs?.length,
        bad,
        lost: gl.isContextLost(),
        err: gl.getError(),
        buf: [w, h],
        css: [this.host.clientWidth, this.host.clientHeight],
        dpr: window.devicePixelRatio,
        aa: gl.getContextAttributes()?.antialias,
        cam: [cam.position.x, cam.position.y, cam.position.z].map(r),
        tgt: [this.target.x, this.target.y, this.target.z].map(r),
        zoom: r(this.zoom),
        fov: r(cam.fov),
        nf: [r(cam.near), r(cam.far)],
        fog: [r(fog.near), r(fog.far)],
        maxTex: this.renderer.capabilities.maxTextureSize,
        vtex: this.renderer.capabilities.maxVertexTextures,
      }),
    );
  }

  /** region names, shown only when zoomed out (v4 Q1) */
  private buildLabels(city: Island) {
    this.labels.clear();
    for (const g of city.regions) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const ctx = c.getContext('2d')!;
      ctx.font = '600 52px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(30,34,44,0.75)';
      ctx.strokeText(g.name, 256, 50);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(g.name, 256, 50);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
      );
      sp.scale.set(80, 15, 1);
      sp.position.set(Math.cos(g.mid) * 165, 40, Math.sin(g.mid) * 165);
      sp.renderOrder = 10;
      this.labels.add(sp);
    }
    this.labels.visible = false;
    this.scene.add(this.labels);
  }

  // ---- walking (v6 §3, V6-D1) ------------------------------------------------------------------------

  /** set by the app: return true when a ground tap was used for walking */
  onGround: ((x: number, z: number) => boolean) | null = null;
  private walkable: Walkable | null = null;
  private solids: { x: number; z: number; r: number; top: number }[] = [];
  private walker: { i: number; home: Spot; walk: Walk | null; x: number; z: number } | null = null;
  private walkCity: Island | null = null;
  /** called about twice a second while walking, with where the walker is */
  onWalk: ((x: number, z: number, arrived: boolean) => void) | null = null;
  private lastWalkPing = 0;

  // ---- steering (v8 §0 V8-D5, build file 06) --------------------------------------------------------

  /** screen-relative stick: x = right, y = up the screen; length ≤ 1 */
  private stick = { x: 0, y: 0 };
  /** set by the app: may the walker take another `m` metres? (the v6 step budget) */
  canSteer: ((m: number) => boolean) | null = null;
  /** called with the metres just steered */
  onSteer: ((m: number) => void) | null = null;
  steer(x: number, y: number) {
    const l = Math.hypot(x, y);
    this.stick = l > 1 ? { x: x / l, y: y / l } : { x, y };
    if (l > 0 && this.walker) {
      this.walker.walk = null; // steering takes over from a tapped walk
    }
    this.dirty = true;
  }
  get steering() {
    return this.stick.x !== 0 || this.stick.y !== 0;
  }
  private stepSteer(dt: number) {
    const w = this.walker;
    if (!w || !this.walkable || !this.crowd || !this.walkCity || !this.steering) return;
    // up the screen = away from the camera along the ground: in the walk view, straight ahead
    const cy = this.yaw;
    const fx = -Math.cos(cy);
    const fz = -Math.sin(cy);
    const rx = Math.sin(cy);
    const rz = -Math.cos(cy);
    const dx = fx * this.stick.y + rx * this.stick.x;
    const dz = fz * this.stick.y + rz * this.stick.x;
    const step = 7 * dt * Math.hypot(this.stick.x, this.stick.y);
    if (this.canSteer && !this.canSteer(step)) return;
    const l = Math.hypot(dx, dz) || 1;
    let nx = w.x + (dx / l) * step;
    let nz = w.z + (dz / l) * step;
    // blocked (water, cliff, house row): slide along whichever axis is open
    if (!this.walkable.walkable(nx, nz)) {
      if (this.walkable.walkable(nx, w.z)) nz = w.z;
      else if (this.walkable.walkable(w.x, nz)) nx = w.x;
      else return;
    }
    const moved = Math.hypot(nx - w.x, nz - w.z);
    w.x = nx;
    w.z = nz;
    const y = this.groundY(nx, nz);
    this.crowd.setPos(w.i, nx, nz, y);
    this.onSteer?.(moved);
    const now = performance.now();
    if (now - this.lastWalkPing > 500) {
      this.lastWalkPing = now;
      this.onWalk?.(nx, nz, false);
    }
    this.dirty = true;
  }

  /** where the walker's feet go: town ground (on a bridge: its deck, V10-D6), else the terrain */
  private bridges: Bridge[] = [];
  private groundY(x: number, z: number) {
    const city = this.walkCity!;
    if (Math.hypot(x, z) < 72) return TOWN_Y + bridgeLift(this.bridges, x, z);
    return Math.max(TOWN_Y, gridHeight(city.grid, x, z));
  }

  /** make placed resident `i` the player's own walker (home = where it lives) */
  enableWalker(city: Island, i: number) {
    const c = this.crowd;
    if (!c) return;
    this.walkCity = city;
    this.bridges = bridgesOf(city);
    if (!this.walkable) {
      this.walkable = new Walkable(city);
      this.walkable.setSolids(this.solids);
    }
    const p = c.at(i);
    this.walker = { i, home: { ...p.spot }, walk: null, x: p.spot.x, z: p.spot.z };
  }
  get walkerPos(): [number, number] | null {
    return this.walker ? [this.walker.x, this.walker.z] : null;
  }
  get walkerHome(): Spot | null {
    return this.walker?.home ?? null;
  }
  /** plan a walk to (x, z); returns its length in metres, or null when there is no way there */
  planWalk(x: number, z: number): number | null {
    if (!this.walker || !this.walkable) return null;
    return this.walkable.path(this.walker.x, this.walker.z, x, z)?.length ?? null;
  }
  walkTo(x: number, z: number): number | null {
    if (!this.walker || !this.walkable) return null;
    const path = this.walkable.path(this.walker.x, this.walker.z, x, z);
    if (!path) return null;
    this.walker.walk = new Walk(path);
    this.dirty = true;
    return path.length;
  }
  walkHome() {
    if (!this.walker) return;
    this.walkTo(this.walker.home.x, this.walker.home.z);
  }
  /** back home at once (the tab was hidden: nothing to watch) */
  snapHome() {
    const w = this.walker;
    if (!w || !this.crowd) return;
    w.walk = null;
    w.x = w.home.x;
    w.z = w.home.z;
    this.crowd.setPos(w.i, w.home.x, w.home.z, w.home.y);
    this.dirty = true;
  }
  private stepWalker(dt: number) {
    const w = this.walker;
    if (!w?.walk || !this.crowd || !this.walkCity) return;
    const [x, z] = w.walk.step(dt);
    w.x = x;
    w.z = z;
    const y = this.groundY(x, z);
    // (the map view stays where you put it; the walk view follows in stepCamera)
    this.crowd.setPos(w.i, x, z, y);
    const now = performance.now();
    const arrived = w.walk.done;
    if (arrived || now - this.lastWalkPing > 500) {
      this.lastWalkPing = now;
      this.onWalk?.(x, z, arrived);
    }
    if (arrived) w.walk = null;
    this.dirty = true;
  }

  // ---- staging (v6 §5, V6-D7) ---------------------------------------------------------------------

  private staging = new THREE.Group();
  /** pillar materials with their full opacity: they fade as the camera comes close */
  private beams: [THREE.MeshBasicMaterial, number][] = [];
  /**
   * Light pillars over the top ten (visible from the whole island), a thin one over each plaza-seat
   * player (v11), and a beacon over every mini plaza. `today` = the legend of the day's key: its pillar burns brighter (V6-D5).
   */
  stage(city: Island, placed: Placed[], today: string | null = null) {
    this.staging.clear();
    this.beams = [];
    const GLOW = { legendary: '#ffcf5a', mythic: '#b98cff', epic: '#6cb8ff', rare: '#72f29a' };
    const beam = (
      x: number,
      y: number,
      z: number,
      colour: string,
      r: number,
      h: number,
      o: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.35, r, h, 16, 1, true).translate(0, h / 2, 0),
        new THREE.MeshBasicMaterial({
          color: colour,
          transparent: true,
          opacity: o,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      m.position.set(x, y, z);
      m.renderOrder = 5;
      this.beams.push([m.material, o]);
      this.staging.add(m);
    };
    for (const p of placed) {
      const sp = p.g.special;
      // v11 (V11-D6): a player holding a plaza seat — the top 1 % — gets a thin pale pillar, so the
      // island's best players can be found from the overview (thinner and paler than a legend's)
      // (mini plazas use the 'plaza' kind too — the main plaza is the one round the monument)
      if (
        (!sp || sp.earned) &&
        p.spot.kind === 'plaza' &&
        Math.hypot(p.spot.x, p.spot.z) < PLAZA_R &&
        !p.g.special?.sealed
      ) {
        beam(p.spot.x, p.spot.y, p.spot.z, '#fff3dc', 0.5, 34, 0.13);
        continue;
      }
      if (!sp) continue;
      const isToday = today != null && sp.key === today;
      if (sp.rank <= 10 || isToday)
        beam(
          p.spot.x,
          sp.rank === 1 ? TOWN_Y : p.spot.y,
          p.spot.z,
          GLOW[sp.tier],
          sp.rank === 1 ? 1.7 : 1.1,
          sp.rank <= 3 ? 90 : 60,
          isToday ? 0.34 : 0.2,
        );
    }
    for (const m of city.miniPlazas) {
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.3, 1),
        new THREE.MeshBasicMaterial({ color: '#fff4c8' }),
      );
      orb.position.set(m.x, m.y + 24, m.z);
      this.staging.add(orb);
      beam(m.x, m.y + 17, m.z, '#fff0b0', 1.1, 7, 0.22);
    }
    this.scene.add(this.staging);
    this.dirty = true;
  }

  // ---- sculpted pieces (v8 build 05) ---------------------------------------------------------------

  /** load the 3D models; each one replaces its code-built piece or sprite as it arrives */
  async addPieces(city: Island, placed: Placed[], homes: Map<number, Home> = new Map()) {
    const t0 = performance.now();
    // the model loader is its own chunk: it is not needed for the first view
    // v11 (V11-D8): after a deploy this chunk can be gone for a page opened earlier → reload once
    let mod: typeof import('./models');
    try {
      mod = await import('./models');
    } catch (e) {
      if (!recoverFromSkew(e)) report('error', `models chunk: ${String(e)}`);
      return;
    }
    const { loadPieces } = mod;
    const pcs = await loadPieces(city, placed, homes);
    if (!pcs) return;
    this.scene.add(pcs.group);
    this.piecesGroup = pcs.group;
    this.lightPieces();
    if (pcs.monument && this.town) this.town.monument.visible = false;
    if (pcs.landmarks && this.town) for (const l of this.town.landmarks) l.visible = false;
    if (pcs.town && this.town) this.town.plots.visible = false;
    for (const i of pcs.replaced) this.crowd?.hide(i);
    // v14.1: the street props are detail — hidden at far zoom like the windows and lamps
    if (pcs.props) {
      pcs.props.visible = this.detailOn;
      this.detail.push(pcs.props);
    }
    this.bob = pcs.bob;
    // v11 (V11-D7): the solid pieces block walking once they stand there
    this.solids = pcs.solids;
    this.walkable?.setSolids(pcs.solids);
    this.stats.piecesMs = Math.round(performance.now() - t0);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  // ---- creatures -------------------------------------------------------------------------------------

  setCreatures(placed: Placed[]) {
    if (this.crowd) {
      this.scene.remove(this.crowd.sprites, this.crowd.shadows);
      this.crowd.dispose();
    }
    this.crowd = new Crowd(placed);
    this.scene.add(this.crowd.shadows, this.crowd.sprites);
    this.dirty = true;
  }

  /** sprites grow a little when zoomed far out, so the crowd still reads (Transit does the same) */
  private get grow() {
    return Math.max(1, Math.min(2, 1.1 / this.viewZoom));
  }
  /** upright sprites are foreshortened by the camera pitch; stretch them back to true proportions */
  private get upScale() {
    const b = this.modeT * this.modeT * (3 - 2 * this.modeT);
    return 1 / Math.cos(this.pitch + (this.tpPitch - this.pitch) * b);
  }
  /** the zoom the level of detail follows: the walk view is as close as the map goes */
  private get viewZoom() {
    return this.modeT > 0.5 ? 6 : this.zoom;
  }

  // ---- loop --------------------------------------------------------------------------------------------

  private loop = (now = 0) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    // walkers only matter when they are big enough to see: animate at street and district zoom
    const animate = this.crowd && this.viewZoom > 0.45;
    const turning = this.spinning !== 0 || this.yawTo !== null || this.moving;
    if (!animate && !this.dirty && !this.anim && !this.walker?.walk && !this.steering && !turning)
      return;
    if (now - this.last < 32) return; // ~30 fps is plenty for a city and kind to phones
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // v12: Q / E turn steadily; the ⟳ quarter turn eases in
    if (this.spinning) this.yaw += this.spinning * 1.6 * dt;
    if (this.yawTo !== null) {
      const d = this.yawTo - this.yaw;
      if (Math.abs(d) < 0.002) {
        this.yaw = this.yawTo;
        this.yawTo = null;
      } else this.yaw += d * Math.min(1, dt * 9);
    }
    if (animate) this.clock += dt;
    for (const b of this.bob) b.obj.position.y = b.y + Math.sin(this.clock * 0.9) * 0.6;
    // water and air (v8 build 04): the air shows only close enough to be seen
    if (this.town)
      (this.town.water.material as THREE.ShaderMaterial).uniforms.uTime!.value = this.clock;
    if (this.air) {
      const px = this.host.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      const fade = Math.min(1, Math.max(0, (this.viewZoom - 0.7) / 0.6));
      this.air.update(this.clock, this.target.x, this.target.z, px, fade);
    }
    this.stepWalker(dt);
    this.stepSteer(dt);
    this.stepCamera(dt);
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.target.lerpVectors(this.anim.from, this.anim.to, e);
      this.zoom = Math.exp(
        Math.log(this.anim.z0) + (Math.log(this.anim.z1) - Math.log(this.anim.z0)) * e,
      );
      if (k >= 1) this.anim = null;
    }
    this.dirty = false;
    this.placeCamera();
    // LOD: windows, add-ons and street furniture only where they can be seen (v3 build file 08)
    const vz = this.viewZoom;
    const near = vz > 0.42;
    this.labels.visible = vz < 0.55;
    // pillars are for finding legends from afar: close up they fade so the creatures read
    const fade = vz < 0.7 ? 1 : Math.max(0.12, (0.7 / vz) ** 1.4);
    for (const [mat, o] of this.beams) mat.opacity = o * fade;
    if (near !== this.detailOn) {
      this.detailOn = near;
      for (const o of this.detail) o.visible = near;
    }
    if (this.crowd) {
      const right = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      // v13.2: in the walk view your Gitemon's cut-out turns toward the way it walks
      this.crowd.update(this.clock, right, this.grow, this.upScale, this.modeT);
    }
    const t = performance.now();
    this.renderer.render(this.scene, this.camera);
    if (this.frameWaiters.length) for (const done of this.frameWaiters.splice(0)) done();
    if (this.probeDue) this.probe();
    this.stats.frames++;
    this.stats.ms += performance.now() - t;
  };

  // ---- HUD (v8 §0 V8-D9) -----------------------------------------------------------------------------

  /** the camera's heading (radians): the compass turns with it */
  get heading() {
    return this.yaw;
  }
  get view(): { x: number; z: number; span: number } {
    if (this.follow) return { x: this.tpFocus.x, z: this.tpFocus.z, span: this.tpDist * 3 };
    return { x: this.target.x, z: this.target.z, span: this.span };
  }

  /** render counters for ?debug and the perf check (v3 build file 08) */
  readonly stats = { frames: 0, ms: 0, buildMs: 0, townMs: 0, layoutMs: 0, homes: 0, piecesMs: 0 };
  get info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, ...this.stats };
  }
}
