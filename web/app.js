'use strict';
/* Support Analysis Dashboard — static single-page app. */

/* ============================== CONFIG ============================== */
const NAVY = '#002147', BLUE = '#0055A4', LIGHT = '#00AEEF', RED = '#FF4B4B', GREEN = '#00873d';
const PIE_COLORS = ['#002147','#0055A4','#00AEEF','#0077cc','#4a90d9','#003d82','#00c6ff','#1a3a6b','#66b2e8','#0094d4'];
const BLACKLIST = new Set([
  '','n/a','n.a','n','dropped call','call dropped','out of our scope','other','0','na',' ',
  'N','none','nan','N/A','0.0','NaN','None','n/m','N/M',"what's app"
]);
const DATE_PRESETS = ['Last 3 months','Last 6 months','Last 12 months','All time','Custom range'];
const TAB_EMOJI = {Overview:'🏠','Quality Board':'🏆','WhatsApp MOM':'💬','Inbound SLA':'📈','Redemption Tracker':'💰','Ticket Explorer':'🎫'};
const HOVER_STYLE = { backgroundColor:'#001e42', borderColor:'#00AEEF', textStyle:{color:'#fff', fontSize:12, fontFamily:'DM Sans'} };

/* ============================== STATE ============================== */
const S = {
  auth: null, session: null, meta: null, tickets: null, colIdx: {},
  agent: null, sla: null, redemption: null,
  filters: { dateMode:'All time', customStart:null, customEnd:null, merchant:[], project:[], branch:[], district:[], type:[], subtype:[], microtype:[], action:[], status:[] },
  fSearch: {}, clickFilter: { col:null, val:null }, activeTab: 0, ovTeam: 0,
  drill: { merchant:null, client:null }, slideshow: false, slideIndex: 0, ffBase: null, charts: [],
};

/* ============================== HELPERS ============================== */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
const inBlack = (v) => BLACKLIST.has(String(v == null ? '' : v).trim().toLowerCase());
const cleanVal = (v) => String(v == null ? '' : v).trim();

function col(name) { return S.colIdx[name]; }
function get(row, name) { 
  if (!row) return '';
  const i = col(name); 
  return i == null ? '' : row[i]; 
}

