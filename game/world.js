// world.js — DUSKLINE's map: a desert-industrial yard at dusk, 36 x 28 m.
// Three lanes (north, mid corridor, south) run west to east; the mid building
// sits in the centre with a doorway corridor through it; Site A is in the
// north-east. One job: the map's shape, its collision, its sightlines and
// its look. No game logic lives here.

import * as THREE from 'three';

export const MAP = { x0: -18, x1: 18, z0: -14, z1: 14 };

// Axis-aligned colliders: {x0, z0, x1, z1, h}. h >= 2 blocks sight;
// lower crates block movement only.
export const COLLIDERS = [
  // Perimeter walls.
  { x0: -18.5, z0: -14.5, x1: 18.5, z1: -14, h: 4 },
  { x0: -18.5, z0: 14, x1: 18.5, z1: 14.5, h: 4 },
  { x0: -18.5, z0: -14, x1: -18, z1: 14, h: 4 },
  { x0: 18, z0: -14, x1: 18.5, z1: 14, h: 4 },
  // Mid building: two blocks with a 2 m corridor through the middle (z -1..1).
  { x0: -4, z0: -3, x1: 4, z1: -1, h: 3.5 },
  { x0: -4, z0: 1, x1: 4, z1: 3, h: 3.5 },
  // Cover crates.
  { x0: -11, z0: -9, x1: -9, z1: -7, h: 1.2 },
  { x0: -11, z0: 5, x1: -9, z1: 7, h: 1.2 },
  { x0: 7, z0: 7, x1: 9, z1: 9, h: 1.2 },
  { x0: 5.25, z0: -6.75, x1: 6.75, z1: -5.25, h: 1.2 },
  { x0: -3, z0: -9.75, x1: -1, z1: -8.25, h: 1.2 },
  { x0: 11, z0: 1, x1: 13, z1: 3, h: 1.2 },
  { x0: -14.75, z0: -2.75, x1: -13.25, z1: -1.25, h: 1.2 },
  { x0: -1, z0: 9, x1: 1, z1: 11, h: 1.2 },
  // Site A pillars.
  { x0: 9.6, z0: -8.4, x1: 10.4, z1: -7.6, h: 3 },
  { x0: 15.2, z0: -12.4, x1: 16, z1: -11.6, h: 3 },
];

export const SITE_A = { x0: 10, z0: -13, x1: 16, z1: -7, cx: 13, cz: -10 };

export const SPAWNS = {
  us: [
    { x: -16, z: 11 },
    { x: -15, z: 8.5 },
    { x: -16, z: 6.5 },
  ],
  them: [
    { x: 14, z: -11 },
    { x: 12, z: -8 },
    { x: 15, z: -9 },
    { x: 10.5, z: -12 },
  ],
};

// Patrol routes: north lane, mid corridor, south lane, site hold points.
export const WAYPOINTS = {
  north: [
    { x: -14, z: -10 }, { x: -6, z: -10 }, { x: 2, z: -10 },
    { x: 10, z: -10 }, { x: 14, z: -10 },
  ],
  mid: [
    { x: -14, z: 0 }, { x: -6, z: 0 }, { x: 0, z: 0 },
    { x: 6, z: 0 }, { x: 12, z: 0 },
  ],
  south: [
    { x: -14, z: 10 }, { x: -6, z: 10 }, { x: 2, z: 10 },
    { x: 10, z: 10 }, { x: 14, z: 10 },
  ],
  site: [
    { x: 11, z: -9 }, { x: 14, z: -11 }, { x: 12, z: -8 }, { x: 15, z: -12 },
  ],
};

export function inSiteA(x, z) {
  return x >= SITE_A.x0 && x <= SITE_A.x1 && z >= SITE_A.z0 && z <= SITE_A.z1;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Push a circle (pos {x, z}, radius r) out of every collider it overlaps.
export function collide(pos, r) {
  for (const c of COLLIDERS) {
    const cx = clamp(pos.x, c.x0, c.x1);
    const cz = clamp(pos.z, c.z0, c.z1);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * r;
      pos.z = cz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = pos.x - c.x0, pr = c.x1 - pos.x;
      const pt = pos.z - c.z0, pb = c.z1 - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = c.x0 - r;
      else if (m === pr) pos.x = c.x1 + r;
      else if (m === pt) pos.z = c.z0 - r;
      else pos.z = c.z1 + r;
    }
  }
  // Keep inside the yard.
  pos.x = clamp(pos.x, MAP.x0 + r, MAP.x1 - r);
  pos.z = clamp(pos.z, MAP.z0 + r, MAP.z1 - r);
}

// Segment vs AABB (slab method) in the XZ plane.
function segmentHitsBox(ax, az, bx, bz, c) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < c.x0 || ax > c.x1) return false;
  } else {
    let ta = (c.x0 - ax) / dx, tb = (c.x1 - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < c.z0 || az > c.z1) return false;
  } else {
    let ta = (c.z0 - az) / dz, tb = (c.z1 - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// True when no tall wall stands between the two points. Low crates do not
// block sight. Smoke is handled by the caller, not here.
export function losClear(ax, az, bx, bz) {
  for (const c of COLLIDERS) {
    if (c.h < 2) continue;
    if (segmentHitsBox(ax, az, bx, bz, c)) return false;
  }
  return true;
}

const PALETTE = {
  sand: 0xb98a56,
  sandDark: 0x9a744a,
  rust: 0x85604a,
  rustDark: 0x6b4a3a,
  metal: 0x5d4a66,
  metalLight: 0x6e5a78,
  amber: 0xffb347,
  amberGlow: 0xff9a1f,
};

function box(w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    }),
  );
  m.position.set(x, y, z);
  if (opts.shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
  return m;
}

