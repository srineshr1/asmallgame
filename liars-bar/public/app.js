const socket = io();

const $ = id => document.getElementById(id);
let selectedCards = new Set();
let myId = null;
let currentState = null;

// Screens
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

// Lobby
$('btn-create').onclick = () => {
  const name = $('name-input').value.trim();
  if (!name) return showError('Enter a name');
  myId = socket.id;
  socket.emit('create', name);
};

$('btn-join').onclick = () => {
  const name = $('name-input').value.trim();
  const code = $('code-input').value.trim().toUpperCase();
  if (!name) return showError('Enter a name');
  if (!code || code.length !== 4) return showError('Enter 4-letter code');
  myId = socket.id;
  socket.emit('join', { code, name });
};

$('btn-start').onclick = () => socket.emit('start');

$('btn-play').onclick = () => {
  if (selectedCards.size === 0) return;
  socket.emit('play', [...selectedCards].sort((a, b) => a - b));
  selectedCards.clear();
};

$('btn-liar').onclick = () => socket.emit('callLiar');

function showError(msg) { $('error-msg').textContent = msg; }

socket.on('error', showError);

socket.on('connect', () => { myId = socket.id; });

socket.on('state', (state) => {
  currentState = state;
  $('error-msg').textContent = '';

  if (state.state === 'lobby') renderWaiting(state);
  else if (state.state === 'playing') renderGame(state);
  else if (state.state === 'roundEnd') renderResult(state);
  else if (state.state === 'gameOver') renderGameOver(state);
});

function renderWaiting(s) {
  showScreen('waiting');
  $('room-code').textContent = s.roomCode;
  $('player-list').innerHTML = s.players.map(p =>
    `<div class="player-tag">${p.name}</div>`
  ).join('');
  // Show start button only for host (first player)
  const isHost = s.players[0]?.id === myId;
  $('btn-start').classList.toggle('hidden', !isHost || s.players.length < 2);
}

function renderGame(s) {
  showScreen('game');
  $('result-overlay').classList.add('hidden');

  // Header
  const typeEmoji = { king: '👑', queen: '👸', ace: '🂡' };
  $('table-type-display').innerHTML = `Table: ${typeEmoji[s.tableType] || ''} <strong>${s.tableType?.toUpperCase()}</strong>`;
  $('pile-info').textContent = `Pile: ${s.pileCount} cards`;
  const isMyTurn = s.currentTurn === myId;
  $('turn-info').textContent = isMyTurn ? '🎯 YOUR TURN' : `${s.currentTurnName}'s turn`;

  // Opponents
  $('opponents').innerHTML = s.players.filter(p => p.id !== myId).map(p => `
    <div class="opponent ${!p.alive ? 'dead' : ''} ${s.currentTurn === p.id ? 'active-turn' : ''}">
      <div><strong>${p.name}</strong></div>
      <div>${p.alive ? `🃏 ${p.cardCount}` : '💀'}</div>
      <div>${'🔴'.repeat(p.bulletsLeft)}${'⚫'.repeat(6 - p.bulletsLeft)}</div>
    </div>
  `).join('');

  // My hand
  selectedCards = new Set([...selectedCards].filter(i => i < s.myHand.length));
  $('my-hand').innerHTML = s.myHand.map((card, i) => `
    <div class="card ${selectedCards.has(i) ? 'selected' : ''}" data-idx="${i}">
      <img src="/cards/${card.image}" alt="${card.type}">
    </div>
  `).join('');

  document.querySelectorAll('.card').forEach(el => {
    el.onclick = () => {
      if (!isMyTurn) return;
      const idx = parseInt(el.dataset.idx);
      if (selectedCards.has(idx)) selectedCards.delete(idx);
      else if (selectedCards.size < 3) selectedCards.add(idx);
      renderGame(currentState); // re-render selections
    };
  });

  // Buttons
  $('btn-play').disabled = !isMyTurn || selectedCards.size === 0;
  $('btn-liar').disabled = !s.canCallLiar || !isMyTurn;

  // Status
  const me = s.players.find(p => p.id === myId);
  $('my-status').textContent = me?.alive ? `Bullets left: ${'🔴'.repeat(me.bulletsLeft)}${'⚫'.repeat(6 - me.bulletsLeft)}` : '💀 You are eliminated';
}

function renderResult(s) {
  showScreen('game');
  const r = s.lastResult;
  if (!r) return;
  $('result-overlay').classList.remove('hidden');
  const cardsHtml = r.cards.map(c => `<img src="/cards/${c.image}">`).join('');
  $('result-content').innerHTML = `
    <h3>${r.callerName} called LIAR on ${r.accusedName}!</h3>
    <div class="revealed-cards">${cardsHtml}</div>
    <p>${r.wasLiar ? '🚨 LIAR CAUGHT! ' + r.accusedName + ' pulls the trigger...' : '❌ Wrong call! ' + r.callerName + ' pulls the trigger...'}</p>
    <div class="shot-result">${r.shotResult === 'bang' ? '💥 BANG! ' + r.loserName + ' is eliminated!' : '😮‍💨 *click* — ' + r.loserName + ' survives!'}</div>
  `;
}

function renderGameOver(s) {
  showScreen('gameover');
  $('winner-text').textContent = s.winner ? `🏆 ${s.winner.name} wins!` : 'Game Over!';
}
