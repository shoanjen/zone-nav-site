/* 抽屉同步 · popup */
const API = 'http://127.0.0.1:4780';
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
let NAME = '';

function genName() {
  return '资料-' + crypto.randomUUID().slice(0, 4).toUpperCase();
}

async function ensureName() {
  const st = await chrome.storage.local.get('profileName');
  let n = st.profileName || '';
  if (!n || n.includes('@')) {
    n = genName();
    await chrome.storage.local.set({ profileName: n });
  }
  return n;
}

function paintSelect(count) {
  const sel = $('#profSel');
  sel.innerHTML = '';
  const o = document.createElement('option');
  o.value = NAME;
  o.textContent = count != null ? `${NAME} (${count})` : NAME;
  const o2 = document.createElement('option');
  o2.value = '__rename';
  o2.textContent = '＋ 改名…';
  sel.append(o, o2);
  sel.value = NAME;
}

function startRename() {
  $('#profSel').classList.add('hidden');
  const inp = $('#profInput');
  inp.classList.remove('hidden');
  inp.value = '';
  inp.focus();
}

function endRename() {
  $('#profInput').classList.add('hidden');
  $('#profSel').classList.remove('hidden');
}

async function commitRename() {
  const inp = $('#profInput');
  const v = inp.value.trim();
  endRename();
  if (!v || v === NAME) return;
  const from = NAME;
  NAME = v;
  await chrome.storage.local.set({ profileName: v });
  chrome.runtime.sendMessage({ type: 'profile-rename', from, to: v });
  paintSelect();
  setStatusLine();
}

function setStatusLine() {
  chrome.identity.getProfileUserInfo({}).then((info) => {
    const email = (info && info.email) || '';
    $('#profStatus').textContent =
      `这个个人资料的名称是「${NAME}」。不同 Chrome 资料要起不同的名字才能分开。当前 Chrome 登录账号：${email || '当前 Chrome 资料未登录账号'}。`;
  }).catch(() => {
    $('#profStatus').textContent =
      `这个个人资料的名称是「${NAME}」。不同 Chrome 资料要起不同的名字才能分开。当前 Chrome 资料未登录账号。`;
  });
}

async function init() {
  NAME = await ensureName();
  paintSelect();

  // 条数（取不到则无条数）
  try {
    const r = await fetch(API + '/api/profiles');
    const j = await r.json();
    const p = (j.profiles || []).find((x) => x.name === NAME);
    if (p) paintSelect(p.count);
  } catch {}

  setStatusLine();

  const st = await chrome.storage.local.get(['removeAfterSync', 'syncMode']);
  $('#rmChk').checked = st.removeAfterSync !== false;
  const mode = st.syncMode || 'ask';
  const radio = document.querySelector(`input[name=mode][value="${mode}"]`);
  if (radio) radio.checked = true;

  const q = (await chrome.storage.local.get('pendingQueue')).pendingQueue || [];
  if (q.length) {
    const b = $('#queueBtn');
    b.classList.remove('hidden');
    b.textContent = `有 ${q.length} 条待归类 · 去选分类`;
  }
}

$('#profSel').addEventListener('change', (e) => {
  if (e.target.value === '__rename') startRename();
});
$('#profInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitRename();
  else if (e.key === 'Escape') { e.target.value = ''; endRename(); }
});
$('#profInput').addEventListener('blur', () => {
  if (!$('#profInput').classList.contains('hidden')) commitRename();
});

$('#rmChk').addEventListener('change', (e) => {
  chrome.storage.local.set({ removeAfterSync: e.target.checked });
});
document.querySelectorAll('input[name=mode]').forEach((r) => {
  r.addEventListener('change', () => chrome.storage.local.set({ syncMode: r.value }));
});

$('#queueBtn').addEventListener('click', async () => {
  await send({ type: 'open-picker' });
  window.close();
});

$('#collectBtn').addEventListener('click', async () => {
  const r = await send({ type: 'collect-tab' });
  if (r && r.ok) {
    window.close();
    return;
  }
  const s = $('#statusLine');
  s.textContent = '收藏失败：这页不是 http/https 网页，无法收进抽屉。';
  s.classList.add('red');
});

$('#importBtn').addEventListener('click', async () => {
  const btn = $('#importBtn');
  const s = $('#statusLine');
  btn.disabled = true;
  btn.textContent = '正在导入…';
  s.classList.remove('red');
  try {
    const r = await send({ type: 'import-all' });
    if (r && r.ok) {
      s.textContent = `已导入 ${r.count} 个书签，已按 Chrome 文件夹归类。`;
    } else {
      s.textContent = '导入失败：确认本地服务已启动（node server.js）';
      s.classList.add('red');
    }
  } catch {
    s.textContent = '导入失败：确认本地服务已启动（node server.js）';
    s.classList.add('red');
  }
  btn.disabled = false;
  btn.textContent = '导入现有全部书签';
});

$('#openBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: API });
});

init();
