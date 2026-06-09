// Liar's Bar - Game Logic (ESM)

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const deck = [];
  for (let i = 0; i < 6; i++) {
    deck.push({ type: 'king', image: `king_of_${suits[i % 4]}.png` });
    deck.push({ type: 'queen', image: `queen_of_${suits[i % 4]}.png` });
    deck.push({ type: 'ace', image: `ace_of_${suits[i % 4]}.png` });
  }
  deck.push({ type: 'joker', image: 'black_joker.png' });
  deck.push({ type: 'joker', image: 'red_joker.png' });
  return deck;
}

export function createGame(roomCode) {
  return {
    roomCode,
    players: [],
    state: 'lobby',
    tableType: null,
    pile: [],
    lastPlay: [],
    lastPlayerId: null,
    currentTurn: 0,
    winner: null,
    lastResult: null,
  };
}

export function addPlayer(game, id, name) {
  if (game.players.length >= 4 || game.state !== 'lobby') return false;
  game.players.push({ id, name, hand: [], revolver: shuffle([true, false, false, false, false, false]), alive: true });
  return true;
}

export function removePlayer(game, id) {
  game.players = game.players.filter(p => p.id !== id);
}

export function startGame(game) {
  if (game.players.length < 2) return false;
  game.state = 'playing';
  startRound(game);
  return true;
}

function startRound(game) {
  const types = ['king', 'queen', 'ace'];
  game.tableType = types[Math.floor(Math.random() * 3)];
  const deck = shuffle(createDeck());
  let idx = 0;
  for (const p of game.players) {
    if (!p.alive) continue;
    p.hand = deck.slice(idx, idx + 5);
    idx += 5;
  }
  game.pile = [];
  game.lastPlay = [];
  game.lastPlayerId = null;
  game.lastResult = null;
}

function getNextTurn(game, fromIdx) {
  const n = game.players.length;
  let idx = (fromIdx + 1) % n;
  for (let t = 0; t < n; t++) {
    if (game.players[idx].alive && game.players[idx].hand.length > 0) return idx;
    idx = (idx + 1) % n;
  }
  return -1;
}

export function playCards(game, playerId, cardIndices) {
  const pIdx = game.players.findIndex(p => p.id === playerId);
  if (pIdx === -1 || pIdx !== game.currentTurn) return { ok: false };
  const player = game.players[pIdx];
  if (!player.alive || cardIndices.length < 1 || cardIndices.length > 3) return { ok: false };
  if (cardIndices.some(i => i < 0 || i >= player.hand.length)) return { ok: false };

  const sorted = [...cardIndices].sort((a, b) => b - a);
  const played = sorted.map(i => player.hand[i]);
  sorted.forEach(i => player.hand.splice(i, 1));

  game.lastPlay = played;
  game.lastPlayerId = playerId;
  game.pile.push(...played);
  game.currentTurn = getNextTurn(game, pIdx);
  return { ok: true };
}

export function callLiar(game, callerId) {
  const callerIdx = game.players.findIndex(p => p.id === callerId);
  if (callerIdx === -1 || callerIdx !== game.currentTurn || !game.lastPlayerId) return { ok: false };

  const accused = game.players.find(p => p.id === game.lastPlayerId);
  const caller = game.players[callerIdx];
  const wasLiar = game.lastPlay.some(c => c.type !== game.tableType && c.type !== 'joker');
  const loser = wasLiar ? accused : caller;
  const shot = loser.revolver.shift();
  if (shot) loser.alive = false;

  game.lastResult = {
    callerId, callerName: caller.name,
    accusedId: game.lastPlayerId, accusedName: accused.name,
    cards: game.lastPlay, wasLiar,
    loserId: loser.id, loserName: loser.name,
    shotResult: shot ? 'bang' : 'click',
  };

  const alive = game.players.filter(p => p.alive);
  if (alive.length <= 1) {
    game.state = 'gameOver';
    game.winner = alive[0] || null;
    return { ok: true, result: game.lastResult, gameOver: true };
  }
  game.state = 'roundEnd';
  return { ok: true, result: game.lastResult, gameOver: false };
}

export function nextRound(game) {
  const loserId = game.lastResult?.loserId;
  let startIdx = game.players.findIndex(p => p.id === loserId);
  if (startIdx === -1 || !game.players[startIdx].alive) startIdx = game.players.findIndex(p => p.alive);
  game.currentTurn = startIdx;
  game.state = 'playing';
  startRound(game);
}

export function getPlayerView(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  return {
    roomCode: game.roomCode,
    state: game.state,
    tableType: game.tableType,
    pileCount: game.pile.length,
    lastPlayCount: game.lastPlay.length,
    currentTurn: game.players[game.currentTurn]?.id || null,
    currentTurnName: game.players[game.currentTurn]?.name || null,
    myHand: player ? player.hand : [],
    canCallLiar: player && game.currentTurn === game.players.indexOf(player) && game.lastPlayerId !== null,
    players: game.players.map(p => ({ id: p.id, name: p.name, alive: p.alive, cardCount: p.hand.length, bulletsLeft: p.revolver.length })),
    lastResult: game.lastResult,
    winner: game.winner ? { id: game.winner.id, name: game.winner.name } : null,
  };
}
