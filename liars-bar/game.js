// Liar's Bar - Game Logic (Server-authoritative)

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  // 6 Kings, 6 Queens, 6 Aces, 2 Jokers
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

function createGame(roomCode) {
  return {
    roomCode,
    players: [],        // { id, name, hand: [], revolver: [], alive: true }
    state: 'lobby',     // lobby | playing | roundEnd | gameOver
    tableType: null,    // 'king' | 'queen' | 'ace'
    pile: [],           // cards played face down this round
    lastPlay: [],       // cards from last player's turn (for liar call)
    lastPlayerId: null,
    currentTurn: 0,     // index into players array
    turnTimer: null,
    winner: null,
    lastResult: null,   // { type, callerId, accusedId, cards, wasLiar, shotResult }
  };
}

function addPlayer(game, id, name) {
  if (game.players.length >= 4) return false;
  if (game.state !== 'lobby') return false;
  game.players.push({
    id, name,
    hand: [],
    revolver: shuffle([true, false, false, false, false, false]), // true = lethal
    alive: true,
  });
  return true;
}

function removePlayer(game, id) {
  game.players = game.players.filter(p => p.id !== id);
}

function startGame(game) {
  if (game.players.length < 2) return false;
  game.state = 'playing';
  startRound(game);
  return true;
}

function startRound(game) {
  // Pick table type
  const types = ['king', 'queen', 'ace'];
  game.tableType = types[Math.floor(Math.random() * 3)];
  // Deal cards
  const deck = shuffle(createDeck());
  let cardIdx = 0;
  for (const p of game.players) {
    if (!p.alive) continue;
    p.hand = deck.slice(cardIdx, cardIdx + 5);
    cardIdx += 5;
  }
  game.pile = [];
  game.lastPlay = [];
  game.lastPlayerId = null;
  game.lastResult = null;
}

function getAlivePlayers(game) {
  return game.players.filter(p => p.alive);
}

function getNextTurn(game, fromIdx) {
  const n = game.players.length;
  let idx = (fromIdx + 1) % n;
  let tries = 0;
  while (tries < n) {
    const p = game.players[idx];
    if (p.alive && p.hand.length > 0) return idx;
    idx = (idx + 1) % n;
    tries++;
  }
  return -1; // no valid next player
}

function playCards(game, playerId, cardIndices) {
  const pIdx = game.players.findIndex(p => p.id === playerId);
  if (pIdx === -1 || pIdx !== game.currentTurn) return { ok: false, reason: 'Not your turn' };
  const player = game.players[pIdx];
  if (!player.alive) return { ok: false, reason: 'You are eliminated' };
  if (cardIndices.length < 1 || cardIndices.length > 3) return { ok: false, reason: 'Play 1-3 cards' };
  if (cardIndices.some(i => i < 0 || i >= player.hand.length)) return { ok: false, reason: 'Invalid card' };

  // Extract cards (sort indices descending to remove safely)
  const sorted = [...cardIndices].sort((a, b) => b - a);
  const played = sorted.map(i => player.hand[i]);
  sorted.forEach(i => player.hand.splice(i, 1));

  game.lastPlay = played;
  game.lastPlayerId = playerId;
  game.pile.push(...played);

  // Check if we need to force a liar call (only 1 player with cards left)
  const playersWithCards = game.players.filter(p => p.alive && p.hand.length > 0);
  if (playersWithCards.length <= 1 && playersWithCards[0]?.id !== playerId) {
    // The remaining player must call liar on their turn
  }

  game.currentTurn = getNextTurn(game, pIdx);
  return { ok: true, count: played.length };
}

function callLiar(game, callerId) {
  const callerIdx = game.players.findIndex(p => p.id === callerId);
  if (callerIdx === -1 || callerIdx !== game.currentTurn) return { ok: false, reason: 'Not your turn' };
  if (!game.lastPlayerId) return { ok: false, reason: 'No one has played yet' };

  const accused = game.players.find(p => p.id === game.lastPlayerId);
  const caller = game.players[callerIdx];

  // Check if any of the last played cards is a Liar
  const wasLiar = game.lastPlay.some(c => c.type !== game.tableType && c.type !== 'joker');

  // The loser plays russian roulette
  const loser = wasLiar ? accused : caller;
  const shot = loser.revolver.shift(); // true = lethal (bang!)
  if (shot) loser.alive = false;

  game.lastResult = {
    callerId,
    callerName: caller.name,
    accusedId: game.lastPlayerId,
    accusedName: accused.name,
    cards: game.lastPlay,
    wasLiar,
    loserId: loser.id,
    loserName: loser.name,
    shotResult: shot ? 'bang' : 'click',
  };

  // Check game over
  const alive = getAlivePlayers(game);
  if (alive.length <= 1) {
    game.state = 'gameOver';
    game.winner = alive[0] || null;
    return { ok: true, result: game.lastResult, gameOver: true };
  }

  // Start new round
  game.state = 'roundEnd';
  return { ok: true, result: game.lastResult, gameOver: false };
}

function nextRound(game) {
  // First player is the loser of last round (or next alive player)
  const loserId = game.lastResult?.loserId;
  let startIdx = game.players.findIndex(p => p.id === loserId);
  if (startIdx === -1 || !game.players[startIdx].alive) {
    startIdx = game.players.findIndex(p => p.alive);
  }
  game.currentTurn = startIdx;
  game.state = 'playing';
  startRound(game);
}

function getPlayerView(game, playerId) {
  // Returns only what this player should see
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
    myBullets: player ? player.revolver.length : 0,
    canCallLiar: player && game.currentTurn === game.players.indexOf(player) && game.lastPlayerId !== null,
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      cardCount: p.hand.length,
      bulletsLeft: p.revolver.length,
    })),
    lastResult: game.lastResult,
    winner: game.winner ? { id: game.winner.id, name: game.winner.name } : null,
  };
}

module.exports = { createGame, addPlayer, removePlayer, startGame, playCards, callLiar, nextRound, getPlayerView, getAlivePlayers };
