import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/CSS2DRenderer.js';

// Alle Maße in Zentimetern. Position (x, y, z) = linke, hintere, untere Ecke
// der Grundfläche. x = nach rechts, z = nach vorne, y = nach oben.

// ---------- Formatierung ----------

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const cm = (v) => nf.format(v) + ' cm';
const r1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Teiletypen ----------

const WALL = [['wand', 'Wand'], ['durchgang', 'Wand mit Durchgang'], ['offen', 'offen']];

const TYPES = {
  modul: {
    label: 'Grundmodul (Wanne)',
    defaults: { w: 120, d: 60, h: 35, t: 1.8, front: 'plexi', links: 'wand', rechts: 'wand', durchB: 20, durchH: 16, farbe: '#d9b98c' },
    fields: [
      ['w', 'Breite (außen)'], ['d', 'Tiefe (außen)'], ['h', 'Höhe (gesamt)'], ['t', 'Plattenstärke'],
      ['front', 'Vorderseite', [['plexi', 'Plexiglas'], ['holz', 'Holz'], ['offen', 'offen']]],
      ['links', 'Linke Seite', WALL], ['rechts', 'Rechte Seite', WALL],
      ['durchB', 'Durchgang Breite'], ['durchH', 'Durchgang Höhe'],
    ],
  },
  platte: {
    label: 'Etage / Platte',
    defaults: { w: 60, d: 35, t: 1.8, stuetzen: 20, rand: 6, farbe: '#c9a676' },
    fields: [
      ['w', 'Breite'], ['d', 'Tiefe'], ['t', 'Plattenstärke'],
      ['stuetzen', 'Stützenlänge (0 = keine)'], ['rand', 'Absturzkante vorne (0 = keine)'],
    ],
  },
  rampe: {
    label: 'Rampe',
    defaults: { w: 50, d: 20, h: 22, t: 1.2, sprossen: 7, seiten: 4, farbe: '#b98f5c' },
    fields: [
      ['w', 'Länge waagerecht'], ['d', 'Breite'], ['h', 'Höhenunterschied'], ['t', 'Brettstärke'],
      ['sprossen', 'Sprossenabstand (0 = keine)'], ['seiten', 'Seitenschutz-Höhe (0 = keiner)'],
    ],
  },
  haus: {
    label: 'Häuschen',
    defaults: { w: 40, d: 28, h: 22, t: 1.2, tuerB: 12, tuerH: 13, eingaenge: 2, farbe: '#a8774a' },
    fields: [
      ['w', 'Breite'], ['d', 'Tiefe'], ['h', 'Höhe (mit Dach)'], ['t', 'Brettstärke'],
      ['tuerB', 'Eingang Breite'], ['tuerH', 'Eingang Höhe'],
      ['eingaenge', 'Eingänge', [[1, '1 (vorne)'], [2, '2 (vorne + links)']]],
    ],
  },
  block: {
    label: 'Zubehör (Quader)',
    defaults: { w: 30, d: 15, h: 20, farbe: '#7aa35a' },
    fields: [['w', 'Breite'], ['d', 'Tiefe'], ['h', 'Höhe']],
  },
};

// ---------- Geometrie-Helfer ----------

function woodMat(color, factor = 1) {
  const c = new THREE.Color(color);
  if (factor !== 1) c.multiplyScalar(factor);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0 });
}
function plexiMat() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd8ecff, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide,
  });
}

// Fügt einen Quader mit linker/hinterer/unterer Ecke bei (x, y, z) hinzu.
function addBox(parent, mat, part, x, y, z, sx, sy, sz) {
  if (sx <= 0 || sy <= 0 || sz <= 0) return null;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat.clone());
  mesh.position.set(x + sx / 2, y + sy / 2, z + sz / 2);
  mesh.userData.part = part;
  mesh.castShadow = mesh.receiveShadow = !mat.transparent;
  parent.add(mesh);
  return mesh;
}

// Platte in der XY-Ebene (x 0..width, y 0..height, z 0..thick), optional mit
// einem Bogen-Ausschnitt unten (Tür / Durchgang), mittig bei cx.
function holePanel(parent, mat, part, width, height, thick, hole) {
  if (width <= 0 || height <= 0) return null;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  if (hole && hole.w > 0 && hole.h > 0) {
    const hw = Math.min(hole.w, width - 2) / 2;
    const hh = Math.min(hole.h, height - 1);
    const r = Math.min(hw, hh);
    const cx = hole.cx ?? width / 2;
    shape.lineTo(cx - hw, 0);
    shape.lineTo(cx - hw, hh - r);
    shape.absarc(cx, hh - r, r, Math.PI, 0, true);
    shape.lineTo(cx + hw, 0);
  }
  shape.lineTo(width, 0);
  shape.lineTo(width, height);
  shape.lineTo(0, height);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 16 });
  const mesh = new THREE.Mesh(geo, mat.clone());
  mesh.userData.part = part;
  mesh.castShadow = mesh.receiveShadow = !mat.transparent;
  parent.add(mesh);
  return mesh;
}

