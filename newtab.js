/* ============================================================
 * OMOnewtab — 核心逻辑
 * 管理浏览器原生收藏夹（chrome.bookmarks），Manifest V3
 * ============================================================ */

/* 构建标记：显示在页面右下角，用于确认浏览器跑的是最新代码 */
const BUILD = '20260806-6';

/* ---------- 小工具 ---------- */
function el(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}

function colorFor(seed) {
  const palette = ['#185FA5', '#0F6E56', '#993C1D', '#854F0B', '#7F77DD', '#D4537E', '#3B6D11', '#993556'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/* ---------- 工作页固定工具 ----------
 * 想换成你们的工作工具，改这个数组即可：
 * { name: 显示名称, url: 网址, color: 图标底色（可省略，自动取色） }
 */
const WORK_TOOLS = [
  { name: '邮箱',     url: 'https://mail.qq.com',          color: '#185FA5' },
  { name: '日历',     url: 'https://calendar.tencent.com', color: '#0F6E56' },
  { name: '会议',     url: 'https://meeting.tencent.com',  color: '#7F77DD' },
  { name: '文档',     url: 'https://docs.qq.com',          color: '#3B6D11' },
  { name: '企业微信', url: 'https://work.weixin.qq.com',   color: '#993C1D' },
  { name: '翻译',     url: 'https://fanyi.baidu.com',      color: '#854F0B' }
];

/* 工作页自动同步的收藏夹名称：
 * 在浏览器收藏夹中建一个同名文件夹并放入常用工具，
 * 工作页就会自动显示其中内容；找不到该文件夹时回退到上面的固定列表 */
const WORK_FOLDER = '工具A';

/* 私人页左侧栏自动同步的收藏夹名称（同上逻辑，找不到时显示提示） */
const PRIVATE_FOLDER = '工具B';

/* ---------- SVG 图标（静态标记，无内联脚本） ---------- */
const SVG = {
  chevron: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 3.5h4.2l1.6 2H14v7.2H2z" fill="currentColor" opacity="0.85"/></svg>',
  edit: '<svg viewBox="0 0 16 16"><path d="M11.3 2.3a1.1 1.1 0 0 1 1.6 0l.8.8a1.1 1.1 0 0 1 0 1.6L6 12.4 3 13l.6-3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M3 4h10M6.5 4V2.9c0-.5.4-.9.9-.9h1.2c.5 0 .9.4.9.9V4M4.5 4l.6 8.9c0 .6.5 1.1 1.1 1.1h3.6c.6 0 1.1-.5 1.1-1.1L11.5 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
};

/* ---------- 时钟 / 日期 ---------- */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function updateClock() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  el('clock').textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  el('date').textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()];
}

/* ---------- 搜索栏 ---------- */
function resolveUrl(input) {
  try {
    const u = new URL(input);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) { /* 不是合法 URL，继续判断 */ }
  if (/^[^\s]+\.[^\s]{2,}$/.test(input) && input.indexOf('://') === -1) {
    return 'https://' + input;
  }
  return 'https://www.bing.com/search?q=' + encodeURIComponent(input);
}

/* ---------- Favicon 三层降级 ----------
 * 1) 浏览器缓存图标 chrome-extension://<id>/_favicon/
 * 2) 国内 CDN（cravatar → icon.horse）
 * 3) 域名首字母彩色占位（本地，永远可用） */
function faviconSrc(url) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url);
  u.searchParams.set('size', '32');
  return u.href;
}

function fallbackToCdn(img, url) {
  const domain = hostname(url);
  const stage = img.dataset.stage || 'cdn1';
  if (stage === 'cdn2') {
    const wrap = img.parentElement;
    const fb = document.createElement('span');
    fb.className = 'bm-ico-fallback';
    fb.style.background = colorFor(domain || '?');
    fb.textContent = (domain[0] || '?').toUpperCase();
    wrap.replaceChild(fb, img);
    return;
  }
  img.dataset.stage = stage === 'cdn1' ? 'cdn2' : 'done';
  img.src = stage === 'cdn1'
    ? 'https://cravatar.com/favicon/api/index.php?url=' + encodeURIComponent(domain)
    : 'https://icon.horse/icon/' + domain;
  img.addEventListener('error', () => fallbackToCdn(img, url), { once: true });
}

/* ---------- 收藏夹：状态与渲染 ---------- */
let bookmarksTree = null;
const expanded = new Set(['1', '2']);   // 已展开的顶层分组（默认展开书签栏/其他书签）

