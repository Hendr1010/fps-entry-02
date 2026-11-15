// hud.js — every DOM update for the HUD: health, ammo, timer, score,
// money, weapon and grenades, crosshair spread, hitmarker, damage vignette,
// kill feed, round banners, bomb progress and the buy overlay. One job:
// keep the screen in sync with the game state. No game logic lives here.

import { GUNS } from './weapon.js';
import { SHOP } from './economy.js';

function el(id) { return document.getElementById(id); }

export function createHUD() {
  const hud = {
    health: el('health'),
    healthNum: el('health-num'),
    healthBar: el('health-bar'),
    armor: el('armor'),
    weaponName: el('weapon-name'),
    ammo: el('ammo'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    grenades: el('grenades'),
    timer: el('timer'),
    roundLabel: el('round-label'),
    roundScore: el('round-score'),
    scoreUs: el('score-us'),
    scoreThem: el('score-them'),
    money: el('money'),
    killfeed: el('killfeed'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    bombbar: el('bombbar'),
    bombLabel: el('bomb-label'),
    bombFill: el('bomb-fill'),
    vignette: el('vignette'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    buyOverlay: el('buy-overlay'),
    buyFunds: el('buy-funds'),
    buyGrid: el('buy-grid'),
    menu: el('menu'),
    hitAt: 0,
    dmgAt: 0,
  };
  // Build the buy menu once.
  hud.buyGrid.innerHTML = SHOP.map((item, i) => (
    `<div class="item"><span><span class="key">${i + 1}</span>&nbsp; ${item.label}</span><b>$${item.price}</b></div>`
  )).join('');
  return hud;
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateHUD(hud, s) {
  const p = s.player;
  const loadout = s.loadout;
  const gun = GUNS[s.loadout.current === 'primary' ? s.loadout.primary : s.loadout.secondary];
  const key = s.loadout.current === 'primary' ? s.loadout.primary : s.loadout.secondary;

  hud.healthNum.textContent = Math.ceil(p.hp);
  hud.healthBar.style.width = `${Math.max(0, p.hp)}%`;
  hud.health.classList.toggle('low', p.hp <= 30);
  hud.armor.textContent = p.kevlar ? 'Kevlar vest' : '';
  hud.armor.style.display = p.kevlar ? 'block' : 'none';

  hud.weaponName.textContent = gun.name + (loadout.reloading ? ' — reloading…' : '');
  hud.ammoMag.textContent = loadout.mag[key];
  hud.ammoReserve.textContent = `/ ${loadout.reserve[key]}`;
  hud.ammo.classList.toggle('empty', loadout.mag[key] === 0);
  hud.grenades.textContent = `Frag ${loadout.grenades.frag} · Smoke ${loadout.grenades.smoke}`;

  const r = s.rounds;
  hud.timer.textContent = fmtTime(r.timer);
  hud.scoreUs.textContent = r.scoreUs;
  hud.scoreThem.textContent = r.scoreThem;
  hud.roundScore.firstChild.textContent = `Round ${r.round} · `;
  hud.roundLabel.textContent =
    r.phase === 'buy' ? 'Buy phase' :
    r.phase === 'live' ? 'Round live — plant at Site A' :
    r.phase === 'planted' ? 'Bomb planted' :
    r.phase === 'end' ? (r.roundWinner === 'us' ? 'Round won' : 'Round lost') :
    'Match over';
  hud.money.textContent = `$${s.economy.money}`;

  // Crosshair spread grows with bloom and movement.
  const spread = 1 + (loadout.bloom * 220) + (p.moving ? 1.6 : 0) + (p.crouch ? -0.4 : 0);
  hud.crosshair.style.transform = `translate(-50%, -50%) scale(${Math.max(0.7, spread)})`;

  // Hitmarker and damage vignette fade out.
  if (s.now - hud.hitAt > 0.18) hud.hitmarker.classList.remove('on');
  const dmgAge = s.now - hud.dmgAt;
  hud.vignette.style.opacity = dmgAge < 0.45 ? String(0.85 * (1 - dmgAge / 0.45)) : '0';
}

export function showBanner(hud, title, sub, kind) {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub;
  hud.banner.className = kind ? `show ${kind}` : 'show';
}

export function hideBanner(hud) {
  hud.banner.className = '';
  hud.bannerTitle.textContent = '';
  hud.bannerSub.textContent = '';
}

export function addKillfeed(hud, killer, victim, killerSide) {
  const line = document.createElement('div');
  const kc = killerSide === 'us' ? 'us' : 'them';
  line.innerHTML = `<b class="${kc}">${killer}</b> &rsaquo; <b>${victim}</b>`;
  hud.killfeed.prepend(line);
  while (hud.killfeed.children.length > 5) hud.killfeed.lastChild.remove();
}

export function showHitmarker(hud, kill, now) {
  hud.hitmarker.classList.toggle('kill', !!kill);
  hud.hitmarker.classList.add('on');
  hud.hitAt = now;
}

export function flashDamage(hud, now) {
  hud.dmgAt = now;
}

export function setBombBar(hud, show, label, frac) {
  hud.bombbar.classList.toggle('show', !!show);
  if (show) {
    hud.bombLabel.textContent = label;
    hud.bombFill.style.width = `${Math.round(frac * 100)}%`;
  }
}

export function setBuyOpen(hud, open, economy) {
  hud.buyOverlay.hidden = !open;
  if (open) hud.buyFunds.textContent = `$${economy.money}`;
}

export function setMenuVisible(hud, visible) {
  hud.menu.hidden = !visible;
}
