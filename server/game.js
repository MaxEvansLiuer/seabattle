const crypto = require('node:crypto');

const SIZE = 10;
const FLEET = [
  { id: 'carrier', name: '航母', length: 5 },
  { id: 'battleship', name: '战列舰', length: 4 },
  { id: 'cruiser', name: '巡洋舰', length: 3 },
  { id: 'submarine', name: '潜艇', length: 3 },
  { id: 'destroyer', name: '驱逐舰', length: 2 },
];
const COLUMNS = 'ABCDEFGHIJ';
const rooms = new Map();

function makePlayer(name) {
  return { id: crypto.randomUUID(), name: cleanName(name), ships: [], shots: [], ready: false };
}

function cleanName(name) {
  const value = typeof name === 'string' ? name.trim().slice(0, 16) : '';
  return value || '玩家';
}

function createRoom(name) {
  let code;
  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(code));
  const player = makePlayer(name);
  const room = { code, players: [player], phase: 'waiting', turn: null, winner: null, createdAt: Date.now() };
  rooms.set(code, room);
  return { room, player };
}

function joinRoom(code, name) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new Error('找不到这个房间，请检查房间码。');
  if (room.phase !== 'waiting') throw new Error('这个房间已经开始或结束。');
  if (room.players.length >= 2) throw new Error('房间已满。');
  const player = makePlayer(name);
  room.players.push(player);
  room.phase = 'placing';
  return { room, player };
}

function getRoom(code, playerId) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new Error('房间不存在或已重启清空。');
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error('玩家凭据无效，请用创建或加入时的浏览器继续。');
  return { room, player };
}

function placeShip(room, player, { shipId, x, y, direction }) {
  if (room.phase !== 'placing') throw new Error('当前不是布舰阶段。');
  if (player.ready) throw new Error('舰队已提交，正在等待对手。');
  const spec = FLEET.find((ship) => ship.id === shipId);
  if (!spec) throw new Error('请选择舰队中的舰船。');
  if (player.ships.some((ship) => ship.id === shipId)) throw new Error('这艘船已经摆放。');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    throw new Error('起点必须在棋盘范围内。');
  }
  if (direction !== 'h' && direction !== 'v') throw new Error('方向必须是横向或纵向。');
  const cells = Array.from({ length: spec.length }, (_, offset) => ({
    x: x + (direction === 'h' ? offset : 0),
    y: y + (direction === 'v' ? offset : 0),
  }));
  if (cells.some((cell) => cell.x >= SIZE || cell.y >= SIZE)) throw new Error('舰船超出棋盘边缘。');
  if (cells.some((cell) => player.ships.some((ship) => ship.cells.some((part) => part.x === cell.x && part.y === cell.y)))) {
    throw new Error('舰船不能重叠。');
  }
  player.ships.push({ id: spec.id, name: spec.name, cells });
  if (player.ships.length === FLEET.length) {
    player.ready = true;
    if (room.players.length === 2 && room.players.every((entry) => entry.ready)) {
      room.phase = 'battle';
      room.turn = room.players[0].id;
    }
  }
  return publicState(room, player);
}

function attack(room, player, { x, y }) {
  if (room.phase !== 'battle') throw new Error('双方布舰完成后才能攻击。');
  if (room.turn !== player.id) throw new Error('还没轮到你攻击。');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    throw new Error('目标必须在棋盘范围内。');
  }
  const enemy = room.players.find((entry) => entry.id !== player.id);
  if (player.shots.some((shot) => shot.x === x && shot.y === y)) throw new Error('这个位置已经攻击过。');
  const ship = enemy.ships.find((item) => item.cells.some((cell) => cell.x === x && cell.y === y));
  const shot = { x, y, result: ship ? 'hit' : 'miss', shipId: ship?.id || null };
  player.shots.push(shot);
  if (ship && ship.cells.every((cell) => player.shots.some((entry) => entry.x === cell.x && entry.y === cell.y))) {
    shot.result = 'sunk';
  }
  if (enemy.ships.every((item) => item.cells.every((cell) => player.shots.some((entry) => entry.x === cell.x && entry.y === cell.y))) && enemy.ready) {
    room.phase = 'over';
    room.winner = player.id;
  } else {
    room.turn = enemy.id;
  }
  return publicState(room, player);
}

function publicState(room, viewer) {
  const enemy = room.players.find((entry) => entry.id !== viewer.id);
  const received = enemy ? enemy.shots.map(({ x, y, result }) => ({ x, y, result })) : [];
  const turn = room.turn === null ? null : room.turn === viewer.id ? 'you' : 'opponent';
  const winner = room.winner === null ? null : room.winner === viewer.id ? 'you' : 'opponent';
  return {
    code: room.code,
    phase: room.phase,
    turn,
    winner,
    you: { id: viewer.id, name: viewer.name, ready: viewer.ready, ships: viewer.ships.map((ship) => ({ ...ship, cells: ship.cells.map((cell) => ({ ...cell })) })) },
    opponent: enemy ? { name: enemy.name, ready: enemy.ready } : null,
    incoming: received,
    outgoing: viewer.shots.map(({ x, y, result }) => ({ x, y, result })),
    fleet: FLEET.map((ship) => ({ ...ship })),
    turnName: room.players.find((entry) => entry.id === room.turn)?.name || null,
  };
}

function resetRooms() {
  rooms.clear();
}

module.exports = { SIZE, FLEET, COLUMNS, rooms, createRoom, joinRoom, getRoom, placeShip, attack, publicState, resetRooms };
