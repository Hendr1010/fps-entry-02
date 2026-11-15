// bots.js — bot AI: waypoint patrol, hold, line-of-sight vision, bursts of
// fire, investigating gunfire, and defusing the bomb. One job: make the
// opponents (and the allies) move, see and shoot back like a team.

import * as THREE from 'three';
import { collide, losClear } from './world.js';

const SPEED = 3.2;
const ENGAGE_SPEED = 1.4;
const VISION_RANGE = 26;
const VISION_COS = 0.55; // ~57 degree half-cone
const REACT_MIN = 0.35;
const REACT_SPREAD = 0.3;
const BURST = 4;

export function createBot(id, side, spawn, route) {
  return {
    id, side,
    x: spawn.x, z: spawn.z,
    yaw: side === 'them' ? Math.PI / 2 : -Math.PI / 2,
    hp: 100, alive: true,
    state: 'patrol',
    route, wpIdx: Math.floor(Math.random() * route.length),
    holdUntil: 0,
    target: null,
    lastSeen: null,
    loseAt: 0,
    acquireAt: 0,
    burstLeft: 0,
    nextShotAt: 0,
    strafeDir: 1,
    strafeAt: 0,
    investigate: null,
    defuseProgress: 0,
    mesh: null,
  };
}

export function resetBot(b, spawn, route) {
  b.x = spawn.x; b.z = spawn.z;
  b.yaw = b.side === 'them' ? Math.PI / 2 : -Math.PI / 2;
  b.hp = 100; b.alive = true;
  b.state = 'patrol';
  b.route = route; b.wpIdx = 0;
  b.target = null; b.lastSeen = null;
  b.burstLeft = 0; b.defuseProgress = 0;
  b.investigate = null;
}

function angleTo(b, x, z) {
  return Math.atan2(-(x - b.x), -(z - b.z));
}

function turnToward(b, targetYaw, dt) {
  let d = targetYaw - b.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = 5.5 * dt;
  b.yaw += Math.max(-step, Math.min(step, d));
}

function moveToward(b, x, z, speed, dt) {
  const dx = x - b.x, dz = z - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const pos = { x: b.x, z: b.z };
  pos.x += (dx / d) * speed * dt;
  pos.z += (dz / d) * speed * dt;
  collide(pos, 0.42);
  b.x = pos.x; b.z = pos.z;
  turnToward(b, angleTo(b, x, z), dt);
  return d < 0.6;
}

// True when the segment from the bot to the point passes through smoke.
function smokeBlocks(smokes, ax, az, bx, bz) {
  for (const s of smokes) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) continue;
    let t = ((s.x - ax) * dx + (s.z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(s.x - px, s.z - pz);
    if (d < s.r) return true;
  }
  return false;
}

function canSee(b, tx, tz, smokes) {
  const dx = tx - b.x, dz = tz - b.z;
  const d = Math.hypot(dx, dz);
  if (d > VISION_RANGE) return false;
  // Vision cone: forward is (-sin(yaw), -cos(yaw)).
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
  if ((dx * fx + dz * fz) / Math.max(d, 1e-6) < VISION_COS) return false;
  if (!losClear(b.x, b.z, tx, tz)) return false;
  if (smokeBlocks(smokes, b.x, b.z, tx, tz)) return false;
  return true;
}

function hitChance(b, target, dist) {
  let p = 0.5 - dist * 0.014;
  if (target.moving) p -= 0.12;
  if (target.crouch) p -= 0.08;
  return Math.max(0.06, Math.min(0.6, p));
}

