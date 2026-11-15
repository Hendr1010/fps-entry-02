// player.js — the human player: first-person movement with acceleration,
// friction, crouch, jump and gravity, plus mouse look. One job: turn input
// into a moving body that collides with the map. Combat lives in weapon.js.

import { collide } from './world.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.15;
export const RADIUS = 0.42;

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const ACCEL = 42;
const FRICTION = 11;
const JUMP_VEL = 5.4;
const GRAVITY = 14.5;

export function createPlayer(spawn) {
  return {
    x: spawn.x, z: spawn.z,
    vx: 0, vz: 0,
    y: 0, vy: 0,
    yaw: -Math.PI / 2, // face east, down the mid lane toward Site A
    pitch: 0,
    hp: 100,
    alive: true,
    crouch: false,
    onGround: true,
    moving: false,
    speed2d: 0,
    kevlar: false,
  };
}

export function resetPlayer(p, spawn) {
  p.x = spawn.x; p.z = spawn.z;
  p.vx = 0; p.vz = 0; p.y = 0; p.vy = 0;
  p.yaw = -Math.PI / 2; p.pitch = 0;
  p.hp = 100; p.alive = true;
  p.crouch = false; p.onGround = true;
}

// input: {f, b, l, r, jump, crouch} booleans. dt is the fixed step (1/60).
export function updatePlayer(p, input, dt) {
  if (!p.alive) return;
  p.crouch = !!input.crouch;

  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // Forward is (sin(yaw), cos(yaw)) in XZ when yaw=0 faces +Z; we keep the
  // camera's convention: forward = (-sin(yaw), -cos(yaw)) for three.js.
  let fx = -sin, fz = -cos;
  let rx = cos, rz = -sin;
  let mx = 0, mz = 0;
  if (input.f) { mx += fx; mz += fz; }
  if (input.b) { mx -= fx; mz -= fz; }
  if (input.r) { mx += rx; mz += rz; }
  if (input.l) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }

  const target = p.crouch ? CROUCH_SPEED : WALK_SPEED;
  p.vx += mx * ACCEL * dt;
  p.vz += mz * ACCEL * dt;
  // Friction pulls velocity toward zero when no input, and caps speed.
  const fr = Math.max(0, 1 - FRICTION * dt);
  if (len === 0) { p.vx *= fr; p.vz *= fr; }
  const sp = Math.hypot(p.vx, p.vz);
  const max = len > 0 ? target : target;
  if (sp > max) { p.vx = (p.vx / sp) * max; p.vz = (p.vz / sp) * max; }
  p.speed2d = Math.hypot(p.vx, p.vz);
  p.moving = p.speed2d > 0.4;

  const pos = { x: p.x, z: p.z };
  pos.x += p.vx * dt;
  pos.z += p.vz * dt;
  collide(pos, RADIUS);
  p.x = pos.x; p.z = pos.z;

  if (input.jump && p.onGround && !p.crouch) {
    p.vy = JUMP_VEL;
    p.onGround = false;
  }
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
}

export function eyeHeight(p) {
  return (p.crouch ? EYE_CROUCH : EYE_STAND) + p.y;
}

// Apply damage, honouring kevlar. Returns the damage actually taken.
export function damagePlayer(p, amount) {
  if (!p.alive) return 0;
  const taken = p.kevlar ? amount * 0.65 : amount;
  p.hp -= taken;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; }
  return taken;
}
