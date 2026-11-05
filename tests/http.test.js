const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { FLEET, resetRooms } = require('../server/game');

test('HTTP flow creates, joins, places, and starts a private two-player room', async (t) => {
  resetRooms();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  const created = await request('/api/rooms', 'POST', { name: '房主' });
  assert.equal(created.status, 201);
  const code = created.body.code;
  const hostId = created.body.playerId;
  const joined = await request(`/api/rooms/${code}/join`, 'POST', { name: '来客' });
  assert.equal(joined.status, 201);
  const guestId = joined.body.playerId;
  for (const [playerId, startY] of [[hostId, 0], [guestId, 0]]) {
    for (let index = 0; index < FLEET.length; index += 1) {
      const response = await request(`/api/rooms/${code}/place?playerId=${playerId}`, 'POST', {
        shipId: FLEET[index].id, x: 0, y: startY + index * 2, direction: 'h',
      });
      assert.equal(response.status, 200);
    }
  }
  const hostState = await request(`/api/rooms/${code}?playerId=${hostId}`);
  assert.equal(hostState.body.phase, 'battle');
  assert.equal(hostState.body.turn, 'you');
  assert.equal(hostState.body.you.ships.length, 5);
  assert.equal(Object.hasOwn(hostState.body.opponent, 'ships'), false);
  assert.equal(JSON.stringify(hostState.body).includes(guestId), false);
  const guestState = await request(`/api/rooms/${code}?playerId=${guestId}`);
  assert.equal(guestState.body.turn, 'opponent');
  assert.equal(JSON.stringify(guestState.body).includes(hostId), false);
  assert.equal((await request(`/api/rooms/${code}/attack?playerId=${encodeURIComponent(guestState.body.turn)}`, 'POST', { x: 0, y: 0 })).status, 409);
  assert.equal((await request(`/api/rooms/${code}?playerId=wrong`)).status, 409);
  const attacked = await request(`/api/rooms/${code}/attack?playerId=${hostId}`, 'POST', { x: 0, y: 0 });
  assert.equal(attacked.body.outgoing[0].result, 'hit');
  assert.equal((await request(`/api/rooms/${code}/attack?playerId=${hostId}`, 'POST', { x: 1, y: 0 })).status, 409);
});

test('serves the game page', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /局域网海战棋/);
});

test('HTTP attack flow reports a sunk fleet and a final winner', async (t) => {
  resetRooms();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  const created = await request('/api/rooms', 'POST', { name: '甲' });
  const code = created.body.code;
  const hostId = created.body.playerId;
  const joined = await request(`/api/rooms/${code}/join`, 'POST', { name: '乙' });
  const guestId = joined.body.playerId;
  for (const playerId of [hostId, guestId]) {
    for (let index = 0; index < FLEET.length; index += 1) {
      const placed = await request(`/api/rooms/${code}/place?playerId=${playerId}`, 'POST', {
        shipId: FLEET[index].id, x: 0, y: index * 2, direction: 'h',
      });
      assert.equal(placed.status, 200);
    }
  }

  let lastHostState;
  let lastGuestState;
  for (let index = 0; index < FLEET.length; index += 1) {
    const { length } = FLEET[index];
    const y = index * 2;
    for (let x = 0; x < length; x += 1) {
      lastHostState = await request(`/api/rooms/${code}/attack?playerId=${hostId}`, 'POST', { x, y });
      assert.equal(lastHostState.status, 200);
      if (lastHostState.body.phase === 'over') break;
      lastGuestState = await request(`/api/rooms/${code}/attack?playerId=${guestId}`, 'POST', { x, y });
      assert.equal(lastGuestState.status, 200);
    }
    if (lastHostState.body.phase === 'over') break;
  }

  assert.equal(lastHostState.body.phase, 'over');
  assert.equal(lastHostState.body.winner, 'you');
  assert.equal(lastHostState.body.outgoing.at(-1).result, 'sunk');
  const guestView = await request(`/api/rooms/${code}?playerId=${guestId}`);
  assert.equal(guestView.status, 200);
  assert.equal(guestView.body.phase, 'over');
  assert.equal(guestView.body.winner, 'opponent');
});
