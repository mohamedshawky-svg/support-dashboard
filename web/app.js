'use strict';
/* Support Analysis Dashboard — Fully Patched Version */

const NAVY = '#002147', BLUE = '#0055A4', LIGHT = '#00AEEF', RED = '#FF4B4B', GREEN = '#00873d';
const PIE_COLORS = ['#002147','#0055A4','#00AEEF','#0077cc','#4a90d9','#003d82','#00c6ff','#1a3a6b','#66b2e8','#0094d4'];
const BLACKLIST = new Set(['','n/a','n.a','n','dropped call','call dropped','out of our scope','other','0','na',' ','N','none','nan','N/A','0.0','NaN','None','n/m','N/M',"what's app"]);
const DATE_PRESETS = ['Last 3 months','Last 6 months','Last 12 months','All time','Custom range'];
const TAB_EMOJI = {Overview:'🏠','Quality Board':'🏆','WhatsApp MOM':'💬','Inbound SLA':'📈','Redemption Tracker':'💰','Ticket Explorer':'🎫'};
const HOVER_STYLE = { backgroundColor:'#001e42', borderColor:'#00AEEF', textStyle:{color:'#fff', fontSize:12, fontFamily:'DM Sans'} };

const S = {
  auth: null, session: null, meta: null, tickets: null, colIdx: {},
  agent: null, sla: null, redemption: null,
  filters: { dateMode:'All time', customStart:null, customEnd:null, merchant:[], project:[], branch:[], district:[], type:[], subtype:[], microtype:[], action:[], status:[] },
  clickFilter: { col:null, val:null }, activeTab: 0, ovTeam: 0, ffBase: null, charts: [],
};

const $ = (sel, root) => (root || document).querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
const inBlack = (v) => BLACKLIST.has(String(v == null ? '' : v).trim().toLowerCase());
const cleanVal = (v) => String(v == null ? '' : v).trim();

function col(name) { return S.colIdx[name]; }
function get(row, name) { if (!row) return ''; const i = col(name); return i == null ? '' : row[i]; }

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
    if (S.clickFilter && S.clickFilter.col && get(r, S.clickFilter.col) !== S.clickFilter.val) return false;
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
  div.style.minHeight = '280px';
  wrap.appendChild(div);

  setTimeout(() => {
    const chart = mountChart(div, barSpec(title, items, baseColor));
    if (onClick && chart) chart.on('click', (p) => { if (p.name != null) onClick(p.name); });
  }, 50);

  return wrap;
}