// Seitenwand entlang der Tiefe (z) bei x0..x0+thick.
function sidePanel(parent, mat, part, x0, y0, z0, length, height, thick, hole) {
  const m = holePanel(parent, mat, part, length, height, thick, hole);
  if (!m) return;
  m.rotation.y = -Math.PI / 2;
  m.position.set(x0 + thick, y0, z0);
}

// ---------- Aufbau der einzelnen Typen ----------
// Jeder Builder liefert: Teile (Zuschnitt), Außenmaße und Infos.

const BUILDERS = {
  modul(p, g) {
    const { w, d, h, t } = p;
    const hw = h - t; // Wandhöhe über dem Boden
    const wood = woodMat(p.farbe);
    const parts = [];
    const part = (name, n, a, b, s, mat = 'Holz') => parts.push({ name, n, a: r1(a), b: r1(b), s, mat }) - 1;

    addBox(g, wood, part('Boden', 1, w, d, t), 0, 0, 0, w, t, d);
    addBox(g, wood, part('Rückwand', 1, w, hw, t), 0, t, 0, w, hw, t);
    if (p.front !== 'offen') {
      const plexi = p.front === 'plexi';
      addBox(g, plexi ? plexiMat() : wood, part(plexi ? 'Front (Plexiglas)' : 'Front', 1, w, hw, plexi ? 0.4 : t, plexi ? 'Plexiglas' : 'Holz'),
        0, t, d - t, w, hw, t);
    }
    const sideLen = d - 2 * t;
    const hole = { w: p.durchB, h: p.durchH };
    const sideKinds = [['links', 0], ['rechts', w - t]];
    const same = p.links === p.rechts && p.links !== 'offen';
    let sharedIdx = null;
    for (const [key, x0] of sideKinds) {
      const kind = p[key];
      if (kind === 'offen') continue;
      const label = kind === 'durchgang'
        ? `Seitenwand mit Durchgang ${nf.format(p.durchB)} × ${nf.format(p.durchH)}`
        : 'Seitenwand';
      let idx;
      if (same) idx = sharedIdx ??= part(label, 2, sideLen, hw, t);
      else idx = part(`${label} (${key})`, 1, sideLen, hw, t);
      sidePanel(g, wood, idx, x0, t, t, sideLen, hw, t, kind === 'durchgang' ? hole : null);
    }
    const area = (w - 2 * t) * (d - 2 * t) / 10000;
    return {
      parts,
      box: [[0, 0, 0], [w, h, d]],
      labels: [w, h, d],
      area,
      info: [`Innenmaß: ${cm(r1(w - 2 * t))} × ${cm(r1(d - 2 * t))}`, `Lauffläche: ${nf.format(r1(area * 100) / 100)} m²`],
      warn: p.links === 'durchgang' || p.rechts === 'durchgang'
        ? (p.durchH > hw - 2 ? ['Der Durchgang ist fast so hoch wie die Wand.'] : [])
        : [],
    };
  },

  platte(p, g) {
    const { w, d, t } = p;
    const L = Math.max(0, p.stuetzen || 0);
    const rand = Math.max(0, p.rand || 0);
    const wood = woodMat(p.farbe);
    const dark = woodMat(p.farbe, 0.8);
    const parts = [];
    const part = (name, n, a, b, s) => parts.push({ name, n, a: r1(a), b: r1(b), s, mat: 'Holz' }) - 1;

    addBox(g, wood, part('Etagenplatte', 1, w, d, t), 0, 0, 0, w, t, d);
    if (L > 0) {
      const s = 4, i = part('Stütze (Kantholz 4 × 4)', 4, L, s, s);
      for (const [x, z] of [[0, 0], [w - s, 0], [0, d - s], [w - s, d - s]]) addBox(g, dark, i, x, -L, z, s, L, s);
    }
    if (rand > 0) addBox(g, dark, part('Absturzkante vorne', 1, w, rand, 1.2), 0, t, d - 1.2, w, rand, 1.2);
    const area = w * d / 10000;
    return {
      parts,
      box: [[0, -L, 0], [w, t + rand, d]],
      labels: [w, t + rand + L, d],
      area, isLevel: true,
      info: [
        `Fläche: ${nf.format(r1(area * 100) / 100)} m²`,
        `Oberkante Platte: ${cm(r1(p.y + t))} über Null`,
        L > 0 ? `Stützen reichen bis ${cm(r1(p.y - L))}` : 'Ohne Stützen (z. B. an der Wand verschraubt)',
      ],
      warn: rand === 0 && p.y > 15 ? ['Ohne Absturzkante: Meerschweinchen können von der Etage fallen.'] : [],
    };
  },

  rampe(p, g) {
    const { w, d, h, t } = p;
    const L = Math.hypot(w, h);
    const ang = Math.atan2(h, w);
    const deg = ang * 180 / Math.PI;
    const wood = woodMat(p.farbe);
    const dark = woodMat(p.farbe, 0.8);
    const parts = [];
    const part = (name, n, a, b, s) => parts.push({ name, n, a: r1(a), b: r1(b), s, mat: 'Holz' }) - 1;

    const tilt = new THREE.Group();
    tilt.rotation.z = ang;
    g.add(tilt);
    addBox(tilt, wood, part('Rampenbrett', 1, L, d, t), 0, 0, 0, L, t, d);
    const sh = Math.max(0, p.seiten || 0);
    const inner = sh > 0 ? d - 2 : d;
    if (p.sprossen > 0) {
      const n = Math.max(0, Math.floor((L - 4) / p.sprossen));
      if (n > 0) {
        const i = part('Sprosse (Leiste 1 × 1)', n, inner, 1, 1);
        for (let k = 1; k <= n; k++) addBox(tilt, dark, i, k * p.sprossen - 0.5, t, sh > 0 ? 1 : 0, 1, 1, inner);
      }
    }
    if (sh > 0) {
      const i = part('Seitenschutz-Leiste', 2, L, sh, 1);
      addBox(tilt, dark, i, 0, t, 0, L, sh, 1);
      addBox(tilt, dark, i, 0, t, d - 1, L, sh, 1);
    }
    return {
      parts,
      box: [[0, 0, 0], [w, h + t, d]],
      labels: [w, h, d],
      info: [`Brettlänge: ${cm(r1(L))}`, `Steigung: ${nf.format(r1(deg))}°`, `Oberes Ende: ${cm(r1(p.y + h))} über Null`],
      warn: deg > 30 ? [`Mit ${nf.format(r1(deg))}° ist die Rampe sehr steil. Für Meerschweinchen besser unter 30° bleiben.`] : [],
    };
  },

  haus(p, g) {
    const { w, d, h, t } = p;
    const hw = h - t;
    const wood = woodMat(p.farbe);
    const roofMat = woodMat(p.farbe, 0.85);
    const parts = [];
    const part = (name, n, a, b, s) => parts.push({ name, n, a: r1(a), b: r1(b), s, mat: 'Holz' }) - 1;
    const door = { w: p.tuerB, h: p.tuerH };
    const doorTxt = `mit Eingang ${nf.format(p.tuerB)} × ${nf.format(p.tuerH)}`;

    addBox(g, roofMat, part('Dach', 1, w, d, t), 0, hw, 0, w, t, d);
    addBox(g, wood, part('Rückwand', 1, w, hw, t), 0, 0, 0, w, hw, t);
    const front = holePanel(g, wood, part(`Vorderwand ${doorTxt}`, 1, w, hw, t), w, hw, t, door);
    front.position.z = d - t;
    const sideLen = d - 2 * t;
    if (Number(p.eingaenge) === 2) {
      sidePanel(g, wood, part(`Seitenwand links ${doorTxt}`, 1, sideLen, hw, t), 0, 0, t, sideLen, hw, t, door);
      sidePanel(g, wood, part('Seitenwand rechts', 1, sideLen, hw, t), w - t, 0, t, sideLen, hw, t, null);
    } else {
      const i = part('Seitenwand', 2, sideLen, hw, t);
      sidePanel(g, wood, i, 0, 0, t, sideLen, hw, t, null);
      sidePanel(g, wood, i, w - t, 0, t, sideLen, hw, t, null);
    }
    return {
      parts,
      box: [[0, 0, 0], [w, h, d]],
      labels: [w, h, d],
      info: [`Innenraum: ${cm(r1(w - 2 * t))} × ${cm(r1(d - 2 * t))} × ${cm(r1(hw))}`],
      warn: Number(p.eingaenge) < 2 ? ['Tipp: Häuschen für Meerschweinchen sollten zwei Ausgänge haben.'] : [],
    };
  },

  block(p, g) {
    const parts = [{ name: 'Fertigteil', n: 1, a: r1(p.w), b: r1(p.d), s: r1(p.h), mat: '–' }];
    addBox(g, woodMat(p.farbe), 0, 0, 0, 0, p.w, p.h, p.d);
    return { parts, box: [[0, 0, 0], [p.w, p.h, p.d]], labels: [p.w, p.h, p.d], info: [] };
  },
};