function countBookmarks(node) {
  let n = 0;
  for (const c of (node.children || [])) {
    if (c.url) n++;
    else n += countBookmarks(c);
  }
  return n;
}

function renderBookmarkRow(node, depth) {
  const row = document.createElement('div');
  row.className = 'bm-row';
  row.style.paddingLeft = (8 + depth * 16) + 'px';
  row.dataset.id = node.id;
  row.dataset.url = node.url || '';
  row.dataset.parentId = node.parentId || '';
  row.draggable = true;      // 支持拖到其他文件夹

  const icoWrap = document.createElement('span');
  icoWrap.className = 'bm-ico-wrap';
  const img = document.createElement('img');
  img.className = 'bm-ico';
  img.alt = '';
  img.loading = 'lazy';
  img.src = faviconSrc(node.url);
  img.addEventListener('error', () => fallbackToCdn(img, node.url), { once: true });
  icoWrap.appendChild(img);

  const check = document.createElement('span');
  check.className = 'bm-check';
  check.textContent = '✓';

  const title = document.createElement('span');
  title.className = 'bm-title';
  title.textContent = node.title || hostname(node.url) || node.url;
  title.title = node.title || node.url;

  const domain = document.createElement('span');
  domain.className = 'bm-domain';
  domain.textContent = hostname(node.url);

  const actions = document.createElement('span');
  actions.className = 'bm-actions';
  actions.innerHTML =
    '<button class="icon-btn edit" title="编辑">' + SVG.edit + '</button>' +
    '<button class="icon-btn danger del" title="删除">' + SVG.trash + '</button>';
  actions.querySelector('.edit').addEventListener('click', e => { e.stopPropagation(); openEdit(node); });
  actions.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); deleteNode(node); });

  row.append(check, icoWrap, title, domain, actions);
  row.addEventListener('click', e => {
    if (multiMode) { toggleSel(node.id); return; }
    openNode(node, e);
  });
  row.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); openNode(node, e); } });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    if (multiMode) { toggleSel(node.id); return; }   // 多选模式：右键也切换选中
    showMenu(e.clientX, e.clientY, [
      { label: '打开', action: () => { window.location.href = node.url; } },
      { label: '在新标签页打开', action: () => { window.open(node.url, '_blank'); } },
      '-',
      { label: '多选', action: () => enterMultiMode(node.id) },
      '-',
      { label: '编辑', action: () => openEdit(node) },
      { label: '删除', action: () => deleteNode(node), danger: true }
    ]);
  });
  return row;
}

function renderFolderRow(folder, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'bm-folder';

  const row = document.createElement('div');
  row.className = 'bm-folder-row';
  row.style.paddingLeft = (8 + depth * 16) + 'px';
  row.dataset.id = folder.id;
  row.dataset.parentId = folder.parentId || '';
  row.draggable = true;      // 支持拖到其他文件夹
  const chev = document.createElement('span');
  chev.className = 'chevron';
  chev.innerHTML = SVG.chevron;
  const check = document.createElement('span');
  check.className = 'bm-check';
  check.textContent = '✓';
  const ico = document.createElement('span');
  ico.className = 'bm-folder-ico';
  ico.innerHTML = SVG.folder;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = folder.title || '未命名文件夹';
  name.title = name.textContent;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = countBookmarks(folder);

  const body = document.createElement('div');
  body.className = 'bm-folder-body';
  body.hidden = true;
  body.appendChild(renderChildren(folder.children || [], depth + 1));

  row.addEventListener('click', () => {
    if (multiMode) { toggleSel(folder.id); return; }   // 多选模式：切换选中
    const willOpen = body.hidden;        // 当前收起 → 点击展开
    body.hidden = !willOpen;
    row.classList.toggle('arrow-down', willOpen);   // 展开 → 箭头向下；收起 → 横向
    if (willOpen) expanded.add(folder.id); else expanded.delete(folder.id);
  });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    if (multiMode) { toggleSel(folder.id); return; }   // 多选模式：右键也切换选中
    showMenu(e.clientX, e.clientY, [
      { label: '在此新建文件夹', action: () => openNew(folder.id) },
      '-',
      { label: '多选', action: () => enterMultiMode(folder.id) },
      '-',
      { label: '重命名', action: () => openEdit(folder) },
      { label: '删除文件夹', action: () => deleteNode(folder), danger: true }
    ]);
  });

  row.append(check, chev, ico, name, count);
  wrap.append(row, body);
  return wrap;
}