function parseNum(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[%,]/g, '').replace(/EGP/gi, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ------------------------------ DATA LOADING ------------------------------ */
async function fetchJson(url, bust) {
  const res = await fetch(url + (bust ? ('?v=' + Date.now()) : ''), { cache: bust ? 'no-store' : 'default' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return await res.json();
}

async function loadData(bust) {
  showLoading('Loading tickets…');
  S.meta = await fetchJson('./data/meta.json', bust).catch(() => fetchJson('data/meta.json', bust));
  S.tickets = await fetchJson('./data/tickets.json', bust).catch(() => fetchJson('data/tickets.json', bust));

  S.colIdx = {};
  if (S.tickets && S.tickets.cols) {
    S.tickets.cols.forEach((c, i) => { S.colIdx[c] = i; });
  }
  showLoading('Loading quality data…');
  S.agent = await fetchJson('./data/agent.json', bust).catch(() => ({}));
  S.sla = await fetchJson('./data/sla.json', bust).catch(() => ({}));
  S.redemption = await fetchJson('./data/redemption.json', bust).catch(() => ({}));
  hideLoading();
}

/* ------------------------------ FILTER PIPELINE ------------------------------ */
function dateRange() {
  const mode = S.filters.dateMode;
  const maxStr = S.meta ? S.meta.date_max : null;
  if (mode === 'All time' || !mode || !maxStr) return null;
  if (mode === 'Custom range') {
    if (!S.filters.customStart || !S.filters.customEnd) return null;
    return { start: S.filters.customStart, end: S.filters.customEnd };
  }
  const months = parseInt(mode.split(' ')[1], 10) || 3;
  const max = new Date(maxStr + 'T00:00:00');
  const start = new Date(max);
  start.setDate(max.getDate() - months * 30);
  return { start: iso(start), end: iso(max) };
}

function baseFilter(row) {
  const d = dateRange();
  if (d) { const v = get(row, 'D_Obj'); if (!v || v < d.start || v > d.end) return false; }
  if (S.session && S.session.role === 'client' && S.session.projects) {
    if (!S.session.projects.includes(get(row, 'Project'))) return false;
  }
  return true;
}

function applyFilters(rows) {
  if (!rows) return [];
  const f = S.filters;
  return rows.filter((r) => {
    if (f.merchant && f.merchant.length && !f.merchant.includes(get(r, 'Merchant'))) return false;
    if (f.project && f.project.length && !f.project.includes(get(r, 'Project'))) return false;
    if (f.branch && f.branch.length && !f.branch.includes(get(r, 'Branch User Name'))) return false;
    if (f.district && f.district.length && !f.district.includes(get(r, 'District'))) return false;
    if (f.type && f.type.length && !f.type.includes(get(r, 'Ticket type'))) return false;
    if (f.subtype && f.subtype.length && !f.subtype.includes(get(r, 'Ticket subtype'))) return false;
    if (f.microtype && f.microtype.length && !f.microtype.includes(get(r, 'Call Microtype'))) return false;
    if (f.action && f.action.length && !f.action.includes(get(r, 'Action taken'))) return false;
    if (f.status && f.status.length && !f.status.includes(get(r, 'Ticket_Status'))) return false;
    if (S.clickFilter && S.clickFilter.col && get(r, S.clickFilter.col) !== S.clickFilter.val) return false;
    return true;
  });
}

/* ------------------------------ AGGREGATION ------------------------------ */
function countBy(rows, colName, { clean = false, limit = null, sortDesc = true } = {}) {
  const counts = new Map();
  if (!rows) return [];
  for (const r of rows) {
    let v = cleanVal(get(r, colName));
    if (clean && inBlack(v)) continue;
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let arr = Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  arr.sort((a, b) => sortDesc ? b.value - a.value : (a.name < b.name ? -1 : 1));
  if (limit) arr = arr.slice(0, limit);
  return arr;
}

function groupTop(rows, byCol, hoverCol, hoverN, { clean = true } = {}) {
  const top = countBy(rows, byCol, { clean, limit: 10 });
  return top.map((t) => {
    const sub = rows.filter((r) => cleanVal(get(r, byCol)) === t.name);
    const lines = countBy(sub, hoverCol, { clean: true, limit: hoverN })
      .map((x) => '• ' + x.name + ': ' + fmt(x.value));
    return { name: t.name, value: t.value, hover: lines.join('<br>') };
  });
}

/* ============================== CHARTS ============================== */
function disposeCharts() {
  S.charts.forEach((c) => { try { c.dispose(); } catch (e) {} });
  S.charts = [];
}

function mountChart(dom, option) {
  try {
    if (dom._chart) { try { dom._chart.dispose(); } catch (e) {} }
    const chart = echarts.init(dom);
    dom._chart = chart;
    chart.setOption(option, true);
    S.charts.push(chart);
    return chart;
  } catch(err) {
    console.error("Chart Render Error:", err);
  }
}

function barColors(baseHex, n) {
  const r = parseInt(baseHex.slice(1, 3), 16), g = parseInt(baseHex.slice(3, 5), 16), b = parseInt(baseHex.slice(5, 7), 16);
  const colors = [];
  for (let i = 0; i < n; i++) {
    const a = n <= 1 ? 1 : (0.55 + 0.45 * (i / (n - 1)));
    colors.push(`rgba(${r},${g},${b},${a.toFixed(2)})`);
  }
  return colors;
}

function barSpec(title, items, baseColor, tooltipFn) {
  const names = items.map((x) => x.name);
  const vals = items.map((x) => x.value);
  return {
    tooltip: Object.assign({}, HOVER_STYLE, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tooltipFn || ((p) => { const it = p[0]; return `<b>${esc(it.name)}</b><br>${fmt(it.value)}`; }) }),
    grid: { left: 10, right: 14, top: 46, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: names, axisLabel: { color: NAVY, fontWeight: 600, fontSize: 11, rotate: 28 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(0,33,71,.07)' } }, axisLabel: { color: NAVY, fontSize: 10 } },
    series: [{
      type: 'bar', data: vals, barGap: '25%',
      itemStyle: { borderRadius: [6, 6, 0, 0], color: (p) => barColors(baseColor, items.length)[p.dataIndex] },
      label: { show: true, position: 'top', color: NAVY, fontWeight: 700, fontSize: 11, formatter: (p) => fmt(p.value) },
    }],
    title: { text: title, left: 0, top: 4, textStyle: { fontFamily: 'Sora, sans-serif', fontSize: 14, color: NAVY, fontWeight: 700 } },
    backgroundColor: 'transparent',
  };
}

function pieSpec(title, items, colors, tooltipFn) {
  return {
    tooltip: Object.assign({}, HOVER_STYLE, { formatter: tooltipFn || ((p) => `<b>${esc(p.name)}</b><br>${fmt(p.value)} (${p.percent == null ? '' : p.percent.toFixed(1) + '%'})`) }),
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '52%'], data: items,
      itemStyle: { borderColor: '#fff', borderWidth: 2.5, borderRadius: 4 },
      label: { color: NAVY, fontSize: 11, fontWeight: 600 },
      labelLine: { lineStyle: { color: 'rgba(0,33,71,.3)' } },
      color: colors,
    }],
    legend: { bottom: 2, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: NAVY, fontSize: 11 } },
    title: { text: title, left: 0, top: 4, textStyle: { fontFamily: 'Sora, sans-serif', fontSize: 14, color: NAVY, fontWeight: 700 } },
    backgroundColor: 'transparent',
  };
}

function barCard(title, items, baseColor, tooltipFn, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-card';
  const div = document.createElement('div');
  div.className = 'chart';
  wrap.appendChild(div);
  const chart = mountChart(div, barSpec(title, items, baseColor, tooltipFn));
  if (onClick && chart) chart.on('click', (p) => { if (p.name != null) onClick(p.name); });
  return wrap;
}

function pieCard(title, items, tooltipFn, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-card';
  const div = document.createElement('div');
  div.className = 'chart';
  wrap.appendChild(div);
  const chart = mountChart(div, pieSpec(title, items, PIE_COLORS, tooltipFn));
  if (onClick && chart) chart.on('click', (p) => { if (p.name != null) onClick(p.name); });
  return wrap;
}

/* ============================== LOGIN & SIDEBAR ============================== */
function showLogin() { hideLoading(); $('#login-screen').hidden = false; $('#app').hidden = true; }
function submitLogin() {
  const key = cleanVal($('#login-key').value);
  if (!key) return;
  if (key === S.auth.admin) S.session = { role: 'admin', key };
  else if (key === S.auth.user) S.session = { role: 'user', key };
  else if (S.auth.clients && S.auth.clients[key]) {
    const c = S.auth.clients[key];
    S.session = { role: 'client', key, projects: c.projects, is_vodafone: !!c.is_vodafone, logo: c.logo || null };
  } else { $('#login-error').hidden = false; return; }
  localStorage.setItem('ds_session', JSON.stringify({ role: S.session.role, key }));
  boot();
}

function renderSidebar() {
  const sb = $('#sidebar');
  if (!sb) return;
  sb.className = 'sidebar' + (S.session && S.session.role === 'client' ? ' client' : '');
  sb.innerHTML = `
    <div class="sb-logo"><img src="assets/logo_big.png" alt="Dsquares"></div>
    <div class="sb-live"><span class="dot"></span>LIVE &nbsp;·&nbsp; Auto</div>
    <div class="sb-sec">Filters</div>
    <label class="f-label">📅 Date filter</label>
    <div class="select-wrap">
      <select class="select-sel" id="date-mode">
        ${DATE_PRESETS.map((d) => `<option value="${d}" ${S.filters.dateMode === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
    </div>
    <hr class="sb-divider">
    <button class="sb-btn danger" id="btn-logout">🚪 Log Out</button>`;

  const dm = $('#date-mode');
  if (dm) dm.addEventListener('change', (e) => { S.filters.dateMode = e.target.value; renderAll(); });
  const lo = $('#btn-logout');
  if (lo) lo.addEventListener('click', () => { localStorage.removeItem('ds_session'); S.session = null; showLogin(); });
}

function renderHeader() {
  const dh = $('#dashboard-header');
  if (dh) dh.innerHTML = `<div class="dashboard-header">
    <h2>Support Analysis Dashboard</h2>
    <div style="margin-top:5px;"><span class="live-badge"><span class="live-dot"></span> LIVE</span></div>
  </div>`;
}

function renderTabs() {
  const tabs = ['Overview','Quality Board','WhatsApp MOM','Inbound SLA','Redemption Tracker','Ticket Explorer'];
  const bar = $('#tabbar');
  if (!bar) return tabs;
  bar.innerHTML = '';
  tabs.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (i === S.activeTab ? ' active' : '');
    btn.textContent = `${TAB_EMOJI[t] || ''} ${t}`;
    btn.addEventListener('click', () => { S.activeTab = i; renderAll(); });
    bar.appendChild(btn);
  });
  return tabs;
}

/* ============================== OVERVIEW ============================== */
function getTeamRows(rows) {
  if (!rows || !rows.length) return [];
  const teamIdx = col('_team');
  if (teamIdx == null) return rows;
  const target = S.ovTeam === 0 ? 'merchant' : 'client';
  const filtered = rows.filter((r) => String(r[teamIdx]).toLowerCase() === target);
  return filtered.length ? filtered : rows;
}

function renderOverview() {
  const content = $('#content');
  if (!content) return;
  content.innerHTML = '';

  const subtabs = document.createElement('div');
  subtabs.className = 'ov-subtabs';
  const mk = (label, idx) => {
    const b = document.createElement('button');
    b.className = 'ov-subbtn' + (S.ovTeam === idx ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { S.ovTeam = idx; renderAll(); });
    return b;
  };
  subtabs.appendChild(mk('🏪 Merchant Support', 0));
  subtabs.appendChild(mk('🤝 Client Support', 1));
  content.appendChild(subtabs);

  const ff = applyFilters(S.ffBase || []);
  const dataRows = getTeamRows(ff);

  // Scorecards
  const scRow = document.createElement('div');
  scRow.className = 'sc-row';
  scRow.innerHTML = `
    <div class="sc-card" style="--top-color:${NAVY}">
      <div class="sc-label">📋 Total Tickets</div>
      <div class="sc-value">${fmt(dataRows.length)}</div>
    </div>
    <div class="sc-card" style="--top-color:${BLUE}">
      <div class="sc-label">📞 Inbound Calls</div>
      <div class="sc-value">${fmt(dataRows.filter(r => /Inbound|Call/i.test(get(r,'Ticket type')||get(r,'Type')||'')).length)}</div>
    </div>
    <div class="sc-card" style="--top-color:${LIGHT}">
      <div class="sc-label">💬 WhatsApp</div>
      <div class="sc-value">${fmt(dataRows.filter(r => /WhatsApp|App/i.test(get(r,'Ticket type')||get(r,'Type')||'')).length)}</div>
    </div>`;
  content.appendChild(scRow);

  // Grid Charts
  const grid = document.createElement('div');
  grid.className = 'chart-grid';

  try {
    const m = groupTop(dataRows, 'Merchant', 'Call Microtype', 5);
    if (m.length) grid.appendChild(barCard('🏪 Top Merchants', m, NAVY, null, (val) => { S.filters.merchant = [val]; renderAll(); }));

    const b = groupTop(dataRows, 'Branch User Name', 'Merchant', 5);
    if (b.length) grid.appendChild(barCard('📍 Top Branches', b, LIGHT, null, (val) => { S.filters.branch = [val]; renderAll(); }));

    const p = groupTop(dataRows, 'Project', 'Call Microtype', 5);
    if (p.length) grid.appendChild(barCard('🏢 Top Projects', p, NAVY, null, (val) => { S.filters.project = [val]; renderAll(); }));

    const tt = countBy(dataRows, 'Ticket type', { clean: true });
    if (tt.length) grid.appendChild(pieCard('🎫 Ticket Type Share', tt, null, (val) => { S.filters.type = [val]; renderAll(); }));

    const su = groupTop(dataRows, 'Ticket subtype', 'Ticket type', 3);
    if (su.length) grid.appendChild(barCard('🏷️ Top Subtypes', su, NAVY, null, (val) => { S.filters.subtype = [val]; renderAll(); }));

    const mi = groupTop(dataRows, 'Call Microtype', 'Ticket subtype', 5);
    if (mi.length) grid.appendChild(barCard('🔬 Top Microtypes', mi, LIGHT, null, (val) => { S.filters.microtype = [val]; renderAll(); }));
  } catch (err) {
    console.error("Error generating overview grid:", err);
  }

  content.appendChild(grid);
}

/* ============================== MAIN RENDER ============================== */
function renderAll() {
  try {
    disposeCharts();
    if (!S.tickets || !S.session) return;
    S.ffBase = S.tickets.rows ? S.tickets.rows.filter(baseFilter) : [];
    renderHeader();
    renderSidebar();
    renderTabs();
    renderOverview();
  } catch (e) {
    console.error("Render error caught safely:", e);
  }
}

function showLoading(msg) { $('#loading-screen').hidden = false; $('#app').hidden = true; $('#loading-status').textContent = msg; }
function hideLoading() { $('#loading-screen').hidden = true; $('#app').hidden = false; }

async function boot() {
  S.filters = { dateMode: 'All time', customStart: null, customEnd: null, merchant: [], project: [], branch: [], district: [], type: [], subtype: [], microtype: [], action: [], status: [] };
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  await loadData(false);
  renderAll();
}

async function init() {
  S.auth = await fetchJson('access.json').catch(() => ({ admin: 'admin', user: 'user' }));
  const lb = $('#login-btn');
  if (lb) lb.addEventListener('click', submitLogin);
  const saved = localStorage.getItem('ds_session');
  if (saved) {
    try { S.session = JSON.parse(saved); await boot(); return; } catch (e) {}
  }
  showLogin();
}

window.addEventListener('resize', () => { S.charts.forEach((c) => { try { c.resize(); } catch (e) {} }); });
document.addEventListener('DOMContentLoaded', () => { init().catch(showLogin); });
