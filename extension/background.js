/* 抽屉同步 · MV3 service worker */
const API = 'http://127.0.0.1:4780';
const LINKS_API = API + '/api/links';
const ROOT_IDS = new Set(['0', '1', '2', '3']); // 0 根、1 书签栏、2 其他书签、3 移动书签
let pickerWindowId = null;

/* ---------- 基础 ---------- */

async function push(link) {
  const r = await fetch(LINKS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(link),
  });
  if (!r.ok) throw new Error('push failed: ' + r.status);
  return r.json();
}

function flashBadge(text) {
  chrome.action.setBadgeBackgroundColor({ color: '#A23B2A' });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
}

/* 个人资料身份：扩展在每个 Chrome 个人资料是独立实例、storage 不共享，
   资料名必须每个实例独立，绝不能用邮箱当身份（旧版本曾用邮箱，会导致同账号多资料撞名）。 */
async function ensureProfileName() {
  const st = await chrome.storage.local.get('profileName');
  let n = st.profileName || '';
  if (!n || n.includes('@')) {
    n = '资料-' + crypto.randomUUID().slice(0, 4).toUpperCase();
    await chrome.storage.local.set({ profileName: n });
  }
  return n;
}
ensureProfileName();

async function getProfileName() {
  const st = await chrome.storage.local.get('profileName');
  return String(st.profileName || '').trim() || '默认';
}

/* ---------- 待归类队列 ---------- */

async function getQueue() {
  const st = await chrome.storage.local.get('pendingQueue');
  return st.pendingQueue || [];
}

async function setQueue(q) {
  await chrome.storage.local.set({ pendingQueue: q });
  await updateBadge();
}