function renderChildren(children, depth) {
  const frag = document.createDocumentFragment();
  for (const c of children) {
    if (c.url) frag.appendChild(renderBookmarkRow(c, depth));
    else frag.appendChild(renderFolderRow(c, depth));
  }
  return frag;
}

function renderSection(rootChild) {
  const section = document.createElement('div');
  section.className = 'bm-section';
  section.dataset.id = rootChild.id;

  const head = document.createElement('div');
  head.className = 'bm-section-head';
  head.dataset.id = rootChild.id;
  head.draggable = true;     // 支持拖到另一个顶级分组
  const chev = document.createElement('span');
  chev.className = 'chevron';
  chev.innerHTML = SVG.chevron;
  const ico = document.createElement('span');
  ico.className = 'bm-folder-ico';
  ico.innerHTML = SVG.folder;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = rootChild.title || '未命名文件夹';
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = countBookmarks(rootChild);

  const body = document.createElement('div');
  body.className = 'bm-section-body';
  body.appendChild(renderChildren(rootChild.children || [], 0));

  head.append(chev, ico, name, count);
  head.addEventListener('click', () => {
    const willOpen = body.hidden;        // 当前收起 → 点击展开
    body.hidden = !willOpen;
    head.classList.toggle('arrow-down', willOpen);   // 展开 → 箭头向下；收起 → 横向
    if (willOpen) expanded.add(rootChild.id); else expanded.delete(rootChild.id);
  });
  head.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, [
      { label: '在此新建文件夹', action: () => openNew(rootChild.id) }
    ]);
  });

  // 按记忆的展开状态渲染
  const defaultOpen = expanded.has(rootChild.id);
  body.hidden = !defaultOpen;
  head.classList.toggle('arrow-down', defaultOpen);   // 展开 → 箭头向下；收起 → 横向

  section.append(head, body);
  return section;
}

function renderTree() {
  chrome.bookmarks.getTree().then(tree => {
    bookmarksTree = tree[0];
    const list = el('bookmarkList');
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    let total = 0;
    for (const child of (bookmarksTree.children || [])) {
      if (child.id === '3') continue; // 跳过「移动端书签」
      if (child.children && child.children.length) {
        frag.appendChild(renderSection(child));
        total += countBookmarks(child);
      }
    }
    list.appendChild(frag);
    el('emptyHint').classList.toggle('hidden', total > 0);
  }).catch(err => {
    el('bookmarkList').innerHTML = '<div class="empty-hint">读取收藏失败：' + esc(err.message) + '</div>';
  });
}

function openNode(node) {
  if (!node.url) return;
  window.open(node.url, '_blank');   // 点击收藏始终在新标签页打开，当前页保持不动
}

/* ---------- 增删改 ---------- */
function deleteNode(node) {
  const label = node.title || hostname(node.url) || node.url || '此项';
  const msg = node.url
    ? '确定删除收藏「' + label + '」吗？'
    : '确定删除文件夹「' + label + '」及其中的全部收藏吗？';
  if (!confirm(msg)) return;
  if (node.url) chrome.bookmarks.remove(node.id);
  else chrome.bookmarks.removeTree(node.id);
}

/* ---------- 多选模式（批量勾选 + 批量删除） ---------- */
let multiMode = false;
const multiSel = new Set();

function enterMultiMode(id) {
  multiMode = true;
  multiSel.clear();
  if (id) multiSel.add(id);
  document.body.classList.add('multi-mode');
  el('multiBar').classList.remove('hidden');
  updateMultiUI();
}

function exitMultiMode() {
  multiMode = false;
  multiSel.clear();
  document.body.classList.remove('multi-mode');
  el('multiBar').classList.add('hidden');
  updateMultiUI();
}

function toggleSel(id) {
  if (multiSel.has(id)) multiSel.delete(id);
  else multiSel.add(id);
  updateMultiUI();
}

function updateMultiUI() {
  el('multiCount').textContent = '已选 ' + multiSel.size + ' 项';
  document.querySelectorAll('.bm-row, .bm-folder-row').forEach(r => {
    r.classList.toggle('multi-selected', multiSel.has(r.dataset.id));
  });
}