// ---------- Szene ----------

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9edf2);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
camera.position.set(150, 220, 330);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(120, 10, 30);

scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b9a0, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);
let grid = null;

const piecesRoot = new THREE.Group();
scene.add(piecesRoot);

function resize() {
  const { clientWidth: w, clientHeight: h } = view;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// ---------- Zustand ----------

let layout = { name: '', pieces: [] };
let selectedId = null;
let selectedPart = null;
let showAllDims = false;
const built = new Map(); // id -> { root, content, result }

function getPiece(id) { return layout.pieces.find((p) => p.id === id); }
function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function normalize(p) {
  const def = TYPES[p.typ] ? p.typ : 'block';
  const out = { ...TYPES[def].defaults, x: 0, y: 0, z: 0, rot: 0, notiz: '', ...p, typ: def };
  for (const [k] of TYPES[def].fields) {
    if (typeof TYPES[def].defaults[k] === 'number') out[k] = Number(out[k]) || 0;
  }
  for (const k of ['x', 'y', 'z', 'rot']) out[k] = Number(out[k]) || 0;
  out.rot = ((Math.round(out.rot / 90) * 90) % 360 + 360) % 360;
  if (!out.id) out.id = newId();
  if (!out.name) out.name = TYPES[def].label;
  return out;
}

// ---------- Aufbau in 3D ----------

function buildPiece(p) {
  const old = built.get(p.id);
  if (old) disposeTree(old.root);

  const content = new THREE.Group();
  const result = BUILDERS[p.typ](p, content);
  const [[x0, y0, z0], [x1, y1, z1]] = result.box;
  const ex = x1 - x0, ez = z1 - z0;
  const swap = p.rot === 90 || p.rot === 270;
  const fw = swap ? ez : ex, fd = swap ? ex : ez;

  content.position.set(-(x0 + x1) / 2, 0, -(z0 + z1) / 2);
  const root = new THREE.Group();
  root.add(content);
  root.position.set(p.x + fw / 2, p.y, p.z + fd / 2);
  root.rotation.y = -p.rot * Math.PI / 180;
  root.userData.pieceId = p.id;
  content.traverse((o) => { if (o.isMesh) o.userData.pieceId = p.id; });

  const dims = makeDims(result, p.id === selectedId ? 'big' : 'small');
  content.add(dims);
  piecesRoot.add(root);
  built.set(p.id, { root, content, dims, result, footprint: [fw, fd] });
  applyHighlight(p.id);
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.isCSS2DObject) o.element.remove();
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  obj.removeFromParent();
}

