// weapon.js — guns, grenades and hitscan. One job: turn a trigger pull into
// a ray (or a thrown grenade) and report what it hit. Damage numbers,
// spread and recoil live here; who pulls the trigger lives elsewhere.

export const GUNS = {
  rifle: {
    name: 'Rifle', damage: 34, headMult: 3, rpm: 600, mag: 30, reserve: 90,
    reload: 2.2, spread: 0.011, moveSpread: 0.03, recoil: 0.011, auto: true,
    price: 0, pellets: 1, range: 120,
  },
  smg: {
    name: 'SMG', damage: 22, headMult: 3, rpm: 800, mag: 25, reserve: 100,
    reload: 1.8, spread: 0.016, moveSpread: 0.04, recoil: 0.008, auto: true,
    price: 1500, pellets: 1, range: 90,
  },
  shotgun: {
    name: 'Shotgun', damage: 12, headMult: 2, rpm: 70, mag: 6, reserve: 24,
    reload: 2.8, spread: 0.05, moveSpread: 0.06, recoil: 0.05, auto: false,
    price: 2000, pellets: 7, range: 30,
  },
  sniper: {
    name: 'Sniper', damage: 95, headMult: 2, rpm: 45, mag: 5, reserve: 15,
    reload: 3.2, spread: 0.002, moveSpread: 0.08, recoil: 0.06, auto: false,
    price: 4000, pellets: 1, range: 200,
  },
  pistol: {
    name: 'Pistol', damage: 26, headMult: 3, rpm: 350, mag: 12, reserve: 36,
    reload: 1.6, spread: 0.014, moveSpread: 0.035, recoil: 0.012, auto: false,
    price: 0, pellets: 1, range: 60,
  },
};

export function createLoadout() {
  return {
    primary: 'rifle',
    secondary: 'pistol',
    current: 'primary',
    mag: { rifle: 30, smg: 25, shotgun: 6, sniper: 5, pistol: 12 },
    reserve: { rifle: 90, smg: 100, shotgun: 24, sniper: 15, pistol: 36 },
    grenades: { frag: 0, smoke: 0 },
    reloading: null, // {gun, until}
    nextShotAt: 0,
    bloom: 0, // accumulated spread from firing, decays over time
    recoilPitch: 0,
  };
}

export function currentGunKey(loadout) {
  return loadout.current === 'primary' ? loadout.primary : loadout.secondary;
}

export function currentGun(loadout) {
  return GUNS[currentGunKey(loadout)];
}

export function switchSlot(loadout, slot) {
  if (loadout.reloading) return false;
  if (slot !== 'primary' && slot !== 'secondary') return false;
  loadout.current = slot;
  return true;
}

export function giveGun(loadout, key) {
  loadout.primary = key;
  loadout.current = 'primary';
  loadout.mag[key] = GUNS[key].mag;
  if (loadout.reserve[key] === undefined || loadout.reserve[key] < GUNS[key].reserve) {
    loadout.reserve[key] = GUNS[key].reserve;
  }
  loadout.reloading = null;
}

export function refillAmmo(loadout) {
  const key = currentGunKey(loadout);
  loadout.reserve[key] = GUNS[key].reserve * 2;
  loadout.reserve[loadout.primary] = GUNS[loadout.primary].reserve * 2;
  loadout.reserve[loadout.secondary] = GUNS[loadout.secondary].reserve * 2;
}

// Ray vs sphere. Returns distance along the ray, or null.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  return t >= 0 ? t : tca + thc;
}

// Find the nearest bot a ray hits. targets: [{x, z, hp, alive}].
// Returns {target, part: 'head'|'body', dist} or null.
export function rayHitTarget(ox, oy, oz, dx, dy, dz, targets, maxDist) {
  let best = null;
  for (const t of targets) {
    if (!t.alive) continue;
    const th = raySphere(ox, oy, oz, dx, dy, dz, t.x, 1.62, t.z, 0.28);
    if (th !== null && th <= maxDist && (best === null || th < best.dist)) {
      best = { target: t, part: 'head', dist: th };
    }
    const tb = raySphere(ox, oy, oz, dx, dy, dz, t.x, 1.0, t.z, 0.55);
    if (tb !== null && tb <= maxDist && (best === null || tb < best.dist)) {
      best = { target: t, part: 'body', dist: tb };
    }
  }
  return best;
}