function multiDelete() {
  if (!multiSel.size) return;
  if (!confirm('确定删除选中的 ' + multiSel.size + ' 项？文件夹会连同其中的内容一起删除。')) return;
  multiSel.forEach(id => {
    const n = findNodeById(bookmarksTree, id);
    if (n && n.url) chrome.bookmarks.remove(id);
    else chrome.bookmarks.removeTree(id);
  });
  exitMultiMode();
}

const modalState = { mode: 'new', id: null, parentId: '2', isFolder: false };

function collectFolders(node, depth, out) {
  for (const c of (node.children || [])) {
    if (!c.url) {
      out.push({ id: c.id, name: (depth > 0 ? '　'.repeat(depth) : '') + (c.title || '未命名文件夹') });
      collectFolders(c, depth + 1, out);
    }
  }
}

function fillParentOptions() {
  const sel = el('fldParent');
  sel.innerHTML = '';
  const folders = [];
  const rootNames = { '1': '书签栏', '2': '其他书签' };
  for (const c of (bookmarksTree.children || [])) {
    if (c.id === '3') continue;
    folders.push({ id: c.id, name: rootNames[c.id] || c.title || '未命名文件夹' });
    collectFolders(c, 1, folders);
  }
  for (const f of folders) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name;
    sel.appendChild(o);
  }
  if (folders.some(f => String(f.id) === String(modalState.parentId))) {
    sel.value = modalState.parentId;
  } else {
    sel.value = '2';
    modalState.parentId = '2';
  }
}

function syncModal() {
  const isNew = modalState.mode === 'new';
  el('parentRow').classList.toggle('hidden', !isNew);
  el('urlRow').classList.toggle('hidden', modalState.isFolder);   // 新建文件夹/编辑文件夹时隐藏网址
  if (isNew) fillParentOptions();
}

function openModal() { el('modalMask').classList.remove('hidden'); }
function closeModal() { el('modalMask').classList.add('hidden'); }

/* 新建：仅支持新建文件夹 */
function openNew(parentId) {
  modalState.mode = 'new';
  modalState.id = null;
  modalState.parentId = parentId || '2';
  modalState.isFolder = true;
  el('modalTitle').textContent = '新建文件夹';
  el('fldTitle').value = '';
  el('fldUrl').value = '';
  syncModal();
  openModal();
  el('fldTitle').focus();
}

function openEdit(node) {
  modalState.mode = 'edit';
  modalState.id = node.id;
  modalState.isFolder = !node.url;
  el('modalTitle').textContent = modalState.isFolder ? '重命名文件夹' : '编辑收藏';
  el('fldTitle').value = node.title || '';
  el('fldUrl').value = node.url || '';
  syncModal();
  openModal();
  el('fldTitle').focus();
}

function normalizeUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = 'https://' + url;
  return url;
}

function saveModal() {
  const title = el('fldTitle').value.trim();
  if (modalState.mode === 'new') {
    // 新建：仅文件夹
    if (!title) { alert('请填写名称'); return; }
    const parentId = el('fldParent').value;
    chrome.bookmarks.create({ parentId: parentId, title: title });
  } else {
    const patch = { title: title };
    if (!modalState.isFolder) {
      const url = normalizeUrl(el('fldUrl').value);
      if (!url) { alert('请填写网址'); return; }
      patch.url = url;
    }
    chrome.bookmarks.update(modalState.id, patch);
  }
  closeModal();
  renderTree();
}

/* ---------- 自定义右键菜单 ---------- */
const ctxMenu = el('ctxMenu');

