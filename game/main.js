// main.js — DUSKLINE bootstrap and game loop. One job: wire every module
// together, run the fixed 60 Hz simulation apart from rendering, and own
// input, the camera, the bomb carrier and the deterministic screenshot modes.

import * as THREE from 'three';
import { createWorld, SITE_A, SPAWNS, WAYPOINTS, inSiteA } from './world.js';
import { createPlayer, updatePlayer, damagePlayer, eyeHeight, resetPlayer } from './player.js';
import {
  GUNS, createLoadout, currentGun, currentGunKey, tryFire, startReload,
  updateWeapon, throwGrenade, updateGrenades, switchSlot,
} from './weapon.js';
import { createBot, resetBot, updateBots, hearShot, createBotMesh, syncBotMesh } from './bots.js';
import {
  createRounds, updateRounds, plantBomb, defuseBomb, explodeBomb,
  PLANT_TIME,
} from './rounds.js';
import { createEconomy, buy, reward, SHOP } from './economy.js';
import {
  createHUD, updateHUD, showBanner, hideBanner, addKillfeed, showHitmarker,
  flashDamage, setBombBar, setBuyOpen, setMenuVisible,
} from './hud.js';
import { createSound, unlockSound, playSound } from './sound.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | tactic | end
const SEED = parseInt(params.get('seed') || '1', 10) || 1;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- State (one place) ---
const rng = mulberry32(SEED);
const state = {
  now: 0,
  tick: 0,
  started: false,
  buyOpen: false,
  firing: false,
  grenadeKind: 'frag',
  planting: 0,
  kills: 0,
  lastStepAt: 0,
  frames: 0,
};

const player = createPlayer(SPAWNS.us[0]);
const loadout = createLoadout();
const economy = createEconomy();
const rounds = createRounds();
const sound = createSound();

const allies = [
  createBot('ally-vega', 'us', SPAWNS.us[1], WAYPOINTS.south),
  createBot('ally-orion', 'us', SPAWNS.us[2], WAYPOINTS.mid),
];
const enemies = [
  createBot('sen-1', 'them', SPAWNS.them[0], WAYPOINTS.north),
  createBot('sen-2', 'them', SPAWNS.them[1], WAYPOINTS.site),
  createBot('sen-3', 'them', SPAWNS.them[2], WAYPOINTS.mid),
  createBot('sen-4', 'them', SPAWNS.them[3], WAYPOINTS.south),
];
const ALLY_NAMES = { 'ally-vega': 'Vega', 'ally-orion': 'Orion' };
const ENEMY_NAMES = { 'sen-1': 'Sentinel 1', 'sen-2': 'Sentinel 2', 'sen-3': 'Sentinel 3', 'sen-4': 'Sentinel 4' };
const grenades = [];
const smokes = [];

// --- Three.js setup ---
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
createWorld(scene);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Weapon viewmodel: a gun at the lower right of the camera.
const viewmodel = new THREE.Group();
const vmBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.07, 0.1, 0.48),
  new THREE.MeshStandardMaterial({ color: 0x7d828c, roughness: 0.45, metalness: 0.55 }),
);
vmBody.position.set(0.26, -0.26, -0.55);
viewmodel.add(vmBody);
const vmBarrel = new THREE.Mesh(
  new THREE.BoxGeometry(0.04, 0.04, 0.28),
  new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.4, metalness: 0.6 }),
);
vmBarrel.position.set(0.26, -0.23, -0.82);
viewmodel.add(vmBarrel);
const muzzle = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, side: THREE.DoubleSide }),
);
muzzle.position.set(0.28, -0.21, -1.02);
viewmodel.add(muzzle);
camera.add(viewmodel);

// Tracer line from the muzzle to the hit point.
const tracerGeo = new THREE.BufferGeometry();
tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
tracer.frustumCulled = false;
scene.add(tracer);
let tracerUntil = 0;

// Bot meshes.
for (const b of [...allies, ...enemies]) {
  b.mesh = createBotMesh(b.side);
  scene.add(b.mesh);
}