function rebuildAll() {
  for (const { root } of built.values()) disposeTree(root);
  built.clear();
  layout.pieces.forEach(buildPiece);
  updateEnvironment();
}

function removePiece3D(id) {
  const b = built.get(id);
  if (b) { disposeTree(b.root); built.delete(id); }
}

function layoutBox() {
  const box = new THREE.Box3();
  for (const { root } of built.values()) meshBox(root, box);
  if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 30, 60));
  return box;
}

// Umriss nur aus den Bauteilen, ohne Maßlinien
function meshBox(obj, box = new THREE.Box3()) {
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

function updateEnvironment() {
  const box = layoutBox();
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 100);

  // Raster: 10-cm-Kästchen, Ursprung bei (0, 0)
  if (grid) disposeTree(grid);
  const half = Math.ceil((span + 200) / 200) * 100;
  grid = new THREE.GridHelper(half * 2, half / 5, 0xb9c1cc, 0xd9dee5);
  grid.position.set(Math.round(center.x / 10) * 10, 0, Math.round(center.z / 10) * 10);
  scene.add(grid);

  const r = span * 0.9 + 60;
  sun.position.set(center.x - r * 0.5, r * 1.4, center.z + r);
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 4 });
  sun.shadow.camera.updateProjectionMatrix();

  updateStats();
}

// ---------- Maßlinien ----------

const DIM_COLORS = { x: 0x2f6fdf, y: 0xd9622b, z: 0x2c9a55 };

function makeDims(result, mode) {
  const group = new THREE.Group();
  group.name = 'dims';
  const [[x0, y0, z0], [x1, y1, z1]] = result.box;
  const [lx, ly, lz] = result.labels;
  const o = mode === 'big' ? 8 : 5;
  const tick = 2.5;

  const line = (axis, pts) => {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    const mat = new THREE.LineBasicMaterial({ color: DIM_COLORS[axis], depthTest: false, transparent: true });
    const l = new THREE.LineSegments(geo, mat);
    l.renderOrder = 999;
    group.add(l);
  };
  const label = (axis, value, pos) => {
    const el = document.createElement('div');
    el.className = `dim ${axis}${mode === 'big' ? '' : ' small'}`;
    el.textContent = cm(r1(value));
    const obj = new CSS2DObject(el);
    obj.position.set(...pos);
    group.add(obj);
  };

  // Breite: vorne unten
  const zf = z1 + o;
  line('x', [[x0, y0, zf], [x1, y0, zf], [x0, y0, z1], [x0, y0, zf + tick], [x1, y0, z1], [x1, y0, zf + tick]]);
  label('x', lx, [(x0 + x1) / 2, y0, zf]);
  // Tiefe: rechts unten
  const xr = x1 + o;
  line('z', [[xr, y0, z0], [xr, y0, z1], [x1, y0, z0], [xr + tick, y0, z0], [x1, y0, z1], [xr + tick, y0, z1]]);
  label('z', lz, [xr, y0, (z0 + z1) / 2]);
  // Höhe: vorne rechts
  line('y', [[xr, y0, zf], [xr, y1, zf], [x1, y1, z1], [xr + tick, y1, zf + tick]]);
  label('y', ly, [xr, (y0 + y1) / 2, zf]);

  // CSS2D-Beschriftungen prüfen nur ihre eigene Sichtbarkeit
  const visible = mode === 'big' || showAllDims;
  group.traverse((o) => { o.visible = visible; });
  return group;
}