function showMenu(x, y, items) {
  ctxMenu.innerHTML = '';
  for (const it of items) {
    if (it === '-') {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      ctxMenu.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    b.addEventListener('click', () => { hideMenu(); it.action(); });
    ctxMenu.appendChild(b);
  }
  ctxMenu.classList.remove('hidden');
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  ctxMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}

function hideMenu() { ctxMenu.classList.add('hidden'); }

/* ---------- 工作页：固定工具 + 上下翻页导航 ---------- */
function makeToolItem(url, name) {
  const card = document.createElement('a');
  card.className = 'tool-item';
  card.href = url;
  card.title = url;
  // favicon 图标（加载失败自动回退字母块）
  const tile = document.createElement('span');
  tile.className = 'tool-tile tile-img';
  const img = document.createElement('img');
  img.className = 'bm-ico';
  img.alt = '';
  img.loading = 'lazy';
  img.src = faviconSrc(url);
  img.addEventListener('error', () => fallbackToCdn(img, url), { once: true });
  tile.appendChild(img);
  const label = document.createElement('span');
  label.className = 'tool-name';
  label.textContent = name;
  card.append(tile, label);
  card.addEventListener('click', e => { e.preventDefault(); window.open(url, '_blank'); });
  return card;
}

function renderWorkTools() {
  const grid = el('workTools');
  grid.innerHTML = '';
  for (const t of WORK_TOOLS) {
    grid.appendChild(makeToolItem(t.url, t.name));
  }
}

/* 同步收藏夹「工具A」：以收藏夹内容为准，自动刷新 */
function makeSyncCard(node) {
  return makeToolItem(node.url, node.title || hostname(node.url) || node.url);
}

function findFolder(node, name) {
  for (const c of (node.children || [])) {
    if (!c.url && (c.title || '').trim() === name) return c;
    const r = findFolder(c, name);
    if (r) return r;
  }
  return null;
}

function renderWorkFolder() {
  const grid = el('workTools');
  if (!bookmarksTree) {
    chrome.bookmarks.getTree().then(t => { bookmarksTree = t[0]; renderWorkFolder(); });
    return;
  }
  const folder = findFolder(bookmarksTree, WORK_FOLDER);
  const items = folder && folder.children ? folder.children.filter(c => c.url) : [];
  if (!items.length) { renderWorkTools(); return; }   // 文件夹不存在/为空 → 回退固定列表
  grid.innerHTML = '';
  items.forEach(c => grid.appendChild(makeSyncCard(c)));
}

/* 私人页左侧栏：同步收藏夹「工具B」，找不到时显示提示 */
function renderPrivateFolder() {
  const box = el('privateTools');
  if (!bookmarksTree) {
    chrome.bookmarks.getTree().then(t => { bookmarksTree = t[0]; renderPrivateFolder(); });
    return;
  }
  const folder = findFolder(bookmarksTree, PRIVATE_FOLDER);
  const items = folder && folder.children ? folder.children.filter(c => c.url) : [];
  box.innerHTML = '';
  if (!items.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint side';
    hint.textContent = '未找到「' + PRIVATE_FOLDER + '」文件夹';
    box.appendChild(hint);
    return;
  }
  items.forEach(c => box.appendChild(makeSyncCard(c)));
}

/* ---------- 两页结构：工作页 / 私人页 ---------- */
const PAGES = ['pageWork', 'pagePrivate'];
const ANCHORS = { pageWork: 'anchorWork', pagePrivate: 'anchorPrivate' };

/* 搜索框在页面锚点间飞行（FLIP 动画），时长与翻页滚动保持一致 */
function syncSearchAnchor(target, dur) {
  const bar = el('searchWrap');
  const anchor = el(ANCHORS[target.id] || 'anchorWork');
  if (!anchor || bar.parentElement === anchor) return;   // 已在目标锚点
  const from = bar.getBoundingClientRect();
  anchor.appendChild(bar);
  const to = bar.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  bar.animate([
    { transform: 'translate(' + dx + 'px, ' + dy + 'px)' },
    { transform: 'translate(0, 0)' }
  ], { duration: dur || 300, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' });  // easeOutCubic
  // 保持输入焦点不丢
  const input = bar.querySelector('.search');
  if (document.activeElement === input) input.focus();
}

/* 当前所在页（离哪个页顶最近） */
function currentPage() {
  let best = PAGES[0];
  let bestD = Infinity;
  for (const id of PAGES) {
    const d = Math.abs(window.scrollY - el(id).offsetTop);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/* 无动画地把搜索框同步到当前页（覆盖：启动即在某页、Edge 恢复滚动位置等场景） */
function syncSearchToCurrentPage(silent) {
  const bar = el('searchWrap');
  const cur = currentPage();
  const want = el(ANCHORS[cur]);
  if (!want || bar.parentElement === want) return;
  if (silent) want.appendChild(bar);
  else syncSearchAnchor(el(cur));
}

// 页面滚动导致所在页变化时（非翻页逻辑的滚动，如恢复位置/键盘滚动），静默同步搜索框；
// 同时兜底：任何非翻页滚动若停在页之间，自动吸回最近的页顶（纯翻页模式不允许多余位置）
let lastSide = null;
let snapTimer = null;
window.addEventListener('scroll', () => {
  const side = currentPage();
  if (side !== lastSide) {
    lastSide = side;
    syncSearchToCurrentPage(true);
  }
  if (window.__isJumping) return;              // 翻页动画中不干预
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const tops = PAGES.map(id => el(id).offsetTop);
    let target = 0, best = Infinity;
    for (const t of tops) {
      const d = Math.abs(window.scrollY - t);
      if (d < best) { best = d; target = t; }
    }
    if (Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target);
  }, 120);
}, { passive: true });

function setupPageNav() {
  const pageWork = el('pageWork');
  const pagePrivate = el('pagePrivate');

  // 底部指示点：点击跳页，滚动时高亮当前页
  const nav = el('pageNav');
  nav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => jump(el(btn.dataset.target)));
  });
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        nav.querySelectorAll('button').forEach(b =>
          b.classList.toggle('active', b.dataset.target === en.target.id));
      }
    });
  }, { threshold: 0.4 });
  obs.observe(pageWork);
  obs.observe(pagePrivate);

  // 侧边栏滚轮统一处理（捕获阶段）：源头截断 + 滚到头时取消默认行为
  // （关键：不 preventDefault 时浏览器会把滚动「链式传导」到页面，绕过所有 JS 逻辑）
  window.addEventListener('wheel', e => {
    const side = e.target.closest('.page-private .col-left');
    if (!side) return;
    e.stopImmediatePropagation();
    const canUp = side.scrollTop > 0 && e.deltaY < 0;
    const canDown = side.scrollTop < side.scrollHeight - side.clientHeight - 1 && e.deltaY > 0;
    if (!canUp && !canDown) e.preventDefault();   // 滚到头：禁止滚动链，页面不跟着动
  }, { capture: true, passive: false });

  // 侧边栏水平带 rect：缓存一份，与调试可视化共用（避免视觉与逻辑不一致），resize 时刷新
  let sideRect = null;
  const refreshSideRect = () => {
    const c = pagePrivate.querySelector('.col-left');
    sideRect = c ? c.getBoundingClientRect() : null;
  };
  refreshSideRect();
  window.addEventListener('resize', refreshSideRect);

  // 查找事件目标所在的最近可滚动容器
  function firstScrollable(node) {
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // 纯翻页模式：滚轮只做整页翻转（页面永远停在两页之一）
  let lock = false;
  window.addEventListener('wheel', e => {
    if (lock) {
      // 锁定期（翻页动画中）：内部容器照常滚动；其余事件取消默认行为，
      // 禁止页面原生滚动与动画打架（否则画面抖动）
      const s = firstScrollable(e.target);
      if (s && ((s.scrollTop > 0 && e.deltaY < 0) ||
                (s.scrollTop < s.scrollHeight - s.clientHeight - 1 && e.deltaY > 0))) return;
      e.preventDefault();
      return;
    }

    const onPriv = currentPage() === 'pagePrivate';   // 当前是否在私人页（用于侧边栏水平带判定）

    // 可滚动容器（收藏列表/天气面板等）该方向还能滚 → 交给容器自己滚，不翻页
    const scrollable = firstScrollable(e.target);
    if (scrollable) {
      const canUp = scrollable.scrollTop > 0 && e.deltaY < 0;
      const canDown = scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight - 1 && e.deltaY > 0;
      if (canUp || canDown) { return; }
      if (scrollable.closest('.page-private .col-left')) {
        e.preventDefault();   // 禁止滚动链
        return;
      }
      // 其他容器滚到头 → 继续走翻页
    } else if (e.target.closest('.page-private .col-left') ||
               (onPriv && sideRect &&
                e.clientX >= sideRect.left - 8 && e.clientX <= sideRect.right + 8)) {
      e.preventDefault();   // 禁止滚动链：空白区域也不能带动页面
      return;                                  // 工具B水平带（含空白）不翻页
    }

    // 当前所在页 → 决定翻页方向（先锁定页面：任何方向都不允许原生滚动）
    e.preventDefault();
    const curIdx = PAGES.indexOf(currentPage());
    if (e.deltaY > 0 && curIdx < PAGES.length - 1) {          // 向下滚 → 翻到下一页
      jump(el(PAGES[curIdx + 1]));
    } else if (e.deltaY < 0 && curIdx > 0) {                  // 向上滚 → 翻到上一页
      jump(el(PAGES[curIdx - 1]));
    }
  }, { passive: false });

  // 翻页：手动缓动滚动 650ms，与搜索框飞行同步（同时开始、同时结束）
  const JUMP_MS = 650;
  function jump(target) {
    syncSearchAnchor(target, JUMP_MS);
    lock = true;
    window.__isJumping = true;
    const htmlEl = document.documentElement;
    const startY = window.scrollY;
    const endY = target.offsetTop;
    const t0 = performance.now();
    htmlEl.style.scrollSnapType = 'none';      // 动画期间禁用吸附，落点精确
    htmlEl.style.overflowAnchor = 'none';      // 禁用滚动锚定，防止布局变化被浏览器微调
    function step(now) {
      const p = Math.min(1, (now - t0) / JUMP_MS);
      const e = 1 - Math.pow(1 - p, 3);        // easeOutCubic，与搜索框一致
      window.scrollTo(0, startY + (endY - startY) * e);
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        window.scrollTo(0, target.offsetTop);  // 最终帧用最新测量值，落点绝对精确
        htmlEl.style.scrollSnapType = '';
        htmlEl.style.overflowAnchor = '';
        lock = false;
        window.__isJumping = false;
      }
    }
    requestAnimationFrame(step);
  }
}

