/* 抽屉同步 · picker（逐条处理待归类队列） */
const API = 'http://127.0.0.1:4780';
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

let queue = [];
let busy = false;
let cats = [];        // 服务端 categories
let lastCat = null;   // 记住上次选择
let dd = null;

function setStatus(text, red) {
  const s = $('#status');
  s.textContent = text || '';
  s.classList.toggle('red', !!red);
}

function catOptions() {
  const list = [UNC, ...cats.filter((c) => c !== UNC)];
  return list.map((c) => ({ value: c, label: c }))
    .concat([{ value: '__new', label: '＋ 新建分类…', className: 'amber' }]);
}

function ddValue() { return dd ? dd.get() : UNC; }

function showNewInput(show) {
  const inp = $('#newCat');
  inp.classList.toggle('hidden', !show);
  if (show) { inp.value = ''; inp.focus(); }
}

function buildDd() {
  const mount = $('#catDd');
  mount.innerHTML = '';
  const opts = catOptions();
  const def = lastCat && opts.some((o) => o.value === lastCat) ? lastCat : opts[0].value;
  dd = makeDd({
    mount,
    items: opts,
    value: def,
    onChange: (v) => showNewInput(v === '__new'),
  });
  showNewInput(def === '__new');
}

/* 极简自定义下拉（popup 窗口内使用） */
function makeDd(cfg) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  const lbl = document.createElement('span');
  lbl.className = 'dd-lbl';
  const car = document.createElement('span');
  car.className = 'dd-car';
  car.textContent = '▾';
  btn.append(lbl, car);
  cfg.mount.appendChild(btn);
  let items = cfg.items;
  let value = cfg.value;
  let pop = null;
  const labelOf = (it) => it.label;
  const paint = () => {
    const it = items.find((i) => i.value === value) || items[0];
    lbl.textContent = it ? labelOf(it) : '';
  };
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null;
    document.removeEventListener('mousedown', out, true);
  };
  const out = (e) => {
    if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close();
  };
  const open = () => {
    if (pop) return close();
    pop = document.createElement('div');
    pop.className = 'dd-pop';
    pop.setAttribute('role', 'listbox');
    for (const it of items) {
      const o = document.createElement('div');
      o.className = 'dd-item' + (it.value === value ? ' sel' : '') + (it.className ? ' ' + it.className : '');
      o.setAttribute('role', 'option');
      o.setAttribute('aria-selected', String(it.value === value));
      o.innerHTML = `<span>${it.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span><span class="ck">✓</span>`;
      o.addEventListener('mousedown', (e) => e.preventDefault());
      o.addEventListener('click', () => {
        value = it.value;
        paint(); close();
        if (cfg.onChange) cfg.onChange(value);
      });
      pop.appendChild(o);
    }
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = r.left + 'px';
    pop.style.top = (r.bottom + 4) + 'px';
    pop.style.minWidth = r.width + 'px';
    pop.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - 12) + 'px';
    document.addEventListener('mousedown', out, true);
  };
  btn.addEventListener('click', open);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  paint();
  return { get: () => value, set(items2, value2) { items = items2; value = value2; paint(); }, close };
}

function render() {
  if (!queue.length) {
    $('#tTitle').value = '';
    $('#tUrl').textContent = '';
    setStatus('全部归类完成');
    setTimeout(() => window.close(), 700);
    return;
  }
  const it = queue[0];
  $('#tTitle').value = it.title || '';
  $('#tUrl').textContent = it.url || '';
  const remaining = queue.length - 1;
  if (remaining > 0) setStatus(`还有 ${remaining} 条待归类`);
  else if (!$('#status').classList.contains('red')) setStatus('');
  buildDd();
}

async function refresh() {
  const st = await chrome.storage.local.get(['pendingQueue', 'lastCat']);
  queue = st.pendingQueue || [];
  lastCat = st.lastCat || null;
  render();
}

async function save() {
  if (busy || !queue.length) return;
  let cat = ddValue();
  if (cat === '__new') {
    cat = $('#newCat').value.trim();
    if (!cat) { setStatus('分类名不能为空', true); $('#newCat').focus(); return; }
  }
  busy = true;
  $('#saveBtn').disabled = true;
  $('#skipBtn').disabled = true;
  setStatus('正在保存…');
  const it = queue[0];
  const title = $('#tTitle').value.trim() || it.title;
  const r = await send({ type: 'picker-save', chromeId: it.chromeId, title, url: it.url, category: cat });
  busy = false;
  $('#saveBtn').disabled = false;
  $('#skipBtn').disabled = false;
  if (r && r.ok) {
    lastCat = cat;
    await chrome.storage.local.set({ lastCat: cat });
    await refresh();
  } else {
    setStatus('保存失败：确认本地服务已启动（node server.js）', true);
  }
}

async function skip() {
  if (busy || !queue.length) return;
  busy = true;
  const it = queue[0];
  await send({ type: 'picker-skip', chromeId: it.chromeId });
  busy = false;
  await refresh();
}

$('#saveBtn').addEventListener('click', save);
$('#skipBtn').addEventListener('click', skip);
$('#tTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
$('#newCat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
  else if (e.key === 'Escape') { showNewInput(false); }
});

/* 队列变化（非 busy 时）自动刷新 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pendingQueue && !busy) refresh();
});

/* 启动：拉服务端分类 + 队列 */
(async () => {
  try {
    const r = await fetch(API + '/api/links');
    const j = await r.json();
    cats = j.categories || [];
  } catch {
    setStatus('连不上本地服务，可手填新分类，或稍后再试', true);
  }
  await refresh();
})();
