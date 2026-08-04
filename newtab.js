/* ============================================================
 * OMOnewtab — 核心逻辑
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

/* ---------- 天气（Open-Meteo，免费免 Key） ----------
 * WEATHER_CITY    页面上显示的城市名（改成你的城市）
 * WEATHER_SEARCH  城市的拼音（Open-Meteo 不支持中文查询，必须填拼音）
 * WEATHER_FALLBACK 查不到坐标时的兜底坐标（当前为湖州） */
const WEATHER_CITY = '湖州';
const WEATHER_SEARCH = 'huzhou';
const WEATHER_FALLBACK = { lat: 30.8703, lon: 120.0933 };

const WMO_ICONS = {
  sun: '<span class="w-ico sun"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>',
  cloud: '<span class="w-ico"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a2.5 2.5 0 0 0 .4-4.97 3.5 3.5 0 0 0-6.8-.6A2.8 2.8 0 0 0 4.5 12.5z" fill="currentColor" opacity="0.85"/></svg></span>',
  rain: '<span class="w-ico"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a2.5 2.5 0 0 0 .4-4.97 3.5 3.5 0 0 0-6.8-.6A2.8 2.8 0 0 0 4.5 12.5z" fill="currentColor" opacity="0.85"/><path d="M5 9.5v1.8M8 9.5v1.8M11 9.5v1.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></span>',
  snow: '<span class="w-ico"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a2.5 2.5 0 0 0 .4-4.97 3.5 3.5 0 0 0-6.8-.6A2.8 2.8 0 0 0 4.5 12.5z" fill="currentColor" opacity="0.85"/><path d="M6.5 8.6v2M9.5 8.6v2M8 8.2v2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg></span>',
  thunder: '<span class="w-ico"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a2.5 2.5 0 0 0 .4-4.97 3.5 3.5 0 0 0-6.8-.6A2.8 2.8 0 0 0 4.5 12.5z" fill="currentColor" opacity="0.85"/><path d="M8 8.2l-1.5 2.3h1.8L7.4 13l2.4-2.6H8z" fill="currentColor"/></svg></span>',
  fog: '<span class="w-ico"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a2.5 2.5 0 0 0 .4-4.97 3.5 3.5 0 0 0-6.8-.6A2.8 2.8 0 0 0 4.5 12.5z" fill="currentColor" opacity="0.85"/><path d="M4 9.5h8M5 8h6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></span>'
};

const WMO_TEXT = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
  56: '冻雨', 57: '冻雨', 61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '阵雪',
  95: '雷阵雨', 96: '雷阵雨', 99: '强雷暴'
};

function wmoIcon(code) {
  if (code === 0 || code === 1) return WMO_ICONS.sun;
  if (code === 2 || code === 3) return WMO_ICONS.cloud;
  if (code >= 45 && code <= 48) return WMO_ICONS.fog;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return WMO_ICONS.rain;
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return WMO_ICONS.snow;
  if (code >= 95) return WMO_ICONS.thunder;
  return WMO_ICONS.cloud;
}

function renderWeather(w) {
  const cur = w.current;
  const code = cur.weather_code;
  const box = el('weather');
  box.innerHTML = wmoIcon(code)
    + '<span class="w-city">' + esc(WEATHER_CITY) + '</span>'
    + '<span class="w-temp">' + Math.round(cur.temperature_2m) + '°C</span>'
    + '<span>' + (WMO_TEXT[code] || '未知') + '</span>'
    + '<span class="w-sub">体感 ' + Math.round(cur.apparent_temperature) + '° · 湿度 '
    + Math.round(cur.relative_humidity_2m) + '%</span>'
    + '<span class="w-caret"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  box.classList.remove('hidden');

  // 7 天预报：渲染进右侧面板，点击天气行时打开
  const body = el('weatherPanelBody');
  const days = w.daily.time;
  const codes = w.daily.weather_code;
  const maxs = w.daily.temperature_2m_max;
  const mins = w.daily.temperature_2m_min;
  let html = '';
  for (let i = 0; i < days.length; i++) {
    const d = new Date(days[i] + 'T00:00:00');
    const name = i === 0 ? '今天' : WEEK[d.getDay()];
    const md = (d.getMonth() + 1) + '/' + d.getDate();
    html += '<div class="wp-row' + (i === 0 ? ' today' : '') + '">'
      + '<span class="wp-name">' + name + '</span>'
      + '<span class="wp-date">' + md + '</span>'
      + '<span class="wp-ico">' + wmoIcon(codes[i]) + '</span>'
      + '<span class="wp-temp"><span class="max">' + Math.round(maxs[i]) + '°</span>'
      + '<span class="min">' + Math.round(mins[i]) + '°</span></span>'
      + '</div>';
  }
  body.innerHTML = html;
}

