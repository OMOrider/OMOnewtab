/* ============================================================
 * 我的新标签页 — 核心逻辑
 * 管理浏览器原生收藏夹（chrome.bookmarks），Manifest V3
 * ============================================================ */

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

  const icoWrap = document.createElement('span');
  icoWrap.className = 'bm-ico-wrap';
  const img = document.createElement('img');
  img.className = 'bm-ico';
  img.alt = '';
  img.loading = 'lazy';
  img.src = faviconSrc(node.url);
  img.addEventListener('error', () => fallbackToCdn(img, node.url), { once: true });
  icoWrap.appendChild(img);

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

  row.append(icoWrap, title, domain, actions);
  row.addEventListener('click', e => openNode(node, e));
  row.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); openNode(node, e); } });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, [
      { label: '打开', action: () => { window.location.href = node.url; } },
      { label: '在新标签页打开', action: () => { window.open(node.url, '_blank'); } },
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
  const chev = document.createElement('span');
  chev.className = 'chevron';
  chev.innerHTML = SVG.chevron;
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
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    row.classList.toggle('collapsed', isOpen);
    if (isOpen) expanded.delete(folder.id); else expanded.add(folder.id);
  });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, [
      { label: '在此新建收藏', action: () => openNew(folder.id, false) },
      { label: '在此新建文件夹', action: () => openNew(folder.id, true) },
      '-',
      { label: '重命名', action: () => openEdit(folder) },
      { label: '删除文件夹', action: () => deleteNode(folder), danger: true }
    ]);
  });

  row.append(chev, ico, name, count);
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
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    head.classList.toggle('collapsed', isOpen);
    if (isOpen) expanded.delete(rootChild.id); else expanded.add(rootChild.id);
  });
  head.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, [
      { label: '在此新建收藏', action: () => openNew(rootChild.id, false) },
      { label: '在此新建文件夹', action: () => openNew(rootChild.id, true) }
    ]);
  });

  // 按记忆的展开状态渲染
  const defaultOpen = expanded.has(rootChild.id);
  body.hidden = !defaultOpen;
  head.classList.toggle('collapsed', !defaultOpen);

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

function openNode(node, e) {
  if (!node.url) return;
  if (e.ctrlKey || e.metaKey || e.button === 1) {
    window.open(node.url, '_blank');
  } else {
    window.location.href = node.url;
  }
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
  el('modalTypeRow').classList.toggle('hidden', !isNew);
  el('parentRow').classList.toggle('hidden', !isNew);
  el('urlRow').classList.toggle('hidden', modalState.isFolder);
  if (isNew) {
    el('fldType').value = modalState.isFolder ? 'folder' : 'bookmark';
    fillParentOptions();
  }
}

function openModal() { el('modalMask').classList.remove('hidden'); }
function closeModal() { el('modalMask').classList.add('hidden'); }

function openNew(parentId, isFolder) {
  modalState.mode = 'new';
  modalState.id = null;
  modalState.parentId = parentId || '2';
  modalState.isFolder = !!isFolder;
  el('modalTitle').textContent = isFolder ? '新建文件夹' : '新建收藏';
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
    const isFolder = el('fldType').value === 'folder';
    if (!title) { alert('请填写名称'); return; }
    const parentId = el('fldParent').value;
    if (isFolder) {
      chrome.bookmarks.create({ parentId: parentId, title: title });
    } else {
      const url = normalizeUrl(el('fldUrl').value);
      if (!url) { alert('请填写网址'); return; }
      chrome.bookmarks.create({ parentId: parentId, title: title, url: url });
    }
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
function renderWorkTools() {
  const grid = el('workTools');
  grid.innerHTML = '';
  for (const t of WORK_TOOLS) {
    const card = document.createElement('a');
    card.className = 'tool-card';
    card.href = t.url;
    card.title = t.url;
    const tile = document.createElement('span');
    tile.className = 'tool-tile';
    tile.style.background = t.color || colorFor(t.url);
    tile.textContent = (t.name || '?')[0];
    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = t.name;
    card.append(tile, name);
    grid.appendChild(card);
  }
}

function setupPageNav() {
  const pageWork = el('pageWork');
  const pagePrivate = el('pagePrivate');

  // 底部指示点：点击跳页，滚动时高亮当前页
  const nav = el('pageNav');
  nav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      el(btn.dataset.target).scrollIntoView({ behavior: 'smooth' });
    });
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

  // 翻页式滑动：滚一下（累计约 30px）整页跳转，页内长列表仍可正常滚动
  let lock = false;
  let acc = 0;
  window.addEventListener('wheel', e => {
    if (lock) return;
    const y = window.scrollY;
    const p2Top = pagePrivate.offsetTop;
    const atWorkTop = y < 60;                       // 工作页顶部附近
    const atPrivTop = Math.abs(y - p2Top) < 60;     // 私人页顶部附近
    if (!atWorkTop && !atPrivTop) { acc = 0; return; }  // 列表内部 → 正常滚动

    acc += e.deltaY;
    if (Math.abs(acc) < 30) return;

    if (acc > 0 && atWorkTop) {           // 工作页顶部向下滚 → 翻到私人页
      e.preventDefault();
      acc = 0;
      jump(pagePrivate);
    } else if (acc < 0 && atPrivTop) {    // 私人页顶部向上滚 → 翻回工作页
      e.preventDefault();
      acc = 0;
      jump(pageWork);
    } else {
      acc = 0;                            // 方向不对，丢弃
    }
  }, { passive: false });

  function jump(target) {
    lock = true;
    target.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { lock = false; }, 500);
  }
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  el('search').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const q = el('search').value.trim();
    if (!q) return;
    window.open(resolveUrl(q), '_blank');   // 在新标签页打开，当前页保持不动
  });

  // 搜索框清空按钮（有文字才显示）
  const clearBtn = el('searchClear');
  const updateClear = () => clearBtn.classList.toggle('hidden', el('search').value.length === 0);
  el('search').addEventListener('input', updateClear);
  clearBtn.addEventListener('click', () => {
    el('search').value = '';
    updateClear();
    el('search').focus();
  });
  updateClear();

  el('btnNew').addEventListener('click', () => openNew(null, false));

  el('fldType').addEventListener('change', () => {
    modalState.isFolder = el('fldType').value === 'folder';
    el('urlRow').classList.toggle('hidden', modalState.isFolder);
  });

  el('btnSave').addEventListener('click', saveModal);
  el('btnCancel').addEventListener('click', closeModal);
  el('modalMask').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  el('fldTitle').addEventListener('keydown', e => { if (e.key === 'Enter') saveModal(); });

  // 空白处右键 → 新建
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (e.target.closest('.bm-row') || e.target.closest('.bm-folder-row') || e.target.closest('.bm-section-head')) return;
    showMenu(e.clientX, e.clientY, [
      { label: '新建收藏', action: () => openNew(null, false) },
      { label: '新建文件夹', action: () => openNew(null, true) }
    ]);
  });

  document.addEventListener('click', hideMenu);
  document.addEventListener('scroll', hideMenu, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideMenu(); closeModal(); } });

  // 收藏夹变化 → 自动刷新（防抖）
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(renderTree, 250);
  };
  chrome.bookmarks.onCreated.addListener(schedule);
  chrome.bookmarks.onRemoved.addListener(schedule);
  chrome.bookmarks.onChanged.addListener(schedule);
  chrome.bookmarks.onMoved.addListener(schedule);
}

/* ---------- 启动 ---------- */
updateClock();
setInterval(updateClock, 1000);
bindEvents();
renderWorkTools();
setupPageNav();
renderTree();
