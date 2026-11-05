const test = require('node:test');
const assert = require('node:assert/strict');
const { FLEET, createRoom, joinRoom, getRoom, placeShip, attack, publicState, resetRooms } = require('../server/game');

function ready(room, player) {
  const rows = [0, 2, 4, 6, 8];
  FLEET.forEach((ship, index) => placeShip(room, player, { shipId: ship.id, x: 0, y: rows[index], direction: 'h' }));
}

test.beforeEach(resetRooms);

test('room code admits exactly one opponent and hides their ships', () => {
  const { room, player: host } = createRoom('海鸥');
  const { player: guest } = joinRoom(room.code.toLowerCase(), '灯塔');
  assert.equal(room.phase, 'placing');
  assert.throws(() => joinRoom(room.code, '第三人'), /已经开始|已满/);
  ready(room, host);
  ready(room, guest);
  const state = getRoom(room.code, host.id);
  assert.equal(state.room.phase, 'battle');
  assert.equal(state.player.id, host.id);
  assert.doesNotMatch(JSON.stringify(require('../server/game').publicState(room, host)), /"opponent"\s*:\s*\{[^}]*"cells"/);
});

test('rejects overlapping and out-of-bounds ship placements', () => {
  const { room, player } = createRoom('甲');
  joinRoom(room.code, '乙');
  assert.throws(() => placeShip(room, player, { shipId: 'carrier', x: 6, y: 0, direction: 'h' }), /超出/);
  placeShip(room, player, { shipId: 'carrier', x: 0, y: 0, direction: 'h' });
  assert.throws(() => placeShip(room, player, { shipId: 'battleship', x: 2, y: 0, direction: 'h' }), /重叠/);
});

test('enforces alternating attacks, reports hits and sinks, then ends on a win', () => {
  const { room, player: host } = createRoom('甲');
  const { player: guest } = joinRoom(room.code, '乙');
  ready(room, host);
  ready(room, guest);
  assert.equal(room.phase, 'battle');
  const guestView = publicState(room, guest);
  assert.equal(guestView.turn, 'opponent');
  assert.equal(guestView.winner, null);
  assert.equal(JSON.stringify(guestView).includes(host.id), false);
  assert.throws(() => attack(room, guest, { x: 0, y: 0 }), /还没轮到/);
  const first = attack(room, host, { x: 0, y: 0 });
  assert.equal(first.outgoing.at(-1).result, 'hit');
  assert.throws(() => attack(room, host, { x: 1, y: 0 }), /还没轮到/);
  attack(room, guest, { x: 9, y: 9 });
  assert.throws(() => attack(room, host, { x: 0, y: 0 }), /已经攻击过/);
  assert.throws(() => attack(room, host, { x: 10, y: 0 }), /范围内/);
  attack(room, host, { x: 1, y: 0 });
  attack(room, guest, { x: 8, y: 9 });
  attack(room, host, { x: 2, y: 0 });
  attack(room, guest, { x: 7, y: 9 });
  attack(room, host, { x: 3, y: 0 });
  attack(room, guest, { x: 6, y: 9 });
  const sunk = attack(room, host, { x: 4, y: 0 });
  assert.equal(sunk.outgoing.at(-1).result, 'sunk');
  assert.equal(room.phase, 'battle');
  attack(room, guest, { x: 5, y: 9 });

  const hostCells = host.ships.flatMap((ship) => ship.cells);
  let safeMissIndex = 0;
  const safeMisses = [9, 8].flatMap((x) => Array.from({ length: 10 }, (_, y) => ({ x, y })));
  for (const cell of hostCells) {
    if (!guest.shots.some((shot) => shot.x === cell.x && shot.y === cell.y)) {
      while (host.shots.some((shot) => shot.x === safeMisses[safeMissIndex].x && shot.y === safeMisses[safeMissIndex].y)) safeMissIndex += 1;
      attack(room, host, safeMisses[safeMissIndex]);
      safeMissIndex += 1;
      attack(room, guest, cell);
    }
  }
  assert.equal(room.phase, 'over');
  assert.equal(room.winner, guest.id);
  assert.equal(publicState(room, guest).winner, 'you');
  assert.equal(publicState(room, host).winner, 'opponent');
  assert.equal(JSON.stringify(publicState(room, host)).includes(guest.id), false);
  assert.throws(() => attack(room, guest, { x: 0, y: 0 }), /布舰完成/);
});
