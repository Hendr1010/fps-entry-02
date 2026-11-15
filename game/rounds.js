// rounds.js — the round state machine: buy phase, live round, planted bomb,
// round end and match end. One job: decide what phase the match is in, who
// won each round, and when the match is over. First to 5 rounds wins.

export const BUY_TIME = 15;
export const LIVE_TIME = 100;
export const FUSE_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const END_TIME = 4;
export const WIN_ROUNDS = 5;

export function createRounds() {
  return {
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    phase: 'buy', // buy | live | planted | end | match
    timer: BUY_TIME,
    bomb: { state: 'none', x: 0, z: 0, plantProgress: 0, fuse: 0 },
    roundWinner: null, // 'us' | 'them'
    roundReason: '',
    matchWinner: null,
    endTimer: 0,
  };
}

export function resetRound(r) {
  r.phase = 'buy';
  r.timer = BUY_TIME;
  r.bomb = { state: 'none', x: 0, z: 0, plantProgress: 0, fuse: 0 };
  r.roundWinner = null;
  r.roundReason = '';
  r.endTimer = 0;
}

function finishRound(r, winner, reason, ctx) {
  r.phase = 'end';
  r.roundWinner = winner;
  r.roundReason = reason;
  r.endTimer = END_TIME;
  if (winner === 'us') r.scoreUs += 1; else r.scoreThem += 1;
  if (ctx && ctx.onRoundEnd) ctx.onRoundEnd(winner, reason, r);
  if (r.scoreUs >= WIN_ROUNDS || r.scoreThem >= WIN_ROUNDS) {
    r.matchWinner = r.scoreUs >= WIN_ROUNDS ? 'us' : 'them';
  }
}

export function plantBomb(r, x, z, ctx) {
  r.bomb.state = 'planted';
  r.bomb.x = x; r.bomb.z = z;
  r.bomb.fuse = FUSE_TIME;
  r.phase = 'planted';
  r.timer = FUSE_TIME;
  if (ctx && ctx.onPlant) ctx.onPlant(x, z);
}

export function defuseBomb(r, ctx) {
  if (r.bomb.state !== 'planted') return;
  r.bomb.state = 'defused';
  finishRound(r, 'them', 'Bomb defused', ctx);
}

export function explodeBomb(r, ctx) {
  if (r.bomb.state !== 'planted') return;
  r.bomb.state = 'exploded';
  finishRound(r, 'us', 'Site A destroyed', ctx);
}

// ctx: { playerAlive, alliesAlive, enemiesAlive, onRoundEnd, onPlant,
// onMatchEnd, onPhase }
// Returns nothing; phases and winners are written into r.
export function updateRounds(r, ctx, dt) {
  if (r.phase === 'match') return;

  if (r.phase === 'buy') {
    r.timer -= dt;
    if (r.timer <= 0) {
      r.phase = 'live';
      r.timer = LIVE_TIME;
      if (ctx.onPhase) ctx.onPhase('live');
    }
    return;
  }

  if (r.phase === 'live') {
    r.timer -= dt;
    if (!ctx.enemiesAlive) {
      finishRound(r, 'us', 'Sentinels eliminated', ctx);
      return;
    }
    if (!ctx.playerAlive && !ctx.alliesAlive) {
      finishRound(r, 'them', 'Squad eliminated', ctx);
      return;
    }
    if (r.timer <= 0) {
      finishRound(r, 'them', 'Time expired — Site A held', ctx);
      return;
    }
    return;
  }

  if (r.phase === 'planted') {
    r.timer -= dt;
    r.bomb.fuse = r.timer;
    if (!ctx.enemiesAlive) {
      explodeBomb(r, ctx);
      return;
    }
    if (!ctx.playerAlive && !ctx.alliesAlive) {
      finishRound(r, 'them', 'Squad eliminated — bomb defused', ctx);
      return;
    }
    if (r.timer <= 0) {
      explodeBomb(r, ctx);
      return;
    }
    return;
  }

  if (r.phase === 'end') {
    r.endTimer -= dt;
    if (r.endTimer <= 0) {
      if (r.matchWinner) {
        r.phase = 'match';
        if (ctx.onMatchEnd) ctx.onMatchEnd(r.matchWinner, r);
      } else {
        r.round += 1;
        resetRound(r);
        if (ctx.onPhase) ctx.onPhase('buy');
      }
    }
    return;
  }
}