export function updateBots(bots, ctx) {
  const { now, dt, rng, smokes } = ctx;
  for (const b of bots) {
    if (!b.alive) continue;

    // --- Defuse duty: a defender walks to the planted bomb and defuses it.
    if (ctx.bomb.state === 'planted' && b.side === 'them' && ctx.defuser === b) {
      const d = Math.hypot(ctx.bomb.x - b.x, ctx.bomb.z - b.z);
      if (d > 1.2) {
        b.state = 'defuse';
        moveToward(b, ctx.bomb.x, ctx.bomb.z, SPEED, dt);
      } else {
        b.state = 'defuse';
        turnToward(b, angleTo(b, ctx.bomb.x, ctx.bomb.z), dt);
        b.defuseProgress += dt / 5;
        if (ctx.onDefuse) ctx.onDefuse(b, b.defuseProgress);
        if (b.defuseProgress >= 1) {
          if (ctx.onDefused) ctx.onDefused(b);
          b.defuseProgress = 0;
        }
      }
      continue;
    }

    // --- Pick a visible foe.
    let seen = null;
    for (const f of ctx.foesOf(b)) {
      if (!f.alive) continue;
      if (canSee(b, f.x, f.z, smokes)) { seen = f; break; }
    }
    if (seen) {
      if (b.target !== seen) {
        b.target = seen;
        b.acquireAt = now + REACT_MIN + rng() * REACT_SPREAD;
        b.burstLeft = 0;
      }
      b.lastSeen = { x: seen.x, z: seen.z, t: now };
      b.loseAt = now + 1.5;
      b.state = 'engage';
    } else if (b.target && now > b.loseAt) {
      b.target = null;
      b.state = 'patrol';
    }

    if (b.state === 'engage' && b.target) {
      const t = b.target;
      if (!t.alive) { b.target = null; b.state = 'patrol'; continue; }
      turnToward(b, angleTo(b, t.x, t.z), dt);
      // Strafe sideways while fighting.
      if (now > b.strafeAt) { b.strafeDir *= -1; b.strafeAt = now + 0.7 + rng() * 0.8; }
      const d = Math.hypot(t.x - b.x, t.z - b.z);
      if (d > 14) {
        moveToward(b, t.x, t.z, ENGAGE_SPEED, dt);
      } else if (d < 5) {
        moveToward(b, b.x - (t.x - b.x), b.z - (t.z - b.z), ENGAGE_SPEED * 0.7, dt);
      } else {
        const px = -Math.cos(b.yaw) * b.strafeDir, pz = Math.sin(b.yaw) * b.strafeDir;
        const pos = { x: b.x, z: b.z };
        pos.x += px * ENGAGE_SPEED * dt;
        pos.z += pz * ENGAGE_SPEED * dt;
        collide(pos, 0.42);
        b.x = pos.x; b.z = pos.z;
      }
      // Fire in bursts after the reaction delay.
      if (now >= b.acquireAt) {
        if (b.burstLeft <= 0) {
          if (now >= b.nextShotAt) { b.burstLeft = BURST; b.nextShotAt = now + 0.9 + rng() * 0.5; }
        } else if (now >= b.nextShotAt) {
          b.nextShotAt = now + 0.13;
          b.burstLeft -= 1;
          const dist = Math.hypot(t.x - b.x, t.z - b.z);
          if (ctx.onBotShot) ctx.onBotShot(b, t);
          if (rng() < hitChance(b, t, dist)) {
            const dmg = 9 + rng() * 5;
            if (ctx.onDamage) ctx.onDamage(t, dmg, b);
          }
        }
      }
      continue;
    }

    // --- Investigate gunfire.
    if (b.investigate && now < b.investigate.until) {
      b.state = 'investigate';
      const done = moveToward(b, b.investigate.x, b.investigate.z, SPEED, dt);
      if (done) b.investigate = null;
      continue;
    }
    b.investigate = null;

    // --- Patrol or hold.
    if (b.state === 'hold' && now < b.holdUntil) {
      turnToward(b, b.yaw + Math.sin(now * 0.5) * 0.4, dt);
      continue;
    }
    b.state = 'patrol';
    const wp = b.route[b.wpIdx % b.route.length];
    const arrived = moveToward(b, wp.x, wp.z, SPEED, dt);
    if (arrived) {
      b.wpIdx = (b.wpIdx + 1) % b.route.length;
      if (rng() < 0.25) { b.state = 'hold'; b.holdUntil = now + 2 + rng() * 2; }
    }
  }
}

// A gunshot was heard at (x, z): nearby bots of the given side investigate.
export function hearShot(bots, side, x, z, now, rng) {
  for (const b of bots) {
    if (!b.alive || b.side !== side || b.state === 'engage') continue;
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < 22) {
      b.investigate = { x: x + (rng() - 0.5) * 2, z: z + (rng() - 0.5) * 2, until: now + 6 };
    }
  }
}

// --- Meshes ---

export function createBotMesh(side) {
  const g = new THREE.Group();
  const bodyColor = side === 'them' ? 0xc0392b : 0x2e6fd8;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.95, 0.36),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85 }),
  );
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xd8b48f, roughness: 0.8 }),
  );
  head.position.y = 1.66;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.5 }),
  );
  visor.position.set(0, 1.68, -0.18);
  g.add(visor);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.12, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 }),
  );
  gun.position.set(0.22, 1.15, -0.4);
  g.add(gun);
  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.9 }),
  );
  legs.position.y = 0.28;
  legs.castShadow = true;
  g.add(legs);
  return g;
}

export function syncBotMesh(b) {
  if (!b.mesh) return;
  b.mesh.position.set(b.x, 0, b.z);
  b.mesh.rotation.y = b.yaw + Math.PI;
  b.mesh.visible = b.alive;
}