async function updateBadge() {
  const q = await getQueue();
  if (q.length) {
    chrome.action.setBadgeBackgroundColor({ color: '#A87C2A' });
    chrome.action.setBadgeText({ text: String(q.length) });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/* 队列中 chromeId 不以 tab: 开头且书签已被删的条目剔除 */
async function reconcileQueue() {
  const q = await getQueue();
  const kept = [];
  for (const item of q) {
    if (String(item.chromeId).startsWith('tab:')) { kept.push(item); continue; }
    try { await chrome.bookmarks.get(item.chromeId); kept.push(item); } catch {}
  }
  if (kept.length !== q.length) await setQueue(kept);
}

async function openPicker() {
  await reconcileQueue();
  const q = await getQueue();
  if (!q.length) return;
  if (pickerWindowId != null) {
    try {
      await chrome.windows.get(pickerWindowId);
      await chrome.windows.update(pickerWindowId, { focused: true });
      return;
    } catch {
      pickerWindowId = null;
    }
  }
  const win = await chrome.windows.create({ url: 'picker.html', type: 'popup', width: 420, height: 360 });
  pickerWindowId = win.id;
}

chrome.windows.onRemoved.addListener((wid) => {
  if (wid === pickerWindowId) pickerWindowId = null;
});

/* ---------- 文件夹路径 ---------- */

async function folderOf(parentId) {
  const parts = [];
  let id = parentId;
  let guard = 0;
  while (id && !ROOT_IDS.has(id) && guard++ < 50) {
    let node;
    try { [node] = await chrome.bookmarks.get(id); } catch { break; }
    if (!node || !node.title) break; // 遇根节点或空 title 停止
    parts.unshift(node.title);
    id = node.parentId;
  }
  return parts.join('/');
}

/* ---------- 书签事件 ---------- */

chrome.bookmarks.onCreated.addListener(async (id, node) => {
  if (!node.url) return;
  const st = await chrome.storage.local.get(['syncMode', 'removeAfterSync']);
  const mode = st.syncMode || 'ask';
  const removeAfter = st.removeAfterSync !== false; // 默认 true
  if (mode === 'folder') {
    const category = await folderOf(node.parentId);
    try {
      await push({ url: node.url, title: node.title || '', category, profile: await getProfileName(), source: 'chrome' });
      if (removeAfter) {
        try { await chrome.bookmarks.remove(id); } catch {}
      }
    } catch {
      flashBadge('!');
    }
  } else {
    const q = await getQueue();
    if (!q.some((it) => it.chromeId === id)) q.push({ chromeId: id, title: node.title || '', url: node.url });
    await setQueue(q);
    openPicker();
  }
});

/* 在 Chrome 里取消收藏 = 最终不想要 → 清掉队列条目 */
chrome.bookmarks.onRemoved.addListener(async (id) => {
  const q = await getQueue();
  const kept = q.filter((it) => it.chromeId !== id);
  if (kept.length !== q.length) await setQueue(kept);
});

/* ---------- 消息路由 ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'profile-rename': {
          // 迁移服务端存量（fire-and-forget）
          try {
            const from = msg.from || (await getProfileName());
            if (from && msg.to) {
              await fetch(`${API}/api/profiles/${encodeURIComponent(from)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: msg.to }),
              });
            }
          } catch {}
          sendResponse({ ok: true });
          break;
        }
        case 'import-all': {
          let count = 0;
          let netFail = false;
          try {
            const tree = await chrome.bookmarks.getTree();
            const profile = await getProfileName();
            const walk = async (node, category) => {
              for (const child of node.children || []) {
                if (child.url) {
                  try {
                    await push({ url: child.url, title: child.title || '', category, profile, source: 'chrome-import' });
                    count++;
                  } catch (e) {
                    if (e instanceof TypeError) netFail = true;
                  }
                } else {
                  // 根节点和无标题文件夹不产生分类段
                  const seg = ROOT_IDS.has(child.id) || !child.title ? '' : child.title;
                  const childCat = seg ? (category ? category + '/' + seg : seg) : category;
                  await walk(child, childCat);
                }
              }
            };
            await walk(tree[0], '');
          } catch {
            netFail = true;
          }
          sendResponse({ ok: !netFail, count });
          break;
        }
        case 'open-picker':
          await openPicker();
          sendResponse({ ok: true });
          break;
        case 'collect-tab':
          sendResponse(await collectActiveTab());
          break;
        case 'picker-save':
          sendResponse(await handlePickerSave(msg));
          break;
        case 'picker-skip':
          await handlePickerSkip(msg);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'unknown-message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // 异步响应
});

/* ---------- 收藏当前标签页 ---------- */

async function collectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || '')) return { ok: false, error: 'unsupported-url' };
    const q = await getQueue();
    if (q.some((it) => it.url === tab.url)) {
      await openPicker();
      return { ok: true, duplicated: true };
    }
    const chromeId = 'tab:' + crypto.randomUUID(); // 标记非书签条目
    q.push({ chromeId, title: tab.title || '', url: tab.url });
    await setQueue(q);
    await openPicker();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ---------- picker 保存 / 跳过 ---------- */

async function handlePickerSave(msg) {
  try {
    const removeAfter = (await chrome.storage.local.get('removeAfterSync')).removeAfterSync !== false;
    await push({
      url: msg.url,
      title: msg.title || '',
      category: msg.category || '',
      profile: await getProfileName(),
      source: 'chrome',
    });
    if (removeAfter && !String(msg.chromeId).startsWith('tab:')) {
      try { await chrome.bookmarks.remove(msg.chromeId); } catch {}
    }
    const q = await getQueue();
    await setQueue(q.filter((it) => it.chromeId !== msg.chromeId));
    return { ok: true };
  } catch {
    return { ok: false, error: 'server' };
  }
}

async function handlePickerSkip(msg) {
  const q = await getQueue();
  await setQueue(q.filter((it) => it.chromeId !== msg.chromeId)); // 保留在 Chrome 书签里
}

/* ---------- 快捷键 ---------- */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'collect-tab') await collectActiveTab();
});

updateBadge();
reconcileQueue();
