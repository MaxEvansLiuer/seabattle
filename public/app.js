(() => {
  const app = document.querySelector('#app');
  const savedKey = 'lan-battleship-player';
  let session = loadSession();
  let state = null;
  let direction = 'h';
  let selectedShipId = 'carrier';
  let busy = false;
  let notice = '';
  let offline = false;

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(savedKey) || 'null'); } catch { return null; }
  }
  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(savedKey, JSON.stringify(value));
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  async function api(path, method = 'GET', body) {
    const response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || '操作失败，请重试。');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function say(text) {
    notice = text || '';
    render();
  }
  async function refresh(quiet = false) {
    if (!session) { render(); return; }
    try {
      state = await api(`/api/rooms/${encodeURIComponent(session.code)}?playerId=${encodeURIComponent(session.playerId)}`);
      if (state.phase === 'placing' && state.you.ships.some((ship) => ship.id === selectedShipId)) {
        selectedShipId = state.fleet.find((ship) => !state.you.ships.some((placed) => placed.id === ship.id))?.id || '';
      }
      const wasOffline = offline;
      offline = false;
      if (!quiet || wasOffline) notice = '';
    } catch (error) {
      if (error.status === 404) {
        state = null;
        saveSession(null);
        offline = false;
        notice = '房间已结束或服务刚重启，请重新创建或加入。';
      } else {
        offline = true;
        if (!quiet) notice = '暂时连不上房间，正在自动重试；房间身份已保留。';
      }
    }
    render();
  }
  function setSession(result) {
    saveSession({ code: result.code, playerId: result.playerId });
    state = null;
    notice = '';
    refresh();
  }
  function boardMarkup(kind) {
    const placement = kind === 'placement';
    const incoming = new Map((state?.incoming || []).map((shot) => [`${shot.x},${shot.y}`, shot]));
    const outgoing = new Map((state?.outgoing || []).map((shot) => [`${shot.x},${shot.y}`, shot]));
    const ships = new Map();
    for (const ship of state?.you.ships || []) for (const cell of ship.cells) ships.set(`${cell.x},${cell.y}`, ship.name);
    let cells = '';
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        const key = `${x},${y}`;
        const shot = placement ? incoming.get(key) : kind === 'own' ? incoming.get(key) : outgoing.get(key);
        const isShip = kind === 'own' && ships.has(key);
        const classes = ['cell'];
        if (isShip) classes.push('ship-cell');
        if (shot) classes.push(shot.result === 'miss' ? 'miss' : 'hit');
        if (kind === 'target' && state?.phase === 'battle' && state.turn === 'you' && !shot) classes.push('targetable');
        const title = shot ? (shot.result === 'miss' ? '未命中' : shot.result === 'sunk' ? '击沉' : '命中') : isShip ? ships.get(key) : '';
        cells += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" data-board="${kind}" aria-label="${String.fromCharCode(65 + x)}${y + 1}${title ? `，${esc(title)}` : ''}" ${kind === 'own' || state?.phase === 'over' || (kind === 'target' && (state?.turn !== 'you' || shot)) ? 'disabled' : ''}>${shot ? (shot.result === 'miss' ? '·' : '✕') : isShip ? '<span></span>' : ''}</button>`;
      }
    }
    const labels = '<div class="axis axis-corner"></div>' + Array.from({ length: 10 }, (_, x) => `<div class="axis">${String.fromCharCode(65 + x)}</div>`).join('');
    const rows = Array.from({ length: 10 }, (_, y) => `<div class="axis row-axis">${y + 1}</div>` + cells.split('</button>').slice(y * 10, y * 10 + 10).map((cell) => `${cell}</button>`).join('')).join('');
    return `<div class="board-wrap"><div class="board" role="grid" aria-label="${placement ? '布舰棋盘' : kind === 'own' ? '己方海域' : '目标海域'}">${labels}${rows}</div></div>`;
  }
  function homeMarkup() {
    return `<section class="welcome">
      <div class="intro"><div class="eyebrow">LOCAL FLEET · 双人对战</div><h1>把舰队藏好，<br><em>听海面回声。</em></h1><p>创建一间只存在于本机的房间，和同一 Wi-Fi 下的朋友来一场海战。</p><div class="intro-rule"><span>10 × 10</span><span>2 位玩家</span><span>无需账号</span></div></div>
      <div class="entry-card"><div class="card-kicker">准备出航</div><label class="field-label" for="name">你的昵称</label><input id="name" maxlength="16" placeholder="比如：海鸥" autocomplete="nickname"><button class="primary" id="create">创建房间 <span>↗</span></button><div class="divider"><span>或加入朋友的房间</span></div><label class="field-label" for="code">房间码</label><div class="join-row"><input id="code" maxlength="6" placeholder="6 位房间码" autocomplete="off"><button class="secondary" id="join">加入</button></div><div class="hint">让房主把房间码告诉你，两人需要连接同一局域网。</div></div>
    </section>`;
  }
  function fleetChecklist() {
    return `<div class="fleet-list">${state.fleet.map((ship) => {
      const placed = state.you.ships.some((item) => item.id === ship.id);
      const selected = !placed && ship.id === selectedShipId;
      return `<button class="fleet-row ${placed ? 'done' : ''} ${selected ? 'selected' : ''}" data-ship="${esc(ship.id)}" ${placed || state.you.ready ? 'disabled' : ''} aria-pressed="${selected}"><span class="fleet-status">${placed ? '✓' : selected ? '›' : '·'}</span><span>${esc(ship.name)}</span><small>${ship.length} 格</small></button>`;
    }).join('')}</div>`;
  }
  function roomMarkup() {
    const isSetup = state.phase === 'waiting' || state.phase === 'placing';
    const title = state.phase === 'waiting' ? '等一位船长加入' : state.phase === 'placing' ? '把舰队布置好' : state.phase === 'battle' ? '交锋正酣' : state.winner === 'you' ? '这片海域属于你' : '本场海战结束';
    const subtitle = state.phase === 'waiting' ? '分享房间码，朋友加入后就能开始布舰。' : state.phase === 'placing' ? (state.you.ready ? '舰队已就位，等对手完成布舰。' : '选择舰船和朝向，再点击棋盘上的起点。舰船不能重叠或越界。') : state.phase === 'battle' ? (state.turn === 'you' ? '轮到你了。选择对方海域中的一个格子发动攻击。' : `等待 ${esc(state.turnName || '对手')} 行动…`) : `胜者：${esc(state.turnName || (state.winner === 'you' ? state.you.name : state.opponent?.name) || '玩家')}`;
    const chips = `<div class="room-code"><span>房间码</span><strong>${esc(state.code)}</strong><button id="copy" aria-label="复制房间码">复制</button></div>`;
    if (state.phase === 'waiting') return `<section class="room-screen"><div class="room-heading"><div class="eyebrow">房间已创建</div><h1>${title}</h1><p>${subtitle}</p></div>${chips}<div class="waiting-card"><span class="pulse"></span><div><strong>等待对手加入</strong><small>房间码分享给同一局域网的朋友即可</small></div></div><button class="text-button" id="leave">退出房间</button></section>`;
    if (state.phase === 'placing') return `<section class="room-screen"><div class="room-heading"><div class="eyebrow">${esc(state.you.name)} · ${state.opponent ? `${esc(state.opponent.name)} 已加入` : '等待对手'}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="setup-layout"><div class="setup-panel"><div class="panel-top"><span>舰队清单</span><span>${state.you.ships.length} / 5</span></div>${fleetChecklist()}${!state.you.ready ? `<button class="secondary direction" id="rotate">朝向：${direction === 'h' ? '横向' : '纵向'} <span>↻</span></button>` : '<div class="ready-note">舰队已提交，无法再调整</div>'}</div><div class="play-board"><div class="board-title"><span>你的海域</span><span>A—J · 1—10</span></div>${boardMarkup('placement')}</div></div><button class="text-button" id="leave">退出房间</button></section>`;
    return `<section class="room-screen"><div class="room-heading"><div class="eyebrow">${state.phase === 'over' ? '对局结果' : `${esc(state.you.name)}  VS  ${esc(state.opponent?.name || '对手')}`}</div><h1>${title}</h1><p>${subtitle}</p></div>${chips}<div class="battle-layout"><div class="play-board"><div class="board-title"><span>你的海域</span><span>舰船与来袭记录</span></div>${boardMarkup('own')}</div><div class="play-board target-board"><div class="board-title"><span>对方海域</span><span>${state.phase === 'over' ? '最终战况' : state.turn === 'you' ? '点击格子发动攻击' : '等待对方行动'}</span></div>${boardMarkup('target')}</div></div><div class="battle-legend"><span><i class="legend-ship"></i>己方舰船</span><span><i class="legend-hit">×</i>命中 / 击沉</span><span><i class="legend-miss">·</i>未命中</span></div>${state.phase === 'over' ? '<button class="primary new-game" id="home">返回首页</button>' : ''}</section>`;
  }
  function render() {
    const status = offline ? '连接中断，正在自动重试…' : notice;
    app.innerHTML = `${status ? `<div class="notice" role="alert">${esc(status)}<button id="dismiss" aria-label="关闭">×</button></div>` : ''}${state ? roomMarkup() : session ? '<div class="loading">正在重新连接房间…</div>' : homeMarkup()}`;
    app.querySelector('#dismiss')?.addEventListener('click', () => { notice = ''; render(); });
    app.querySelector('#create')?.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      try { setSession(await api('/api/rooms', 'POST', { name: app.querySelector('#name').value })); }
      catch (error) { say(error.message); }
      finally { busy = false; }
    });
    app.querySelector('#join')?.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      try { const code = app.querySelector('#code').value.trim().toUpperCase(); setSession(await api(`/api/rooms/${encodeURIComponent(code)}/join`, 'POST', { name: app.querySelector('#name').value })); }
      catch (error) { say(error.message); }
      finally { busy = false; }
    });
    app.querySelector('#name')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') app.querySelector('#create')?.click();
    });
    app.querySelector('#code')?.addEventListener('input', (event) => {
      const input = event.currentTarget;
      const start = input.selectionStart;
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      input.setSelectionRange(start, start);
    });
    app.querySelector('#code')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') app.querySelector('#join')?.click();
    });
    app.querySelector('#rotate')?.addEventListener('click', () => { direction = direction === 'h' ? 'v' : 'h'; render(); });
    app.querySelectorAll('[data-ship]').forEach((button) => button.addEventListener('click', () => {
      if (button.disabled) return;
      selectedShipId = button.dataset.ship;
      render();
    }));
    app.querySelectorAll('[data-board="placement"]').forEach((cell) => cell.addEventListener('click', async () => {
      if (busy || !state || state.you.ready) return;
      const ship = state.fleet.find((item) => item.id === selectedShipId && !state.you.ships.some((placed) => placed.id === item.id));
      if (!ship) return;
      busy = true;
      try {
        state = await api(`/api/rooms/${state.code}/place?playerId=${encodeURIComponent(session.playerId)}`, 'POST', { shipId: ship.id, x: Number(cell.dataset.x), y: Number(cell.dataset.y), direction });
        selectedShipId = state.fleet.find((item) => !state.you.ships.some((placed) => placed.id === item.id))?.id || '';
        notice = '';
        render();
      } catch (error) { say(error.message); }
      finally { busy = false; }
    }));
    app.querySelectorAll('[data-board="target"]').forEach((cell) => cell.addEventListener('click', async () => {
      if (busy || state?.turn !== 'you') return;
      busy = true;
      try {
        state = await api(`/api/rooms/${state.code}/attack?playerId=${encodeURIComponent(session.playerId)}`, 'POST', { x: Number(cell.dataset.x), y: Number(cell.dataset.y) });
        notice = state.outgoing.at(-1).result === 'miss' ? '落空了，对方回合。' : state.outgoing.at(-1).result === 'sunk' ? '命中并击沉一艘舰船！' : '命中！对方回合。';
        render();
      } catch (error) { say(error.message); }
      finally { busy = false; }
    }));
    app.querySelector('#copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.code); say('房间码已复制。'); }
      catch { say(`房间码：${state.code}`); }
    });
    app.querySelector('#leave')?.addEventListener('click', () => { saveSession(null); state = null; notice = ''; render(); });
    app.querySelector('#home')?.addEventListener('click', () => { saveSession(null); state = null; notice = ''; render(); });
  }
  render();
  if (session) refresh();
  setInterval(() => { if (session && !busy) refresh(true); }, 1200);
})();