/* 骨架屏：先占位再替换，避免页面跳动 */
function showWeatherSkeleton() {
  const box = el('weather');
  box.innerHTML = '<span class="w-city">' + esc(WEATHER_CITY) + '</span><span class="sk-pill"></span>';
  box.classList.remove('hidden');
}

function hideWeather() {
  el('weather').classList.add('hidden');
  el('weather').classList.remove('open');
  el('weatherPanel').classList.add('hidden');
}

/* 本地缓存：30 分钟内秒开，后台静默刷新 */
const WEATHER_CACHE_KEY = 'newtab_weather_cache';
const WEATHER_CACHE_TTL = 30 * 60 * 1000;

function getCachedWeather() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (Date.now() - c.ts > WEATHER_CACHE_TTL) return null;
    return c.data;
  } catch (e) { return null; }
}

function setCachedWeather(w) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: w }));
  } catch (e) { /* 缓存失败不影响 */ }
}

async function fetchWeather() {
  showWeatherSkeleton();
  const cached = getCachedWeather();
  if (cached) renderWeather(cached);

  let lat = WEATHER_FALLBACK.lat;
  let lon = WEATHER_FALLBACK.lon;
  try {
    const geoRes = await fetch('https://geocoding-api.open-meteo.com/v1/search?name='
      + encodeURIComponent(WEATHER_SEARCH) + '&count=1');
    const geo = await geoRes.json();
    const place = geo.results && geo.results[0];
    if (place) { lat = place.latitude; lon = place.longitude; }
  } catch (e) {
    console.error('天气：城市定位失败，使用默认坐标', e);
  }
  try {
    const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat
      + '&longitude=' + lon
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto');
    const w = await wRes.json();
    renderWeather(w);
    setCachedWeather(w);
  } catch (e) {
    console.error('天气：获取天气数据失败', e);
    if (!cached) hideWeather();
  }
}

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
    const willOpen = body.hidden;        // 当前收起 → 点击展开
    body.hidden = !willOpen;
    row.classList.toggle('arrow-down', willOpen);   // 展开 → 箭头向下；收起 → 横向
    if (willOpen) expanded.add(folder.id); else expanded.delete(folder.id);
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
    const willOpen = body.hidden;        // 当前收起 → 点击展开
    body.hidden = !willOpen;
    head.classList.toggle('arrow-down', willOpen);   // 展开 → 箭头向下；收起 → 横向
    if (willOpen) expanded.add(rootChild.id); else expanded.delete(rootChild.id);
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

    // 滚轮目标在可滚动容器内（工具B侧边栏、7天天气面板等）且该方向还能滚 → 交给容器自己滚，不翻页
    let node = e.target;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        const canUp = node.scrollTop > 0 && e.deltaY < 0;
        const canDown = node.scrollTop < node.scrollHeight - node.clientHeight - 1 && e.deltaY > 0;
        if (canUp || canDown) return;
        break;   // 容器已滚到头 → 允许翻页逻辑接管
      }
      node = node.parentElement;
    }

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

  // 天气行：点击打开右侧 7 天预报面板
  const weatherLine = el('weather');
  const weatherPanel = el('weatherPanel');
  weatherLine.title = '点击查看 7 天预报';
  const closeWeatherPanel = () => {
    weatherLine.classList.remove('open');
    weatherPanel.classList.add('hidden');
  };
  weatherLine.addEventListener('click', e => {
    e.stopPropagation();
    const open = weatherLine.classList.toggle('open');
    weatherPanel.classList.toggle('hidden', !open);
  });
  el('weatherClose').addEventListener('click', e => {
    e.stopPropagation();
    closeWeatherPanel();
  });
  document.addEventListener('click', e => {
    if (weatherPanel.classList.contains('hidden')) return;
    if (e.target.closest('#weatherPanel') || e.target.closest('#weather')) return;
    closeWeatherPanel();
  });

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
    timer = setTimeout(() => { renderTree(); renderWorkFolder(); renderPrivateFolder(); }, 250);
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
renderWorkFolder();
renderPrivateFolder();
setupPageNav();
fetchWeather();
renderTree();