export function createWorld(scene) {
  scene.background = new THREE.Color(0x2a1e4a);
  scene.fog = new THREE.Fog(0x2a1e4a, 30, 85);

  const hemi = new THREE.HemisphereLight(0x8a6fd0, 0x8a6a44, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb347, 1.6);
  sun.position.set(-20, 26, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  const siteLight = new THREE.PointLight(0xff9a1f, 60, 22, 1.8);
  siteLight.position.set(SITE_A.cx, 4, SITE_A.cz);
  scene.add(siteLight);
  const midLight = new THREE.PointLight(0xffb347, 30, 16, 1.8);
  midLight.position.set(0, 3.5, 0);
  scene.add(midLight);

  // Ground: sand with darker patches.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(38, 30),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const patchMat = new THREE.MeshStandardMaterial({ color: PALETTE.sandDark, roughness: 1 });
  const patches = [
    [-12, -6, 7, 5], [6, 4, 8, 4], [-4, 11, 6, 3], [12, -4, 5, 6], [-14, 2, 4, 4],
  ];
  for (const [x, z, w, d] of patches) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), patchMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.01, z);
    p.receiveShadow = true;
    scene.add(p);
  }

  // Perimeter walls.
  scene.add(box(37.5, 4, 0.5, PALETTE.rust, 0, 2, -14.25));
  scene.add(box(37.5, 4, 0.5, PALETTE.rust, 0, 2, 14.25));
  scene.add(box(0.5, 4, 29, PALETTE.rust, -18.25, 2, 0));
  scene.add(box(0.5, 4, 29, PALETTE.rust, 18.25, 2, 0));

  // Mid building: two blocks, corridor between them, amber trim on top.
  scene.add(box(8, 3.5, 2, PALETTE.metal, 0, 1.75, -2));
  scene.add(box(8, 3.5, 2, PALETTE.metal, 0, 1.75, 2));
  scene.add(box(8.2, 0.25, 2.2, PALETTE.metalLight, 0, 3.6, -2));
  scene.add(box(8.2, 0.25, 2.2, PALETTE.metalLight, 0, 3.6, 2));
  scene.add(box(8.2, 0.12, 0.12, PALETTE.amber, 0, 3.35, -1, { emissive: PALETTE.amberGlow, emissiveIntensity: 1.6, shadow: false }));
  scene.add(box(8.2, 0.12, 0.12, PALETTE.amber, 0, 3.35, 1, { emissive: PALETTE.amberGlow, emissiveIntensity: 1.6, shadow: false }));

  // Crates.
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.95 });
  const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x5d6b52, roughness: 0.95 });
  let ci = 0;
  for (const c of COLLIDERS) {
    if (c.h >= 2) continue;
    const w = c.x1 - c.x0, d = c.z1 - c.z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, c.h, d), ci % 2 ? crateMat : crateMat2);
    m.position.set((c.x0 + c.x1) / 2, c.h / 2, (c.z0 + c.z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    ci++;
  }

  // Site A pillars.
  scene.add(box(0.8, 3, 0.8, PALETTE.rustDark, 10, 1.5, -8));
  scene.add(box(0.8, 3, 0.8, PALETTE.rustDark, 15.6, 1.5, -12));

  // Site A pad: amber border on the ground + beacon mast.
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(SITE_A.x1 - SITE_A.x0, SITE_A.z1 - SITE_A.z0),
    new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.85, emissive: 0x664411, emissiveIntensity: 0.5 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(SITE_A.cx, 0.02, SITE_A.cz);
  pad.receiveShadow = true;
  scene.add(pad);
  const borderMat = new THREE.MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amberGlow, emissiveIntensity: 1.8 });
  const bw = SITE_A.x1 - SITE_A.x0, bd = SITE_A.z1 - SITE_A.z0;
  for (const [w, d, x, z] of [
    [bw, 0.15, SITE_A.cx, SITE_A.z0 + 0.07], [bw, 0.15, SITE_A.cx, SITE_A.z1 - 0.07],
    [0.15, bd, SITE_A.x0 + 0.07, SITE_A.cz], [0.15, bd, SITE_A.x1 - 0.07, SITE_A.cz],
  ]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), borderMat);
    b.position.set(x, 0.04, z);
    scene.add(b);
  }
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 5, 8),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.6 }),
  );
  mast.position.set(SITE_A.cx, 2.5, SITE_A.cz);
  mast.castShadow = true;
  scene.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amberGlow, emissiveIntensity: 3 }),
  );
  beacon.position.set(SITE_A.cx, 5.1, SITE_A.cz);
  scene.add(beacon);

  // A few rusted barrels for colour.
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.8, metalness: 0.3 });
  for (const [x, z] of [[-7, 12], [16, 6], [-16, -12], [4, -11]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12), barrelMat);
    b.position.set(x, 0.55, z);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
  }

  return { colliders: COLLIDERS };
}
