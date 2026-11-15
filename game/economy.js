// economy.js — money and the buy menu. One job: track the player's funds,
// pay out round rewards, and sell weapons, grenades, kevlar and ammo.
// Prices and payouts live here; the menu UI lives in hud.js.

import { GUNS } from './weapon.js';

export const REWARDS = { win: 300, loss: 150, kill: 100, plant: 200 };

export const SHOP = [
  { key: 'smg', label: 'SMG', price: 1500, kind: 'gun' },
  { key: 'shotgun', label: 'Shotgun', price: 2000, kind: 'gun' },
  { key: 'sniper', label: 'Sniper', price: 4000, kind: 'gun' },
  { key: 'frag', label: 'Frag grenade', price: 300, kind: 'grenade' },
  { key: 'smoke', label: 'Smoke grenade', price: 300, kind: 'grenade' },
  { key: 'kevlar', label: 'Kevlar vest', price: 500, kind: 'kevlar' },
  { key: 'ammo', label: 'Ammo refill', price: 200, kind: 'ammo' },
];

export function createEconomy() {
  return { money: 800 };
}

// Buy an item by its shop key. Applies the effect to loadout/player.
// Returns {ok, reason} — reason is '' on success.
export function buy(eco, item, loadout, player) {
  if (eco.money < item.price) return { ok: false, reason: 'Not enough money' };
  if (item.kind === 'gun') {
    if (loadout.primary === item.key) return { ok: false, reason: 'Already owned' };
  }
  if (item.kind === 'grenade' && loadout.grenades[item.key] >= 2) {
    return { ok: false, reason: 'Grenade pouch full' };
  }
  if (item.kind === 'kevlar' && player.kevlar) {
    return { ok: false, reason: 'Already wearing kevlar' };
  }
  eco.money -= item.price;
  if (item.kind === 'gun') {
    loadout.primary = item.key;
    loadout.current = 'primary';
    loadout.mag[item.key] = GUNS[item.key].mag;
    loadout.reserve[item.key] = GUNS[item.key].reserve;
    loadout.reloading = null;
  } else if (item.kind === 'grenade') {
    loadout.grenades[item.key] += 1;
  } else if (item.kind === 'kevlar') {
    player.kevlar = true;
  } else if (item.kind === 'ammo') {
    for (const k of Object.keys(loadout.reserve)) {
      loadout.reserve[k] = GUNS[k].reserve * 2;
    }
  }
  return { ok: true, reason: '' };
}

export function reward(eco, kind) {
  eco.money += REWARDS[kind] || 0;
}
