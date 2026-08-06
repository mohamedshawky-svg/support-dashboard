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
  drillDay: null, slideshow: false, slideIndex: 0, ffBase: null, charts: [],
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
    if (S.drillDay && get(r, 'D_Obj') !== S.drillDay) return false;
    return true;
  });
}

function countBy(rows, colName, { clean = false, limit = null } = {}) {
  const counts = new Map();
  if (!rows) return [];
  for (const r of rows) {
    let v = cleanVal(get(r, colName));
    if (clean && inBlack(v)) continue;
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let arr = Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  arr.sort((a, b) => b.value - a.value);
  if (limit) arr = arr.slice(0, limit);
  return arr;
}

/* ============================== CHARTS ============================== */
function disposeCharts() {
  S.charts.forEach((c) => { try { c.dispose(); } catch (e) {} });
  S.charts = [];
}

function mountChart(dom, option) {
  if (!dom) return null;
  if (dom._chart) { try { dom._chart.dispose(); } catch (e) {} }
  const chart = echarts.init(dom);
  dom._chart = chart;
  chart.setOption(option, true);
  S.charts.push(chart);
  return chart;
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

function barSpec(title, items, baseColor) {
  const names = items.map((x) => x.name);
  const vals = items.map((x) => x.value);
  return {
    tooltip: Object.assign({}, HOVER_STYLE, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
    grid: { left: 10, right: 14, top: 46, bottom: 25, containLabel: true },
    xAxis: { type: 'category', data: names, axisLabel: { color: NAVY, fontWeight: 600, fontSize: 10, rotate: 25 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(0,33,71,.07)' } } },
    series: [{
      type: 'bar', data: vals,
      itemStyle: { borderRadius: [6, 6, 0, 0], color: (p) => barColors(baseColor, items.length)[p.dataIndex] },
      label: { show: true, position: 'top', color: NAVY, fontWeight: 700, fontSize: 10, formatter: (p) => fmt(p.value) },
    }],
    title: { text: title, left: 0, top: 4, textStyle: { fontFamily: 'Sora, sans-serif', fontSize: 13, color: NAVY, fontWeight: 700 } },
  };
}

function barCard(title, items, baseColor, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-card';
  const div = document.createElement('div');
  div.className = 'chart';
  div.style.height = '280px';
  wrap.appendChild(div);
  setTimeout(() => {
    const chart = mountChart(div, barSpec(title, items, baseColor));
    if (onClick && chart) chart.on('click', (p) => { if (p.name != null) onClick(p.name); });
  }, 10);
  return wrap;
}

/* ============================== OVERVIEW ============================== */
function renderOverview() {
  const content = $('#content');
  if (!content) return;
  content.innerHTML = '';

  const ff = applyFilters(S.ffBase || []);

  // Scorecards
  const scRow = document.createElement('div');
  scRow.className = 'sc-row';
  scRow.innerHTML = `
    <div class="sc-card" style="--top-color:${NAVY}">
      <div class="sc-label">📋 TOTAL TICKETS</div>
      <div class="sc-value">${fmt(ff.length)}</div>
    </div>
    <div class="sc-card" style="--top-color:${BLUE}">
      <div class="sc-label">📞 INBOUND CALLS</div>
      <div class="sc-value">${fmt(ff.filter(r => /Inbound|Call/i.test(get(r,'Ticket type')||'')).length)}</div>
    </div>
    <div class="sc-card" style="--top-color:${LIGHT}">
      <div class="sc-label">💬 WHATSAPP</div>
      <div class="sc-value">${fmt(ff.filter(r => /WhatsApp/i.test(get(r,'Ticket type')||'')).length)}</div>
    </div>
    <div class="sc-card" style="--top-color:${GREEN}">
      <div class="sc-label">💰 TOTAL REDEMPTION VALUE</div>
      <div class="sc-value">536,586</div>
    </div>`;
  content.appendChild(scRow);

  // Volume Trend (Peak Days)
  const daysData = countBy(ff, 'D_Obj', { clean: true }).slice(0, 20);
  if (daysData.length) {
    const trendWrap = barCard('📊 Volume Trend (Peak Days)', daysData, BLUE, (dayName) => {
      S.drillDay = (S.drillDay === dayName) ? null : dayName;
      renderAll();
    });
    content.appendChild(trendWrap);
  }

  // Active Drill Down Banner
  if (S.drillDay) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#002147; color:#fff; padding:10px 15px; border-radius:8px; margin:15px 0; display:flex; align-items:center; justify-between;';
    banner.innerHTML = `<span>📊 Filtered by Peak Day: <b>${S.drillDay}</b></span> <button id="btn-clear-drill" style="background:#FF4B4B; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer;">Clear Filter</button>`;
    content.appendChild(banner);
    setTimeout(() => {
      const btn = $('#btn-clear-drill');
      if (btn) btn.addEventListener('click', () => { S.drillDay = null; renderAll(); });
    }, 10);
  }

  // Grid Charts
  const grid = document.createElement('div');
  grid.className = 'chart-grid';

  const m = countBy(ff, 'Merchant', { clean: true, limit: 8 });
  if (m.length) grid.appendChild(barCard('🏪 Top Merchants', m, NAVY));

  const b = countBy(ff, 'Branch User Name', { clean: true, limit: 8 });
  if (b.length) grid.appendChild(barCard('📍 Top Branches', b, LIGHT));

  const p = countBy(ff, 'Project', { clean: true, limit: 8 });
  if (p.length) grid.appendChild(barCard('🏢 Top Projects', p, NAVY));

  const su = countBy(ff, 'Ticket subtype', { clean: true, limit: 8 });
  if (su.length) grid.appendChild(barCard('🏷️ Top Subtypes', su, BLUE));

  content.appendChild(grid);
}

/* ============================== MAIN ============================== */
function renderAll() {
  disposeCharts();
  if (!S.tickets) return;
  S.ffBase = S.tickets.rows || [];
  renderOverview();
}

function showLoading(msg) { $('#loading-screen').hidden = false; $('#app').hidden = true; }
function hideLoading() { $('#loading-screen').hidden = true; $('#app').hidden = false; }

async function boot() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  await loadData(false);
  renderAll();
}

async function init() {
  const saved = localStorage.getItem('ds_session');
  if (saved) { boot(); } else { boot(); }
}

window.addEventListener('resize', () => { S.charts.forEach((c) => { try { c.resize(); } catch (e) {} }); });
document.addEventListener('DOMContentLoaded', () => { init(); });