function refreshDims(id) {
  const b = built.get(id);
  if (!b) return;
  disposeTree(b.dims);
  b.dims = makeDims(b.result, id === selectedId ? 'big' : 'small');
  b.content.add(b.dims);
}

// ---------- Hervorhebung & Auswahl ----------

function applyHighlight(id) {
  const b = built.get(id);
  if (!b) return;
  const sel = id === selectedId;
  b.content.traverse((o) => {
    if (!o.isMesh || !o.material.emissive) return;
    const strong = sel && selectedPart !== null && o.userData.part === selectedPart;
    o.material.emissive.setHex(sel ? 0x2f6fdf : 0x000000);
    o.material.emissiveIntensity = strong ? 0.55 : sel ? 0.12 : 0;
  });
}

function select(id, part = null) {
  const prev = selectedId;
  selectedId = id && getPiece(id) ? id : null;
  selectedPart = selectedId ? part : null;
  if (prev && prev !== selectedId) { refreshDims(prev); applyHighlight(prev); }
  if (selectedId) { refreshDims(selectedId); applyHighlight(selectedId); }
  renderList();
  renderDetail();
}

// Klicken / Hovern in der 3D-Ansicht
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tip = document.getElementById('tip');
let downAt = null;

function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(piecesRoot.children, true).find((h) => h.object.isMesh && h.object.userData.pieceId);
  return hit ? hit.object : null;
}

renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || ev.button !== 0) return;
  const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
  downAt = null;
  if (moved > 5) return;
  const obj = pick(ev);
  if (obj) select(obj.userData.pieceId, obj.userData.part ?? null);
  else select(null);
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (ev.buttons) { tip.style.display = 'none'; return; }
  const obj = pick(ev);
  if (!obj) { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; return; }
  const p = getPiece(obj.userData.pieceId);
  const part = built.get(p.id)?.result.parts[obj.userData.part];
  renderer.domElement.style.cursor = 'pointer';
  tip.innerHTML = `<b>${esc(p.name)}</b>` + (part ? `<small>${esc(part.name)}: ${partDims(part)}</small>` : '');
  const rect = view.getBoundingClientRect();
  tip.style.left = ev.clientX - rect.left + 14 + 'px';
  tip.style.top = ev.clientY - rect.top + 14 + 'px';
  tip.style.display = 'block';
});
renderer.domElement.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

function partDims(part) {
  return `${nf.format(part.a)} × ${nf.format(part.b)} cm` + (part.s ? `, ${nf.format(part.s)} cm stark` : '');
}

// ---------- Kamera ----------

function frame(box, dir, factor = 1) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 20);
  const dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * factor;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir.clone().normalize(), dist);
  camera.updateProjectionMatrix();
}

const VIEWS = {
  '3d': new THREE.Vector3(0.35, 0.65, 1),
  top: new THREE.Vector3(0, 1, 0.001),
  front: new THREE.Vector3(0, 0.08, 1),
  side: new THREE.Vector3(1, 0.08, 0),
};
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => frame(layoutBox(), VIEWS[b.dataset.view])));
document.getElementById('btnFocus').addEventListener('click', () => {
  const b = built.get(selectedId);
  if (b) frame(meshBox(b.root), camera.position.clone().sub(controls.target), 1.7);
});
const btnAllDims = document.getElementById('btnAllDims');
btnAllDims.addEventListener('click', () => {
  showAllDims = !showAllDims;
  btnAllDims.classList.toggle('on', showAllDims);
  for (const id of built.keys()) refreshDims(id);
});

// ---------- Seitenleiste ----------

const listEl = document.getElementById('pieceList');
const detailEl = document.getElementById('detail');

function footprintText(p) {
  const b = built.get(p.id);
  if (!b) return '';
  return `${nf.format(r1(b.footprint[0]))} × ${nf.format(r1(b.footprint[1]))}`;
}