/* ---------- 事件绑定 ---------- */
/* 搜索框（单一元素，在页面锚点间飞行）：绑定回车搜索 + 清空按钮 */
function bindSearch(input) {
  const wrap = input.closest('.search-wrap');
  const clearBtn = wrap.querySelector('.search-clear');
  const updateClear = () => clearBtn.classList.toggle('hidden', input.value.length === 0);
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const q = input.value.trim();
    if (!q) return;
    window.open(resolveUrl(q), '_blank');   // 在新标签页打开，当前页保持不动
  });
  input.addEventListener('input', updateClear);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    updateClear();
    input.focus();
  });
  updateClear();
}

function bindEvents() {
  document.querySelectorAll('.search').forEach(bindSearch);

  el('btnNew').addEventListener('click', () => openNew(null));   // 新建文件夹

  el('btnSave').addEventListener('click', saveModal);
  el('btnCancel').addEventListener('click', closeModal);
  el('modalMask').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  el('fldTitle').addEventListener('keydown', e => { if (e.key === 'Enter') saveModal(); });

  // 空白处右键 → 新建文件夹（仅第二页收藏区；第一页不拦截右键，保持浏览器默认菜单）
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('#pageWork')) return;   // 第一页：无自定义右键
    e.preventDefault();
    if (e.target.closest('.bm-row') || e.target.closest('.bm-folder-row') || e.target.closest('.bm-section-head')) return;
    showMenu(e.clientX, e.clientY, [
      { label: '新建文件夹', action: () => openNew(null) }
    ]);
  });

  document.addEventListener('click', hideMenu);
  document.addEventListener('scroll', hideMenu, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideMenu(); closeModal(); if (multiMode) exitMultiMode(); }
  });

  // 多选批量操作条
  el('multiDelete').addEventListener('click', multiDelete);
  el('multiExit').addEventListener('click', exitMultiMode);

  // 收藏夹变化 → 自动刷新（防抖）
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { renderTree(); renderWorkFolder(); renderPrivateFolder(); }, 250);
  };
  chrome.bookmarks.onCreated.addListener(schedule);
  chrome.bookmarks.onRemoved.addListener(schedule);
  chrome.bookmarks.onChanged.addListener(schedule);
  chrome.bookmarks.onMoved.addListener(schedule);

  // 收藏夹拖放：拖动书签/文件夹 → 拖到行边缘=插入排序，拖到文件夹中间=移入
  const bmList = el('bookmarkList');
  let dragId = null;

  bmList.addEventListener('dragstart', e => {
    const row = e.target.closest('.bm-row, .bm-folder-row, .bm-section-head');
    if (!row) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (err) { /* 某些环境限制 */ }
    row.classList.add('dragging');
  });

  bmList.addEventListener('dragend', () => {
    dragId = null;
    bmList.querySelectorAll('.dragging, .drag-over, .drag-before, .drag-after')
      .forEach(n => n.classList.remove('dragging', 'drag-over', 'drag-before', 'drag-after'));
  });

  bmList.addEventListener('dragover', e => {
    if (!dragId) return;
    const t = dragDropTarget(e.target, e.clientY);
    if (!t) return;
    e.preventDefault();                       // 允许放置
    e.dataTransfer.dropEffect = 'move';
    bmList.querySelectorAll('.drag-over, .drag-before, .drag-after')
      .forEach(n => n.classList.remove('drag-over', 'drag-before', 'drag-after'));
    if (dragValid(dragId, t)) {
      t.el.classList.add(t.mode === 'into' ? 'drag-over' : (t.mode === 'before' ? 'drag-before' : 'drag-after'));
    }
  });

  bmList.addEventListener('drop', e => {
    if (!dragId) return;
    const t = dragDropTarget(e.target, e.clientY);
    if (!t || !dragValid(dragId, t)) return;
    e.preventDefault();
    e.stopPropagation();
    if (t.mode === 'into') {
      // 移入文件夹
      chrome.bookmarks.move(dragId, { parentId: t.folderId });
    } else {
      // 插入排序（同父排序或跨父定位）
      const dragNode = findNodeById(bookmarksTree, dragId);
      const dragParent = dragNode ? dragNode.parentId : null;
      const targetParent = findNodeById(bookmarksTree, t.parentId);
      let idx = siblingIndex(targetParent, t.rowId);
      if (t.mode === 'after') idx += 1;
      if (dragParent === t.parentId) {         // 同父：移除自身后目标位置前移
        const di = siblingIndex(targetParent, dragId);
        if (di >= 0 && di < idx) idx -= 1;
      }
      chrome.bookmarks.move(dragId, { parentId: t.parentId, index: Math.max(0, idx) });
    }
  });
}

