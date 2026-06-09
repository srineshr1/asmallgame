// test-sync.js — verify server broadcasts shared state with all balls to every client.
import { io as ioc } from 'socket.io-client';

const URL = 'http://localhost:3000';
let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ok  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)); };
const emit = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = ioc(URL), b = ioc(URL);
let aState = null, bState = null, aOver = null;
a.on('state', (s) => { aState = s; });
b.on('state', (s) => { bState = s; });
a.on('game:over', (o) => { aOver = o; });

await new Promise((r) => a.on('connect', r));
await new Promise((r) => b.on('connect', r));

const created = await emit(a, 'room:create', { name: 'Alice' });
const code = created.code;
await emit(b, 'room:join', { code, name: 'Bob' });
const started = await emit(a, 'room:start');
check('host started game', started.ok);

await wait(300);
check('client A receives state', !!aState);
check('client B receives state', !!bState);
check('state has 2 balls (both players visible)', aState && aState.balls.length === 2);
check('both clients see same round', aState.round === bState.round);
check('tiles array correct length', aState.tiles.length === 7 * 9);
check('state has a phase', typeof aState.phase === 'string');

// Both players send strong input; server should move their balls.
const ax0 = aState.balls.find((x) => x.id === a.id);
const startX = ax0.x;
const pushInterval = setInterval(() => { a.volatile.emit('input', { ax: 1, ay: 0 }); }, 30);
await wait(700);
clearInterval(pushInterval);
const ax1 = aState.balls.find((x) => x.id === a.id);
check('ball moved in response to input', ax1 && Math.abs(ax1.x - startX) > 0.05);

// Disconnecting one of two players should end the game (1 left = winner).
b.disconnect();
await wait(400);
check('game over fired when one player remains', !!aOver);
check('winner is remaining player A', aOver && aOver.winnerId === a.id);

a.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