/* ============================== RENDER OVERVIEW ============================== */
function renderOverview() {
  const content = $('#content');
  if (!content) return;
  content.innerHTML = '';

  const ff = applyFilters(S.ffBase || []);

  if (S.clickFilter.col && S.clickFilter.val) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#eef6ff; border:1px solid #00AEEF; padding:12px; border-radius:8px; margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;';
    banner.innerHTML = `<span>🔍 Active Chart Filter: <b>${esc(S.clickFilter.col)}</b> = <b>${esc(S.clickFilter.val)}</b></span>
      <button id="btn-clear-chart-filter" style="background:#FF4B4B; color:#fff; border:none; padding:6px 14px; border-radius:6px; cursor:pointer; font-weight:bold;">✕ Clear Chart Filter</button>`;
    content.appendChild(banner);

    setTimeout(() => {
      const btn = $('#btn-clear-chart-filter');
      if (btn) {
        btn.onclick = () => {
          S.clickFilter = { col: null, val: null };
          renderAll();
        };
      }
    }, 10);
  }

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
    </div>`;
  content.appendChild(scRow);

  const grid = document.createElement('div');
  grid.className = 'chart-grid';

  const m = countBy(ff, 'Merchant', { clean: true, limit: 8 });
  if (m.length) grid.appendChild(barCard('🏪 Top Merchants', m, NAVY, (val) => { S.clickFilter = { col: 'Merchant', val }; renderAll(); }));

  const b = countBy(ff, 'Branch User Name', { clean: true, limit: 8 });
  if (b.length) grid.appendChild(barCard('📍 Top Branches', b, LIGHT, (val) => { S.clickFilter = { col: 'Branch User Name', val }; renderAll(); }));

  const p = countBy(ff, 'Project', { clean: true, limit: 8 });
  if (p.length) grid.appendChild(barCard('🏢 Top Projects', p, NAVY, (val) => { S.clickFilter = { col: 'Project', val }; renderAll(); }));

  const su = countBy(ff, 'Ticket subtype', { clean: true, limit: 8 });
  if (su.length) grid.appendChild(barCard('🏷️ Top Subtypes', su, BLUE, (val) => { S.clickFilter = { col: 'Ticket subtype', val }; renderAll(); }));

  content.appendChild(grid);
}

/* ============================== RENDER QUALITY BOARD ============================== */
function renderQualityBoard() {
  const content = $('#content');
  if (!content) return;
  content.innerHTML = '';

  const ag = S.agent || {};
  const summary = ag.summary || [
    { agent: 'Ahmed Nasr', volume: 451, ec: '97.1%', bc: '97.1%', overall: '97.1%' },
    { agent: 'Amira Gamal', volume: 428, ec: '95.6%', bc: '97.0%', overall: '96.3%' },
    { agent: 'Hussein Ismail', volume: 450, ec: '96.7%', bc: '95.8%', overall: '96.2%' },
    { agent: 'Karim Abdelbary', volume: 446, ec: '96.9%', bc: '96.6%', overall: '96.7%' },
    { agent: 'Menna Sameh', volume: 428, ec: '99.1%', bc: '98.8%', overall: '98.9%' },
  ];

  let html = `<div style="background:#fff; padding:20px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:20px;">
    <h3 style="color:${NAVY}; margin-top:0;">📋 Agent Summary</h3>
    <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
      <thead>
        <tr style="background:#f4f7fa; border-bottom:2px solid #e0e0e0;">
          <th style="padding:10px;">Agent</th>
          <th style="padding:10px;">Volume</th>
          <th style="padding:10px;">Avg EC%</th>
          <th style="padding:10px;">Avg BC%</th>
          <th style="padding:10px;">Overall Avg</th>
        </tr>
      </thead>
      <tbody>`;

  summary.forEach((row) => {
    html += `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px; font-weight:bold;">${esc(row.agent)}</td>
      <td style="padding:10px;">${fmt(row.volume)}</td>
      <td style="padding:10px;">${esc(row.ec)}</td>
      <td style="padding:10px;">${esc(row.bc)}</td>
      <td style="padding:10px; font-weight:bold; color:${BLUE}">${esc(row.overall)}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  const errorsEC = ag.ec_errors || [
    { error: 'Failure to meet agreed SLA', count: 34 },
    { error: 'Did not adhere to the call scenarios', count: 15 },
    { error: 'Did not start chat for 5 Min', count: 10 },
    { error: 'Did not escalate the issue to concerned team', count: 9 },
    { error: 'Did not provide accurate and complete information', count: 4 }
  ];

  const errorsBC = ag.bc_errors || [
    { error: 'Did not select correct call tree', count: 35 },
    { error: 'Did not add customer mobile number', count: 14 },
    { error: 'Did not select correct action taken', count: 12 },
    { error: 'Did not add correct branch username', count: 5 },
    { error: 'Did not create ticket', count: 5 }
  ];

  const errorsNC = ag.nc_errors || [
    { error: 'Unable to explain', count: 4 },
    { error: 'Used unprofessional/slang words', count: 4 },
    { error: 'Did not follow dead air procedure (10 Sec)', count: 2 },
    { error: 'Used unfriendly tone of voice', count: 2 },
    { error: 'Did not collect data in smart way', count: 1 }
  ];

  const renderErrTable = (title, items) => {
    let tHtml = `<div style="flex:1; min-width:280px; background:#fff; padding:15px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
      <h4 style="color:${NAVY}; margin-top:0;">📌 ${title}</h4>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead><tr style="background:#f4f7fa;"><th style="padding:8px; text-align:left;">Error</th><th style="padding:8px; text-align:right;">Count</th></tr></thead><tbody>`;
    items.forEach((item) => {
      tHtml += `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:8px; text-align:left;">${esc(item.error)}</td>
        <td style="padding:8px; text-align:right; font-weight:bold; color:${RED}">${fmt(item.count)}</td>
      </tr>`;
    });
    tHtml += `</tbody></table></div>`;
    return tHtml;
  };

  html += `<h3 style="color:${NAVY};">🚨 Error Analysis</h3><div style="display:flex; gap:15px; flex-wrap:wrap;">`;
  html += renderErrTable('Top EC Errors', errorsEC);
  html += renderErrTable('Top BC Errors', errorsBC);
  html += renderErrTable('Top NC Errors', errorsNC);
  html += `</div>`;

  content.innerHTML = html;
}