/* 拖放目标解析：
 * 书签行 → 插入其前/后（同父排序）
 * 文件夹行 → 上/下边缘=插入其前/后，中间=移入该文件夹
 * 分组头 → 仅移入该分组 */
function dragDropTarget(node, clientY) {
  const head = node.closest('.bm-section-head');
  if (head) return { el: head, folderId: head.dataset.id, parentId: head.dataset.id, rowId: head.dataset.id, mode: 'into' };

  const folderRow = node.closest('.bm-folder-row');
  if (folderRow) {
    const r = folderRow.getBoundingClientRect();
    const zone = (clientY - r.top) / r.height;   // 0~1
    if (zone < 0.3) return { el: folderRow, folderId: folderRow.dataset.parentId, parentId: folderRow.dataset.parentId, rowId: folderRow.dataset.id, mode: 'before' };
    if (zone > 0.7) return { el: folderRow, folderId: folderRow.dataset.parentId, parentId: folderRow.dataset.parentId, rowId: folderRow.dataset.id, mode: 'after' };
    return { el: folderRow, folderId: folderRow.dataset.id, parentId: folderRow.dataset.id, rowId: folderRow.dataset.id, mode: 'into' };
  }

  const bm = node.closest('.bm-row');
  if (bm) {
    const r = bm.getBoundingClientRect();
    const zone = (clientY - r.top) / r.height;
    return {
      el: bm, folderId: bm.dataset.parentId, parentId: bm.dataset.parentId, rowId: bm.dataset.id,
      mode: zone < 0.5 ? 'before' : 'after'
    };
  }
  return null;
}