// Fire one trigger pull. ctx: {ox, oy, oz, dir:{x,y,z}, moving, crouch, now,
// targets, rng, onHit(target, part, damage), onKill(target)}.
// Returns 'fired' | 'empty' | 'cooldown' | 'reloading'.
export function tryFire(loadout, ctx) {
  if (loadout.reloading) return 'reloading';
  if (ctx.now < loadout.nextShotAt) return 'cooldown';
  const key = currentGunKey(loadout);
  const gun = GUNS[key];
  if (loadout.mag[key] <= 0) return 'empty';
  loadout.mag[key] -= 1;
  loadout.nextShotAt = ctx.now + 60 / gun.rpm;

  // Spread: base + bloom + movement, less when crouched.
  let spread = gun.spread + loadout.bloom;
  if (ctx.moving) spread += gun.moveSpread;
  if (ctx.crouch) spread *= 0.6;
  loadout.bloom = Math.min(0.05, loadout.bloom + gun.recoil * 0.9);
  loadout.recoilPitch += gun.recoil;

  for (let p = 0; p < gun.pellets; p++) {
    const dx = ctx.dir.x + (ctx.rng() * 2 - 1) * spread;
    const dy = ctx.dir.y + (ctx.rng() * 2 - 1) * spread;
    const dz = ctx.dir.z + (ctx.rng() * 2 - 1) * spread;
    const len = Math.hypot(dx, dy, dz);
    const hit = rayHitTarget(ctx.ox, ctx.oy, ctx.oz, dx / len, dy / len, dz / len, ctx.targets, gun.range);
    if (hit) {
      const dmg = gun.damage * (hit.part === 'head' ? gun.headMult : 1);
      ctx.onHit(hit.target, hit.part, dmg, hit.dist);
      if (hit.target.hp <= 0) ctx.onKill(hit.target);
    }
  }
  return 'fired';
}

export function startReload(loadout, now) {
  if (loadout.reloading) return false;
  const key = currentGunKey(loadout);
  const gun = GUNS[key];
  if (loadout.mag[key] >= gun.mag || loadout.reserve[key] <= 0) return false;
  loadout.reloading = { gun: key, until: now + gun.reload };
  return true;
}

// Complete reloads whose time has come. Returns the gun key that finished, or null.
export function updateWeapon(loadout, now, dt) {
  loadout.bloom = Math.max(0, loadout.bloom - dt * 0.06);
  loadout.recoilPitch *= Math.max(0, 1 - dt * 6);
  if (loadout.reloading && now >= loadout.reloading.until) {
    const key = loadout.reloading.gun;
    const gun = GUNS[key];
    const need = gun.mag - loadout.mag[key];
    const take = Math.min(need, loadout.reserve[key]);
    loadout.mag[key] += take;
    loadout.reserve[key] -= take;
    loadout.reloading = null;
    return key;
  }
  return null;
}

// --- Grenades ---

export function throwGrenade(loadout, kind, from, dir, now) {
  if (loadout.grenades[kind] <= 0) return null;
  loadout.grenades[kind] -= 1;
  return {
    kind,
    x: from.x, y: from.y, z: from.z,
    vx: dir.x * 14, vy: dir.y * 14 + 3.5, vz: dir.z * 14,
    fuse: kind === 'frag' ? 2.2 : 1.2,
    landed: false,
  };
}

// Step grenades: gravity, ground bounce, wall slide. Calls onDetonate(g)
// when a frag fuse runs out, onLand(g) when a smoke lands. Returns nothing;
// dead grenades are removed in place.
export function updateGrenades(list, dt, onDetonate, onLand) {
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.vy -= 12 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.15) {
      g.y = 0.15;
      g.vy = Math.abs(g.vy) > 1 ? -g.vy * 0.35 : 0;
      g.vx *= 0.7; g.vz *= 0.7;
      if (!g.landed) { g.landed = true; if (g.kind === 'smoke' && onLand) onLand(g); }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      list.splice(i, 1);
      if (g.kind === 'frag' && onDetonate) onDetonate(g);
    }
  }
}