// Bomb mesh (shown when planted).
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.25, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }),
);
bombBox.position.y = 0.13;
bombMesh.add(bombBox);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 8),
  new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 3 }),
);
bombLight.position.set(0.12, 0.3, 0);
bombMesh.add(bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// Smoke clouds.
const smokeMeshes = new Map();
function addSmokeMesh(s) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(s.r, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xbbbbc4, roughness: 1, transparent: true, opacity: 0.55 }),
  );
  m.position.set(s.x, 1.2, s.z);
  scene.add(m);
  smokeMeshes.set(s, m);
}
function removeSmokeMesh(s) {
  const m = smokeMeshes.get(s);
  if (m) { scene.remove(m); smokeMeshes.delete(s); }
}

const hud = createHUD();

// --- Input ---
const keys = {};
let pointerLocked = false;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyB' && rounds.phase === 'buy' && state.started) {
    state.buyOpen = !state.buyOpen;
    setBuyOpen(hud, state.buyOpen, economy);
  }
  if (state.buyOpen && /^Digit[1-7]$/.test(e.code)) {
    const item = SHOP[parseInt(e.code.slice(5), 10) - 1];
    if (item) {
      const res = buy(economy, item, loadout, player);
      if (res.ok) { playSound(sound, 'buy'); setBuyOpen(hud, true, economy); }
    }
  }
  if (e.code === 'KeyR' && state.started) {
    if (startReload(loadout, state.now)) playSound(sound, 'reload');
  }
  if (e.code === 'Digit1' && !state.buyOpen) switchSlot(loadout, 'primary');
  if (e.code === 'Digit2' && !state.buyOpen) switchSlot(loadout, 'secondary');
  if (e.code === 'KeyG' && state.started && player.alive) {
    const kind = loadout.grenades.frag > 0 ? 'frag' : 'smoke';
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const g = throwGrenade(loadout, kind, { x: player.x, y: eyeHeight(player), z: player.z }, dir, state.now);
    if (g) { grenades.push(g); playSound(sound, 'shot', { low: true }); }
  }
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  if (!state.started || !pointerLocked) return;
  if (e.button === 0) {
    // Automatic weapons fire while held; semi-automatic fire once per click.
    if (currentGun(loadout).auto) {
      state.firing = true;
    } else {
      firePlayerWeapon();
    }
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) state.firing = false;
});
addEventListener('mousemove', (e) => {
  if (!pointerLocked || !state.started) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch -= e.movementY * 0.0021;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked && state.started && !SHOT) {
    // Paused when the pointer is released outside a shot mode.
    state.started = false;
    setMenuVisible(hud, true);
  }
});
document.getElementById('play').addEventListener('click', () => {
  unlockSound(sound);
  renderer.domElement.requestPointerLock();
  state.started = true;
  setMenuVisible(hud, false);
  hideBanner(hud);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function inputState() {
  return {
    f: !!keys['KeyW'], b: !!keys['KeyS'],
    l: !!keys['KeyA'], r: !!keys['KeyD'],
    jump: !!keys['Space'], crouch: !!keys['ControlLeft'] || !!keys['ControlRight'],
  };
}

// --- Combat callbacks ---

function foesOf(bot) {
  if (bot.side === 'them') {
    const list = [];
    if (player.alive) list.push(player);
    for (const a of allies) if (a.alive) list.push(a);
    return list;
  }
  return enemies.filter((e) => e.alive);
}

function botDisplayName(b) {
  return b.side === 'us' ? ALLY_NAMES[b.id] : ENEMY_NAMES[b.id];
}

function applyDamageToBot(bot, dmg, attackerName, attackerSide) {
  if (!bot.alive) return;
  bot.hp -= dmg;
  if (bot.hp <= 0) {
    bot.hp = 0;
    bot.alive = false;
    syncBotMesh(bot);
    addKillfeed(hud, attackerName, botDisplayName(bot), attackerSide);
    if (attackerSide === 'us' && attackerName === 'You') {
      state.kills += 1;
      reward(economy, 'kill');
    }
  }
}

function onPlayerHit(target, part, dmg) {
  applyDamageToBot(target, dmg, 'You', 'us');
  showHitmarker(hud, target.hp <= 0, state.now);
  playSound(sound, target.hp <= 0 ? 'kill' : 'hit');
}

function onPlayerKill() {
  // Kill feed and reward are handled in applyDamageToBot.
}

function firePlayerWeapon() {
  if (!player.alive || rounds.phase === 'buy' || rounds.phase === 'end' || rounds.phase === 'match') return;
  const gun = currentGun(loadout);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const res = tryFire(loadout, {
    ox: player.x, oy: eyeHeight(player), oz: player.z,
    dir, moving: player.moving, crouch: player.crouch,
    now: state.now, targets: enemies, rng,
    onHit: onPlayerHit,
    onKill: onPlayerKill,
  });
  if (res === 'fired') {
    const snd = currentGunKey(loadout) === 'sniper' ? 'sniper' : currentGunKey(loadout) === 'shotgun' ? 'shotgun' : 'shot';
    playSound(sound, snd);
    muzzle.material.opacity = 0.9;
    // Tracer to the first wall or 60 m out.
    const start = new THREE.Vector3(player.x, eyeHeight(player) - 0.12, player.z);
    const end = start.clone().add(dir.clone().multiplyScalar(60));
    const pos = tracerGeo.attributes.position;
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    tracer.material.opacity = 0.85;
    tracerUntil = state.now + 0.06;
    hearShot(enemies, 'them', player.x, player.z, state.now, rng);
    hearShot(allies, 'us', player.x, player.z, state.now, rng);
  } else if (res === 'empty') {
    playSound(sound, 'dry');
    if (startReload(loadout, state.now)) playSound(sound, 'reload');
  }
}

// --- Round callbacks ---

function resetPositions() {
  resetPlayer(player, SPAWNS.us[0]);
  resetBot(allies[0], SPAWNS.us[1], WAYPOINTS.south);
  resetBot(allies[1], SPAWNS.us[2], WAYPOINTS.mid);
  resetBot(enemies[0], SPAWNS.them[0], WAYPOINTS.north);
  resetBot(enemies[1], SPAWNS.them[1], WAYPOINTS.site);
  resetBot(enemies[2], SPAWNS.them[2], WAYPOINTS.mid);
  resetBot(enemies[3], SPAWNS.them[3], WAYPOINTS.south);
  for (const b of [...allies, ...enemies]) syncBotMesh(b);
  grenades.length = 0;
  for (const s of [...smokes]) removeSmokeMesh(s);
  smokes.length = 0;
  bombMesh.visible = false;
  state.planting = 0;
  setBombBar(hud, false);
  // Fresh mags each round; reserves stay as they are.
  for (const k of ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) {
    if (loadout.mag[k] !== undefined) loadout.mag[k] = GUNS[k].mag;
  }
  loadout.reloading = null;
}

function onRoundEnd(winner, reason) {
  if (winner === 'us') {
    reward(economy, 'win');
    playSound(sound, 'win');
    showBanner(hud, 'ROUND WON', reason, 'win');
  } else {
    reward(economy, 'loss');
    playSound(sound, 'lose');
    showBanner(hud, 'ROUND LOST', reason, 'lose');
  }
  state.buyOpen = false;
  setBuyOpen(hud, false, economy);
  if (rounds.matchWinner) {
    showBanner(
      hud,
      rounds.matchWinner === 'us' ? 'VICTORY' : 'DEFEAT',
      rounds.matchWinner === 'us' ? 'DUSKLINE is yours. First to 5.' : 'The Sentinels take the yard.',
      rounds.matchWinner === 'us' ? 'win' : 'lose',
    );
  }
}

// --- Fixed-step update (60 Hz) ---

function step(dt) {
  state.now += dt;
  state.tick += 1;

  // Player movement (only while a round is live and the player is up).
  const canMove = state.started && player.alive && (rounds.phase === 'buy' || rounds.phase === 'live' || rounds.phase === 'planted');
  if (canMove) updatePlayer(player, inputState(), dt);

  // Firing (hold to fire automatic weapons).
  if (state.firing && canMove && currentGun(loadout).auto) {
    firePlayerWeapon();
  }

  // Reload completion.
  const done = updateWeapon(loadout, state.now, dt);
  if (done) playSound(sound, 'reload');

  // Planting: hold E inside Site A while the round is live.
  if (state.started && player.alive && rounds.phase === 'live' && keys['KeyE'] && inSiteA(player.x, player.z)) {
    state.planting += dt / PLANT_TIME;
    setBombBar(hud, true, 'Planting the bomb…', Math.min(1, state.planting));
    if (state.planting >= 1) {
      plantBomb(rounds, player.x, player.z, {
        onPlant: () => {
          reward(economy, 'plant');
          playSound(sound, 'plant');
          bombMesh.position.set(player.x, 0, player.z);
          bombMesh.visible = true;
        },
      });
      state.planting = 0;
      setBombBar(hud, false);
    }
  } else if (state.planting > 0) {
    state.planting = Math.max(0, state.planting - dt / PLANT_TIME);
    setBombBar(hud, state.planting > 0, 'Planting the bomb…', state.planting);
    if (state.planting === 0) setBombBar(hud, false);
  }

  // Grenades.
  updateGrenades(
    grenades, dt,
    (g) => {
      playSound(sound, 'explosion');
      const victims = [player, ...allies, ...enemies];
      for (const v of victims) {
        if (!v.alive) continue;
        const d = Math.hypot(v.x - g.x, v.z - g.z);
        if (d < 6) {
          const dmg = Math.round(70 * (1 - d / 6) + 10);
          if (v === player) {
            damagePlayer(player, dmg);
            flashDamage(hud, state.now);
            playSound(sound, 'hurt');
          } else {
            applyDamageToBot(v, dmg, 'You', 'us');
          }
        }
      }
    },
    (g) => {
      const s = { x: g.x, z: g.z, r: 3.5, until: state.now + 12 };
      smokes.push(s);
      addSmokeMesh(s);
    },
  );
  // Smoke expiry.
  for (let i = smokes.length - 1; i >= 0; i--) {
    if (state.now > smokes[i].until) {
      removeSmokeMesh(smokes[i]);
      smokes.splice(i, 1);
    }
  }

  // Bots fight only while a round is live or the bomb is planted;
  // the buy phase is freeze time and the end phase is a ceasefire.
  const botsLive = rounds.phase === 'live' || rounds.phase === 'planted';
  if (botsLive) {
  const defuser = rounds.bomb.state === 'planted'
    ? [...enemies].filter((e) => e.alive).sort((a, b) =>
        Math.hypot(a.x - rounds.bomb.x, a.z - rounds.bomb.z) - Math.hypot(b.x - rounds.bomb.x, b.z - rounds.bomb.z))[0] || null
    : null;
  updateBots([...allies, ...enemies], {
    now: state.now, dt, rng, smokes,
    bomb: rounds.bomb,
    defuser,
    foesOf,
    onBotShot: (b) => playSound(sound, 'shot', { low: true }),
    onDamage: (victim, dmg, attacker) => {
      if (victim === player) {
        damagePlayer(player, dmg);
        flashDamage(hud, state.now);
        playSound(sound, 'hurt');
        if (!player.alive) {
          addKillfeed(hud, botDisplayName(attacker), 'You', attacker.side);
        }
      } else {
        const before = victim.hp;
        victim.hp -= dmg;
        if (victim.hp <= 0 && before > 0) {
          victim.hp = 0;
          victim.alive = false;
          syncBotMesh(victim);
          addKillfeed(hud, botDisplayName(attacker), botDisplayName(victim), attacker.side);
        }
      }
    },
    onDefuse: (b, progress) => {
      setBombBar(hud, true, 'Sentinel defusing…', progress);
    },
    onDefused: () => {
      setBombBar(hud, false);
      bombMesh.visible = false;
      defuseBomb(rounds, { onRoundEnd });
      playSound(sound, 'lose');
    },
  });
  }

  // Rounds.
  updateRounds(rounds, {
    playerAlive: player.alive,
    alliesAlive: allies.some((a) => a.alive),
    enemiesAlive: enemies.some((e) => e.alive),
    onRoundEnd,
    onPhase: (phase) => {
      if (phase === 'buy') {
        resetPositions();
        hideBanner(hud);
      }
      if (phase === 'live') hideBanner(hud);
    },
    onMatchEnd: () => { state.buyOpen = false; setBuyOpen(hud, false, economy); },
  }, dt);

  // Bomb fuse beep.
  if (rounds.phase === 'planted' && Math.floor(state.now * 2) !== Math.floor((state.now - dt) * 2)) {
    playSound(sound, 'beep');
  }

  // Fade the muzzle flash and tracer.
  muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 18);
  if (state.now > tracerUntil) tracer.material.opacity = 0;

  // Sync bot meshes.
  for (const b of [...allies, ...enemies]) syncBotMesh(b);

  updateHUD(hud, { player, loadout, rounds, economy, now: state.now });
}

// --- Render ---

function render() {
  camera.position.set(player.x, eyeHeight(player), player.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch + loadout.recoilPitch;
  // Viewmodel kick on fire.
  viewmodel.position.z = -loadout.recoilPitch * 0.6;
  renderer.render(scene, camera);
}

// --- Main loop ---

let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function loop(t) {
  requestAnimationFrame(loop);
  const frameDt = Math.min(0.1, (t - last) / 1000);
  last = t;
  acc += frameDt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    step(STEP);
    acc -= STEP;
    n += 1;
  }
  if (n === 5) acc = 0;
  render();
  state.frames += 1;
  if (SHOT && state.frames === 2) {
    window.__shotReady = true;
  }
}

// --- Screenshot modes (deterministic, seed=1) ---

function setupShot(mode) {
  state.started = true;
  setMenuVisible(hud, false);
  resetPositions();
  if (mode === 'start') {
    // Spawn view down the mid lane, allies beside the player.
    player.yaw = -Math.PI / 2;
    player.pitch = 0;
    enemies[0].x = -2; enemies[0].z = -8;
    enemies[1].x = 6; enemies[1].z = -9;
    enemies[2].x = 2; enemies[2].z = 6;
    for (const b of enemies) b.yaw = Math.PI / 2;
    rounds.phase = 'buy';
    rounds.timer = 15;
  } else if (mode === 'play') {
    // Mid-round firefight in the open west yard: three Sentinels in view.
    player.x = -12; player.z = 4;
    player.yaw = -Math.PI / 2 - 0.35;
    player.pitch = 0.02;
    player.hp = 67;
    enemies[0].x = -6; enemies[0].z = -6;
    enemies[1].x = 0; enemies[1].z = 7;
    enemies[2].x = 3; enemies[2].z = -7;
    enemies[3].x = 7; enemies[3].z = 3;
    for (const b of enemies) { b.yaw = Math.PI / 2; b.state = 'engage'; b.target = player; }
    allies[0].x = -13; allies[0].z = 7;
    allies[1].x = -10; allies[1].z = 0;
    rounds.phase = 'live';
    rounds.timer = 62;
    showHitmarker(hud, false, 0);
    addKillfeed(hud, 'You', 'Sentinel 2', 'us');
    addKillfeed(hud, 'Vega', 'Sentinel 4', 'us');
  } else if (mode === 'tactic') {
    // Buy menu open with funds to spend.
    economy.money = 3200;
    rounds.phase = 'buy';
    rounds.timer = 12;
    state.buyOpen = true;
    setBuyOpen(hud, true, economy);
    player.yaw = -Math.PI / 2;
  } else if (mode === 'end') {
    // Round won: banner, kill feed, score 1-0.
    rounds.scoreUs = 1;
    rounds.phase = 'end';
    rounds.endTimer = 4;
    rounds.roundWinner = 'us';
    rounds.roundReason = 'Sentinels eliminated';
    showBanner(hud, 'ROUND WON', 'Sentinels eliminated', 'win');
    addKillfeed(hud, 'You', 'Sentinel 1', 'us');
    addKillfeed(hud, 'You', 'Sentinel 3', 'us');
    addKillfeed(hud, 'Orion', 'Sentinel 2', 'us');
    player.yaw = -Math.PI / 2 + 0.35;
    enemies[0].x = 4; enemies[0].z = -5;
    enemies[1].x = 8; enemies[1].z = 2;
    // Allies stand behind the player, out of the frame.
    allies[0].x = -17.5; allies[0].z = 9;
    allies[1].x = -17.5; allies[1].z = 13;
  }
  for (const b of [...allies, ...enemies]) syncBotMesh(b);
  updateHUD(hud, { player, loadout, rounds, economy, now: state.now });
}

if (SHOT) {
  setupShot(SHOT);
} else {
  resetPositions();
  setMenuVisible(hud, true);
}
requestAnimationFrame(loop);

// Read-only state snapshot for automated checks (does not affect gameplay).
window.__duskline = {
  snapshot() {
    return {
      now: state.now,
      tick: state.tick,
      phase: rounds.phase,
      timer: rounds.timer,
      round: rounds.round,
      scoreUs: rounds.scoreUs,
      scoreThem: rounds.scoreThem,
      player: { x: player.x, z: player.z, hp: player.hp, alive: player.alive, yaw: player.yaw },
      enemiesAlive: enemies.filter((e) => e.alive).length,
      alliesAlive: allies.filter((a) => a.alive).length,
      money: economy.money,
      kills: state.kills,
      mag: loadout.mag[loadout.primary],
      reserve: loadout.reserve[loadout.primary],
      started: state.started,
    };
  },
};