/* 校验：不能拖到自身；文件夹不能拖进自己的子孙 */
function dragValid(dragId, t) {
  if (!t || dragId === t.rowId) return false;
  if (t.mode === 'into') {
    if (!t.folderId || dragId === t.folderId) return false;
    const node = findNodeById(bookmarksTree, dragId);
    if (node && !node.url && nodeContainsId(node, t.folderId)) return false;
  }
  return true;
}

/* 节点在其父 children 中的下标 */
function siblingIndex(parentNode, childId) {
  if (!parentNode) return 0;
  const i = (parentNode.children || []).findIndex(c => c.id === childId);
  return i < 0 ? 0 : i;
}

function findNodeById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of (node.children || [])) {
    const r = findNodeById(c, id);
    if (r) return r;
  }
  return null;
}

function nodeContainsId(node, id) {
  for (const c of (node.children || [])) {
    if (c.id === id) return true;
    if (nodeContainsId(c, id)) return true;
  }
  return false;
}

/* ---------- 启动 ---------- */
updateClock();
setInterval(updateClock, 1000);
bindEvents();
renderWorkFolder();
renderPrivateFolder();
setupPageNav();
syncSearchToCurrentPage(true);   // 启动即同步搜索框到当前页
renderTree();

/* 页面右下角构建标记（验证是否为最新代码） */
const foot = document.createElement('div');
foot.className = 'foot-build';
foot.textContent = 'OMOnewtab ' + BUILD;
document.body.appendChild(foot);
console.log('[OMOnewtab] build', BUILD);
