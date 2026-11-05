const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createRoom, joinRoom, getRoom, placeShip, attack } = require('./game');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY_BYTES = 12000;

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + chunk.length > MAX_BODY_BYTES) {
        tooLarge = true;
        body = '';
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (tooLarge) return reject(new RequestError('请求内容过大。', 413));
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new RequestError('请求内容不是有效 JSON。', 400)); }
    });
    request.on('error', reject);
  });
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'POST' && url.pathname === '/api/rooms') {
        const body = await readJson(request);
        const { room, player } = createRoom(body.name);
        return sendJson(response, 201, { code: room.code, playerId: player.id });
      }
      const route = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|place|attack))?$/i);
      if (route) {
        const code = route[1].toUpperCase();
        const action = route[2];
        if (request.method === 'POST' && action === 'join') {
          const body = await readJson(request);
          const { player } = joinRoom(code, body.name);
          return sendJson(response, 201, { code, playerId: player.id });
        }
        const playerId = url.searchParams.get('playerId');
        const { room, player } = getRoom(code, playerId);
        if (request.method === 'GET' && !action) return sendJson(response, 200, require('./game').publicState(room, player));
        if (request.method === 'POST' && action === 'place') {
          return sendJson(response, 200, placeShip(room, player, await readJson(request)));
        }
        if (request.method === 'POST' && action === 'attack') {
          return sendJson(response, 200, attack(room, player, await readJson(request)));
        }
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 404, { error: '没有这个接口。' });
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(PUBLIC_DIR, requested);
      if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return sendJson(response, 404, { error: '页面不存在。' });
      }
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      if (request.method === 'HEAD') return response.end();
      fs.createReadStream(file).pipe(response);
    } catch (error) {
      const status = error instanceof RequestError
        ? error.status
        : error instanceof URIError
          ? 400
          : /不存在|找不到/.test(error.message)
            ? 404
            : 409;
      return sendJson(response, status, { error: error.message || '请求失败。' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  createServer().listen(port, host, () => {
    console.log(`海战棋已启动： http://${host}:${port}`);
    console.log('同一 Wi-Fi / 局域网的玩家可访问本机局域网地址。');
  });
}

module.exports = { createServer };