function renderList() {
  listEl.innerHTML = '';
  for (const p of layout.pieces) {
    const li = document.createElement('li');
    li.className = p.id === selectedId ? 'sel' : '';
    li.innerHTML = `<span class="swatch" style="background:${esc(p.farbe)}"></span><span>${esc(p.name)}</span><span class="meta">${footprintText(p)} cm</span>`;
    li.addEventListener('click', () => select(p.id));
    listEl.appendChild(li);
  }
  listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function renderDetail() {
  const p = getPiece(selectedId);
  if (!p) {
    detailEl.innerHTML = `<h2>Details</h2><p class="empty">Klicke ein Teil in der 3D-Ansicht oder in der Liste an, um seine Maße und die Zuschnitte zu sehen.</p>`;
    return;
  }
  const type = TYPES[p.typ];
  detailEl.innerHTML = `
    <h2>Ausgewählt</h2>
    <h3>${esc(p.name)}</h3>
    <div class="sub">${esc(type.label)}</div>
    <div id="measures"></div>
    <h2 style="margin-top:14px">Bearbeiten</h2>
    <div class="form" id="form"></div>
    <div class="actions">
      <button id="btnDup">Duplizieren</button>
      <button id="btnDel" class="danger">Löschen</button>
    </div>`;
  renderMeasures();

  const form = detailEl.querySelector('#form');
  const field = (key, label, kind, opts = {}) => {
    const wrap = document.createElement('label');
    if (opts.full) wrap.className = 'full';
    wrap.append(label + (kind === 'num' && opts.unit !== false ? ' (cm)' : ''));
    let input;
    if (kind === 'select') {
      input = document.createElement('select');
      for (const [v, t] of opts.options) input.add(new Option(t, v));
      input.value = String(p[key]);
    } else {
      input = document.createElement('input');
      input.type = kind === 'num' ? 'number' : kind;
      if (kind === 'num') { input.step = opts.step ?? '0.1'; if (opts.min !== undefined) input.min = opts.min; }
      input.value = p[key] ?? '';
    }
    input.addEventListener(kind === 'select' || kind === 'color' ? 'change' : 'input', () => {
      if (key === 'typ') return changeType(p, input.value);
      let v = input.value;
      if (kind === 'num') { v = parseFloat(String(v).replace(',', '.')); if (!Number.isFinite(v)) return; }
      else if (kind === 'select' && typeof type.defaults[key] === 'number') v = Number(v);
      else if (key === 'rot') v = Number(v);
      p[key] = v;
      if (kind === 'color') input.value = v;
      pieceChanged(p, key === 'name' || key === 'notiz');
    });
    if (kind === 'color') input.addEventListener('input', () => { p[key] = input.value; pieceChanged(p); });
    wrap.appendChild(input);
    form.appendChild(wrap);
  };

  field('name', 'Name', 'text', { full: true });
  field('typ', 'Art', 'select', { options: Object.entries(TYPES).map(([k, t]) => [k, t.label]) });
  field('farbe', 'Farbe', 'color');
  for (const [key, label, options] of type.fields) {
    if (options) field(key, label, 'select', { options });
    else field(key, label, 'num', { min: 0 });
  }
  field('x', 'Position x (von links)', 'num');
  field('z', 'Position z (von hinten)', 'num');
  field('y', 'Höhe über Boden (y)', 'num');
  field('rot', 'Drehung', 'select', { options: [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']] });
  field('notiz', 'Notiz', 'text', { full: true });

  detailEl.querySelector('#btnDup').addEventListener('click', () => {
    const copy = normalize({ ...structuredClone(p), id: newId(), name: p.name + ' (Kopie)', x: p.x + (built.get(p.id)?.footprint[0] ?? 0) + 5 });
    layout.pieces.push(copy);
    buildPiece(copy);
    updateEnvironment();
    select(copy.id);
    scheduleSave();
  });
  detailEl.querySelector('#btnDel').addEventListener('click', () => {
    if (!confirm(`„${p.name}“ wirklich löschen?`)) return;
    layout.pieces = layout.pieces.filter((q) => q.id !== p.id);
    removePiece3D(p.id);
    updateEnvironment();
    select(null);
    scheduleSave();
  });
}

function renderMeasures() {
  const p = getPiece(selectedId);
  const b = p && built.get(p.id);
  const el = detailEl.querySelector('#measures');
  if (!b || !el) return;
  const { result } = b;
  const [lx, ly, lz] = result.labels;
  const names = p.typ === 'rampe' ? ['Länge', 'Höhe', 'Breite'] : ['Breite', 'Höhe', 'Tiefe'];
  const rows = result.parts.map((part, i) => `
    <tr class="${i === selectedPart ? 'hl' : ''}" data-part="${i}" style="cursor:pointer">
      <td>${esc(part.name)}${part.mat !== 'Holz' && part.mat !== '–' ? ` <span class="sub">(${esc(part.mat)})</span>` : ''}</td>
      <td class="num">${part.n}×</td>
      <td class="num">${nf.format(part.a)} × ${nf.format(part.b)}</td>
      <td class="num">${part.s ? nf.format(part.s) : ''}</td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="bigdims">
      <span>${names[0]} ${cm(r1(lx))}</span>
      <span class="z">${names[2]} ${cm(r1(lz))}</span>
      <span class="y">${names[1]} ${cm(r1(ly))}</span>
    </div>
    <table>
      <thead><tr><th>Einzelteil</th><th class="num">Anz.</th><th class="num">Maße (cm)</th><th class="num">Stärke</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${result.info.length ? `<ul class="info">${result.info.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${(result.warn || []).map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
    ${p.notiz ? `<p class="sub" style="margin:8px 0 0">Notiz: ${esc(p.notiz)}</p>` : ''}`;
  el.querySelectorAll('tr[data-part]').forEach((tr) => tr.addEventListener('click', () => {
    selectedPart = Number(tr.dataset.part);
    applyHighlight(p.id);
    renderMeasures();
  }));
}

function changeType(p, typ) {
  const idx = layout.pieces.indexOf(p);
  const keep = { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, rot: p.rot, notiz: p.notiz };
  const np = normalize({ ...keep, typ, farbe: TYPES[typ].defaults.farbe });
  layout.pieces[idx] = np;
  selectedPart = null;
  buildPiece(np);
  updateEnvironment();
  renderList();
  renderDetail();
  scheduleSave();
}

function pieceChanged(p, textOnly = false) {
  if (!textOnly) {
    buildPiece(p);
    updateEnvironment();
  }
  renderList();
  renderMeasures();
  const h3 = detailEl.querySelector('h3');
  if (h3) h3.textContent = p.name;
  scheduleSave();
}

// Neues Teil
const newType = document.getElementById('newType');
for (const [k, t] of Object.entries(TYPES)) newType.add(new Option(t.label, k));
document.getElementById('btnAdd').addEventListener('click', () => {
  const box = layoutBox();
  const typ = newType.value;
  const p = normalize({ typ, name: TYPES[typ].label, x: layout.pieces.length ? Math.ceil(box.max.x + 10) : 0, z: 0 });
  layout.pieces.push(p);
  buildPiece(p);
  updateEnvironment();
  select(p.id);
  scheduleSave();
});

function updateStats() {
  const box = layoutBox();
  let floor = 0, levels = 0;
  for (const { result } of built.values()) {
    if (result.isLevel) levels += result.area || 0;
    else floor += result.area || 0;
  }
  const s = box.getSize(new THREE.Vector3());
  document.getElementById('stats').innerHTML =
    `Gesamt: <b>${cm(r1(s.x))} × ${cm(r1(s.z))}</b>, Höhe <b>${cm(r1(box.max.y))}</b> · ` +
    `Lauffläche <b>${nf.format(r1(floor * 100) / 100)} m²</b>` +
    (levels ? ` + Etagen <b>${nf.format(r1(levels * 100) / 100)} m²</b>` : '');
}

// ---------- Stückliste ----------

const partsDlg = document.getElementById('partsDlg');

function allRows() {
  const rows = [];
  for (const p of layout.pieces) {
    const b = built.get(p.id);
    if (!b) continue;
    for (const part of b.result.parts) rows.push({ piece: p.name, ...part });
  }
  return rows;
}

function renderParts() {
  const body = document.getElementById('partsBody');
  let html = '';
  for (const p of layout.pieces) {
    const b = built.get(p.id);
    if (!b) continue;
    const [lx, ly, lz] = b.result.labels;
    html += `<h4>${esc(p.name)} <span class="sub">– ${esc(TYPES[p.typ].label)}, außen ${nf.format(r1(lx))} × ${nf.format(r1(lz))} × ${nf.format(r1(ly))} cm</span></h4>
      <table><thead><tr><th>Einzelteil</th><th>Material</th><th class="num">Anzahl</th><th class="num">Länge</th><th class="num">Breite</th><th class="num">Stärke</th></tr></thead><tbody>` +
      b.result.parts.map((part) => `<tr><td>${esc(part.name)}</td><td>${esc(part.mat)}</td><td class="num">${part.n}</td>
        <td class="num">${cm(part.a)}</td><td class="num">${cm(part.b)}</td><td class="num">${part.s ? cm(part.s) : ''}</td></tr>`).join('') +
      `</tbody></table>`;
  }

  // Zusammengefasster Zuschnitt: gleiche Maße + Material zusammenzählen
  const sum = new Map();
  for (const r of allRows()) {
    if (r.mat === '–') continue;
    const [a, b2] = r.a >= r.b ? [r.a, r.b] : [r.b, r.a];
    const key = [r.mat, a, b2, r.s].join('|');
    const e = sum.get(key) || { mat: r.mat, a, b: b2, s: r.s, n: 0, area: 0 };
    e.n += r.n;
    e.area += r.n * a * b2 / 10000;
    sum.set(key, e);
  }
  const list = [...sum.values()].sort((x, y) => x.mat.localeCompare(y.mat) || y.s - x.s || y.a - x.a);
  const totalByMat = {};
  for (const e of list) totalByMat[`${e.mat} ${nf.format(e.s)} cm`] = (totalByMat[`${e.mat} ${nf.format(e.s)} cm`] || 0) + e.area;
  html += `<h4>Zuschnittliste (zusammengefasst)</h4>
    <table><thead><tr><th>Material</th><th class="num">Stärke</th><th class="num">Anzahl</th><th class="num">Länge</th><th class="num">Breite</th><th class="num">Fläche</th></tr></thead><tbody>` +
    list.map((e) => `<tr><td>${esc(e.mat)}</td><td class="num">${cm(e.s)}</td><td class="num">${e.n}</td><td class="num">${cm(e.a)}</td><td class="num">${cm(e.b)}</td><td class="num">${nf.format(Math.round(e.area * 100) / 100)} m²</td></tr>`).join('') +
    `</tbody></table><p class="sub" style="margin-top:8px">Materialbedarf ohne Verschnitt: ` +
    Object.entries(totalByMat).map(([k, v]) => `${esc(k)}: ${nf.format(Math.round(v * 100) / 100)} m²`).join(' · ') + `</p>`;
  body.innerHTML = html;
}

document.getElementById('btnParts').addEventListener('click', () => { renderParts(); partsDlg.showModal(); });
document.getElementById('btnClose').addEventListener('click', () => partsDlg.close());
document.getElementById('btnPrint').addEventListener('click', () => window.print());
document.getElementById('btnCsv').addEventListener('click', () => {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const num = (v) => (v === undefined || v === '' ? '' : String(v).replace('.', ','));
  const lines = [['Bauteil', 'Einzelteil', 'Material', 'Anzahl', 'Länge (cm)', 'Breite (cm)', 'Stärke (cm)'].map(q).join(';')];
  for (const r of allRows()) lines.push([q(r.piece), q(r.name), q(r.mat), r.n, num(r.a), num(r.b), num(r.s)].join(';'));
  download('﻿' + lines.join('\r\n'), 'stueckliste.csv', 'text/csv');
});

function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Laden & Speichern ----------

const statusEl = document.getElementById('status');
const nameEl = document.getElementById('layoutName');
let saveTimer = null;

function setLayout(data, frameView = true) {
  layout = { name: data?.name || 'Mein Meerschweinchengehege', pieces: (data?.pieces || []).map(normalize) };
  nameEl.value = layout.name;
  selectedId = null;
  selectedPart = null;
  rebuildAll();
  renderList();
  renderDetail();
  if (frameView) frame(layoutBox(), VIEWS['3d']);
}

function scheduleSave() {
  statusEl.textContent = 'Ungespeichert …';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

async function save() {
  try {
    const res = await fetch('api/gehege', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(layout, null, 2),
    });
    if (!res.ok) throw new Error(await res.text());
    statusEl.textContent = 'Gespeichert ✓';
  } catch (e) {
    statusEl.textContent = 'Speichern fehlgeschlagen';
    console.error(e);
  }
}

nameEl.addEventListener('input', () => { layout.name = nameEl.value; scheduleSave(); });

document.getElementById('btnExport').addEventListener('click', () =>
  download(JSON.stringify(layout, null, 2), (layout.name || 'gehege').replace(/[^\wäöüÄÖÜß -]/g, '') + '.json', 'application/json'));
const fileImport = document.getElementById('fileImport');
document.getElementById('btnImport').addEventListener('click', () => fileImport.click());
fileImport.addEventListener('change', async () => {
  const f = fileImport.files[0];
  fileImport.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.pieces)) throw new Error('keine Teile');
    setLayout(data);
    scheduleSave();
  } catch (e) {
    alert('Die Datei konnte nicht gelesen werden: ' + e.message);
  }
});
document.getElementById('btnReset').addEventListener('click', async () => {
  if (!confirm('Dein aktuelles Gehege wird durch das Beispiel ersetzt. Vorher exportieren? Abbrechen = nichts ändern.')) return;
  const res = await fetch('api/gehege', { method: 'DELETE' });
  setLayout(await res.json());
  statusEl.textContent = 'Beispiel geladen';
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !partsDlg.open) select(null);
});

(async () => {
  resize();
  try {
    const res = await fetch('api/gehege', { cache: 'no-store' });
    setLayout(await res.json());
    statusEl.textContent = 'Geladen';
  } catch (e) {
    setLayout({ pieces: [] });
    statusEl.textContent = 'Konnte nicht laden';
  }
})();