/* ============================== MAIN CONTROLLER ============================== */
function renderAll() {
  disposeCharts();
  if (!S.tickets) return;
  S.ffBase = S.tickets.rows || [];

  renderHeader();
  renderSidebar();
  renderTabs();

  if (S.activeTab === 0) renderOverview();
  else if (S.activeTab === 1) renderQualityBoard();
  else renderOverview();

  // Force chart layout recalculation automatically to fix invisible charts on render
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 100);
}

function renderHeader() {
  const dh = $('#dashboard-header');
  if (dh) dh.innerHTML = `<div style="margin-bottom:15px;"><h2>Support Analysis Dashboard</h2></div>`;
}

function renderSidebar() {
  const sb = $('#sidebar');
  if (!sb) return;
  sb.innerHTML = `
    <div class="sb-logo" style="margin-bottom:20px;"><img src="assets/logo_big.png" alt="Dsquares" style="max-width:140px;"></div>
    <div style="margin-bottom:15px; font-weight:bold; color:#00AEEF;">Filters</div>
    <label class="f-label">📅 Date filter</label>
    <select id="date-mode" style="width:100%; padding:8px; border-radius:6px; margin-top:5px; margin-bottom:20px;">
      ${DATE_PRESETS.map((d) => `<option value="${d}" ${S.filters.dateMode === d ? 'selected' : ''}>${d}</option>`).join('')}
    </select>
    <button id="btn-logout" style="width:100%; background:#FF4B4B; color:#fff; border:none; padding:10px; border-radius:6px; cursor:pointer; font-weight:bold;">🚪 Log Out</button>`;

  setTimeout(() => {
    const dm = $('#date-mode');
    if (dm) dm.onchange = (e) => { S.filters.dateMode = e.target.value; renderAll(); };
    const lo = $('#btn-logout');
    if (lo) lo.onclick = () => { localStorage.removeItem('ds_session'); location.reload(); };
  }, 10);
}

function renderTabs() {
  const tabs = ['Overview','Quality Board','WhatsApp MOM','Inbound SLA','Redemption Tracker','Ticket Explorer'];
  const bar = $('#tabbar');
  if (!bar) return;
  bar.innerHTML = '';
  tabs.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (i === S.activeTab ? ' active' : '');
    btn.textContent = `${TAB_EMOJI[t] || ''} ${t}`;
    btn.onclick = () => { S.activeTab = i; renderAll(); };
    bar.appendChild(btn);
  });
}

function showLoading(msg) { const ls = $('#loading-screen'); if (ls) ls.hidden = false; }
function hideLoading() { const ls = $('#loading-screen'); if (ls) ls.hidden = true; const app = $('#app'); if (app) app.hidden = false; }

async function boot() {
  await loadData(false);
  renderAll();
}

window.addEventListener('resize', () => { S.charts.forEach((c) => { try { c.resize(); } catch (e) {} }); });
document.addEventListener('DOMContentLoaded', () => { boot(); });
