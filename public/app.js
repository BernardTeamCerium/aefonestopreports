'use strict';

/* ---------------- state ---------------- */
const state = { user: null, data: null, month: null, charts: [], websiteFilter: 'all', analyticsAgent: null };
const PLATFORMS = ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'X (Twitter)', 'Google Business', 'Pinterest', 'Threads'];
const COLORS = ['#161616', '#ff5500', '#f5a300', '#7a7a7a', '#c43c00', '#2f80ed', '#1f9d55', '#9b51e0'];

/* ---------------- helpers ---------------- */
const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (Number(n) || 0).toLocaleString('en-US');
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const uid = p => p + Math.random().toString(36).slice(2, 9);
const isAdmin = () => state.user && state.user.role === 'admin';
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
const linkOrText = (url, text) => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text || url)}</a>` : esc(text || url || '—');

function monthLabel(m, short) {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleString('en-US', { month: short ? 'short' : 'long', year: 'numeric' });
}
function allMonths() {
  const set = new Set();
  const { agents, managers } = state.data;
  [...agents, ...managers].forEach(x => Object.keys(x.monthly || {}).forEach(m => set.add(m)));
  return [...set].filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
}
const mstat = (entity, m, key) => num(((entity.monthly || {})[m] || {})[key]);
const sumBy = (list, fn) => list.reduce((a, x) => a + fn(x), 0);
function prevMonth(m) { const ms = allMonths(); const i = ms.indexOf(m); return i > 0 ? ms[i - 1] : null; }
function delta(cur, prev) {
  if (prev == null || prev === 0) return '';
  const p = Math.round(((cur - prev) / prev) * 100);
  const sign = p > 0 ? '+' : '';
  return `<span style="color:${p >= 0 ? 'var(--ok)' : 'var(--off)'};font-weight:700">${sign}${p}%</span> vs prior month`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body;
}

function destroyCharts() { state.charts.forEach(c => c.destroy()); state.charts = []; }
function chart(id, config) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }, config.options || {});
  state.charts.push(new Chart(el, config));
}

/* Logo fallback: show the wordmark if /assets/logo.png isn't uploaded yet. */
document.querySelectorAll('.brand-logo').forEach(img => {
  const fallback = () => img.closest('.brand').classList.add('no-logo');
  img.addEventListener('error', fallback);
  if (img.complete && img.naturalWidth === 0) fallback();
});

/* ---------------- auth ---------------- */
async function boot() {
  try {
    const { user } = await api('/api/me');
    await enterApp(user);
  } catch { showLogin(); }
}
function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  $('#login-error').textContent = '';
  try {
    const { user } = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: f.username.value, password: f.password.value }) });
    f.reset();
    await enterApp(user);
  } catch (err) { $('#login-error').textContent = err.message; }
});
$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.user = null; state.data = null;
  destroyCharts();
  showLogin();
});

async function enterApp(user) {
  state.user = user;
  state.data = await api('/api/data');
  document.body.classList.toggle('is-admin', isAdmin());
  $('#user-chip').textContent = isAdmin() ? `${user.name} · Admin` : '';
  $('#user-chip').hidden = !isAdmin();
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  refreshMonths();
  route();
}

function refreshMonths() {
  const months = allMonths();
  if (!state.month || !months.includes(state.month)) state.month = months[months.length - 1] || null;
  $('#month-select').innerHTML = months.slice().reverse().map(m => `<option value="${m}" ${m === state.month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('') || '<option>No data yet</option>';
  $('#client-name').textContent = state.data.settings.clientName || 'Allied Elite Financial';
}
$('#month-select').addEventListener('change', e => { state.month = e.target.value; route(); });

/* ---------------- routing ---------------- */
const views = { summary: viewSummary, websites: viewWebsites, socials: viewSocials, analytics: viewAnalytics, managers: viewManagers, manage: viewManage };
window.addEventListener('hashchange', route);
function route() {
  if (!state.data) return;
  let tab = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'summary';
  if (!views[tab] || (tab === 'manage' && !isAdmin())) tab = 'summary';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  destroyCharts();
  views[tab]($('#main'));
}

/* ---------------- shared aggregates ---------------- */
function totals(m) {
  const { agents, managers } = state.data;
  const active = agents.filter(a => a.status === 'active');
  const socialsCount = sumBy(agents, a => (a.socials || []).length);
  const managedAgents = agents.filter(a => (a.socials || []).length);
  return {
    active: active.length,
    inactive: agents.length - active.length,
    socialsCount,
    managedAgents: managedAgents.length,
    posts: sumBy(agents, a => mstat(a, m, 'posts')),
    agentVisitors: sumBy(agents, a => mstat(a, m, 'visitors')),
    agentViews: sumBy(agents, a => mstat(a, m, 'pageViews')),
    agentLeads: sumBy(agents, a => mstat(a, m, 'leads')),
    mgrPages: managers.length,
    mgrActive: managers.filter(x => x.status === 'active').length,
    mgrAgents: sumBy(managers, x => num(x.agentsManaged)),
    mgrVisitors: sumBy(managers, x => mstat(x, m, 'visitors')),
    mgrViews: sumBy(managers, x => mstat(x, m, 'pageViews')),
    mgrLeads: sumBy(managers, x => mstat(x, m, 'leads')),
  };
}
const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const statusBadge = (s, clickableId) => {
  const cls = s === 'active' ? 'active' : 'inactive';
  const text = s === 'active' ? 'Active' : 'Inactive';
  return clickableId && isAdmin()
    ? `<button class="badge ${cls}" data-toggle="${esc(clickableId)}" title="Click to toggle">${text}</button>`
    : `<span class="badge ${cls}">${text}</span>`;
};

/* ---------------- Summary ---------------- */
function viewSummary(el) {
  const m = state.month;
  const t = totals(m);
  const p = prevMonth(m);
  const tp = p ? totals(p) : null;
  const totalTraffic = t.agentVisitors + t.mgrVisitors;
  const months = allMonths();
  const allTimeVisitors = sumBy(months, mm => { const x = totals(mm); return x.agentVisitors + x.mgrVisitors; });
  const allTimePosts = sumBy(months, mm => totals(mm).posts);

  const top = [...state.data.agents].sort((a, b) => mstat(b, m, 'visitors') - mstat(a, m, 'visitors')).slice(0, 5);

  el.innerHTML = `
    <div class="page-head">
      <div class="client-hero"><img src="/assets/aef-logo.svg" alt="${esc(state.data.settings.clientName)}">
      <div><h2>${esc(state.data.settings.clientName)} — Marketing Summary</h2>
      <p class="muted">Everything One Stop Marketing Solutions is building and managing for you · ${monthLabel(m) || 'No months recorded yet'}</p></div></div>
      <button class="btn" onclick="window.print()">Print / PDF</button>
    </div>
    <div class="kpis">
      ${kpi('Agent websites built', fmt(state.data.agents.length), `${fmt(t.active)} active · ${fmt(t.inactive)} inactive`)}
      ${kpi('Social accounts managed', fmt(t.socialsCount), `across ${fmt(t.managedAgents)} agents`)}
      ${kpi('Posts deployed', fmt(t.posts), tp ? delta(t.posts, tp.posts) : monthLabel(m))}
      ${kpi('Total website traffic', fmt(totalTraffic), tp ? delta(totalTraffic, tp.agentVisitors + tp.mgrVisitors) : 'visitors this month', 'navy')}
      ${kpi('Leads generated', fmt(t.agentLeads + t.mgrLeads), 'from agent & manager pages', 'navy')}
      ${kpi('Sales manager pages', fmt(t.mgrPages), `${fmt(t.mgrActive)} active · ${fmt(t.mgrAgents)} agents under management`, 'navy')}
    </div>
    <div class="kpis">
      ${kpi('All-time visitors', fmt(allTimeVisitors), `${months.length} months tracked`)}
      ${kpi('All-time posts', fmt(allTimePosts), `${months.length} months tracked`)}
      ${kpi('Page views this month', fmt(t.agentViews + t.mgrViews), 'agent + manager pages')}
    </div>
    <div class="grid-2">
      <div class="card"><h3>Collective traffic by month</h3><div class="chart-box"><canvas id="c-traffic"></canvas></div></div>
      <div class="card"><h3>Posts deployed by month</h3><div class="chart-box"><canvas id="c-posts"></canvas></div></div>
    </div>
    <div class="grid-2" style="margin-top:1.25rem">
      <div class="card"><h3>Agent website status</h3><div class="chart-box"><canvas id="c-status"></canvas></div></div>
      <div class="card"><h3>Top agents by traffic · ${monthLabel(m, true)}</h3>
        <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th class="num">Visitors</th><th class="num">Posts</th><th class="num">Leads</th></tr></thead>
        <tbody>${top.map(a => `<tr><td>${esc(a.name)}</td><td>${statusBadge(a.status)}</td><td class="num">${fmt(mstat(a, m, 'visitors'))}</td><td class="num">${fmt(mstat(a, m, 'posts'))}</td><td class="num">${fmt(mstat(a, m, 'leads'))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No agents yet</td></tr>'}</tbody></table></div>
      </div>
    </div>`;

  const labels = months.map(mm => monthLabel(mm, true));
  chart('c-traffic', { type: 'bar', data: { labels, datasets: [
    { label: 'Agent websites', data: months.map(mm => totals(mm).agentVisitors), backgroundColor: COLORS[0], stack: 's' },
    { label: 'Sales manager pages', data: months.map(mm => totals(mm).mgrVisitors), backgroundColor: COLORS[1], stack: 's' },
  ] }, options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } });
  chart('c-posts', { type: 'line', data: { labels, datasets: [
    { label: 'Posts', data: months.map(mm => totals(mm).posts), borderColor: COLORS[1], backgroundColor: 'rgba(255,85,0,.12)', fill: true, tension: .3 },
  ] }, options: { scales: { y: { beginAtZero: true } } } });
  chart('c-status', { type: 'doughnut', data: { labels: ['Active', 'Inactive'], datasets: [{ data: [t.active, t.inactive], backgroundColor: ['#1f9d55', '#d0d5dd'] }] } });
}

/* ---------------- Agent Websites ---------------- */
function viewWebsites(el) {
  const agents = state.data.agents;
  const f = state.websiteFilter;
  const list = agents.filter(a => f === 'all' || a.status === f).sort((a, b) => a.name.localeCompare(b.name));
  const active = agents.filter(a => a.status === 'active').length;
  el.innerHTML = `
    <div class="page-head"><div><h2>Agent Websites</h2><p class="muted">Every agent website built by One Stop Marketing</p></div>
      ${isAdmin() ? '<button class="btn btn-primary" id="add-agent">+ Add agent</button>' : ''}</div>
    <div class="kpis">
      ${kpi('Total websites', fmt(agents.length))}
      ${kpi('Active', fmt(active), agents.length ? Math.round(active / agents.length * 100) + '% of all sites' : '')}
      ${kpi('Inactive', fmt(agents.length - active), '', 'navy')}
    </div>
    <div class="card">
      <div class="toolbar" style="margin-bottom:.75rem">
        <div class="filters">${['all', 'active', 'inactive'].map(k => `<button class="btn btn-sm ${f === k ? 'on' : ''}" data-filter="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
        <input id="search" placeholder="Search agents…" style="margin-left:auto;min-width:200px">
      </div>
      <div class="table-wrap"><table id="tbl"><thead><tr><th>#</th><th>Agent</th><th>Website</th><th>Launched</th><th>Status</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.map((a, i) => `<tr data-name="${esc(a.name.toLowerCase())}"><td>${i + 1}</td><td><strong>${esc(a.name)}</strong><div class="muted" style="font-size:.82rem">${esc(a.title)}</div></td>
        <td>${linkOrText(a.websiteUrl, (a.websiteUrl || '').replace(/^https?:\/\//, ''))}</td><td>${esc(a.launchDate || '—')}</td><td>${statusBadge(a.status, a.id)}</td>
        ${isAdmin() ? `<td><button class="btn btn-sm" data-edit="${esc(a.id)}">Edit</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="6" class="empty">No agents ${f !== 'all' ? 'with this status' : 'yet'}</td></tr>`}</tbody></table></div>
    </div>`;
  el.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.websiteFilter = b.dataset.filter; route(); });
  $('#search').oninput = e => { const q = e.target.value.toLowerCase(); el.querySelectorAll('#tbl tbody tr[data-name]').forEach(tr => tr.hidden = !tr.dataset.name.includes(q)); };
  bindAdminRowActions(el, 'agents');
  const add = $('#add-agent'); if (add) add.onclick = () => editAgent(null);
}

/* ---------------- Social Media ---------------- */
function viewSocials(el) {
  const m = state.month;
  const months = allMonths();
  const agents = [...state.data.agents].sort((a, b) => a.name.localeCompare(b.name));
  const accounts = sumBy(agents, a => (a.socials || []).length);
  const byPlatform = {};
  agents.forEach(a => (a.socials || []).forEach(s => { byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1; }));
  const recent = months.slice(-6);
  el.innerHTML = `
    <div class="page-head"><div><h2>Social Media Management</h2><p class="muted">Agent social accounts we manage and posts deployed each month</p></div></div>
    <div class="kpis">
      ${kpi('Accounts managed', fmt(accounts), `${Object.keys(byPlatform).length} platforms`)}
      ${kpi('Agents with socials', fmt(agents.filter(a => (a.socials || []).length).length))}
      ${kpi(`Posts · ${monthLabel(m, true)}`, fmt(sumBy(agents, a => mstat(a, m, 'posts'))), '', 'navy')}
      ${kpi('Total followers', fmt(sumBy(agents, a => sumBy(a.socials || [], s => num(s.followers)))), 'across managed accounts', 'navy')}
    </div>
    <div class="grid-2">
      <div class="card"><h3>Accounts by platform</h3><div class="chart-box"><canvas id="c-plat"></canvas></div></div>
      <div class="card"><h3>Posts per agent · ${monthLabel(m, true)}</h3><div class="chart-box"><canvas id="c-agentposts"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:1.25rem"><h3>Managed accounts</h3>
      <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Platforms</th><th class="num">Accounts</th><th class="num">Followers</th></tr></thead>
      <tbody>${agents.map(a => `<tr><td><strong>${esc(a.name)}</strong> ${statusBadge(a.status)}</td>
        <td>${(a.socials || []).map(s => safeUrl(s.url) ? `<a class="plat" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.handle)}">${esc(s.platform)}</a>` : `<span class="plat" title="${esc(s.handle)}">${esc(s.platform)}</span>`).join('') || '<span class="muted">—</span>'}</td>
        <td class="num">${(a.socials || []).length}</td><td class="num">${fmt(sumBy(a.socials || [], s => num(s.followers)))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No agents yet</td></tr>'}</tbody></table></div>
    </div>
    <div class="card"><h3>Posts deployed per agent per month</h3>
      <div class="table-wrap"><table><thead><tr><th>Agent</th>${recent.map(mm => `<th class="num">${monthLabel(mm, true)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${agents.map(a => `<tr><td>${esc(a.name)}</td>${recent.map(mm => `<td class="num">${fmt(mstat(a, mm, 'posts'))}</td>`).join('')}<td class="num"><strong>${fmt(sumBy(recent, mm => mstat(a, mm, 'posts')))}</strong></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>All agents</td>${recent.map(mm => `<td class="num">${fmt(sumBy(agents, a => mstat(a, mm, 'posts')))}</td>`).join('')}<td class="num">${fmt(sumBy(recent, mm => sumBy(agents, a => mstat(a, mm, 'posts'))))}</td></tr></tfoot></table></div>
    </div>`;
  const plats = Object.keys(byPlatform);
  chart('c-plat', { type: 'doughnut', data: { labels: plats, datasets: [{ data: plats.map(p => byPlatform[p]), backgroundColor: COLORS }] } });
  const withPosts = agents.filter(a => mstat(a, m, 'posts') > 0);
  chart('c-agentposts', { type: 'bar', data: { labels: withPosts.map(a => a.name), datasets: [{ label: 'Posts', data: withPosts.map(a => mstat(a, m, 'posts')), backgroundColor: COLORS[1] }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } } });
}

/* ---------------- Analytics ---------------- */
function viewAnalytics(el) {
  const m = state.month;
  const months = allMonths();
  const agents = [...state.data.agents].sort((a, b) => a.name.localeCompare(b.name));
  if (!state.analyticsAgent || !agents.find(a => a.id === state.analyticsAgent)) state.analyticsAgent = agents[0] && agents[0].id;
  const a = agents.find(x => x.id === state.analyticsAgent);
  const t = totals(m);
  const labels = months.map(mm => monthLabel(mm, true));

  el.innerHTML = `
    <div class="page-head"><div><h2>Website Analytics</h2><p class="muted">Collective traffic and individual agent performance · ${monthLabel(m)}</p></div></div>
    <h3>Collective traffic</h3>
    <div class="kpis">
      ${kpi('Total visitors', fmt(t.agentVisitors + t.mgrVisitors), 'all agent & manager pages')}
      ${kpi('Agent site visitors', fmt(t.agentVisitors))}
      ${kpi('Manager page visitors', fmt(t.mgrVisitors))}
      ${kpi('Total page views', fmt(t.agentViews + t.mgrViews), '', 'navy')}
      ${kpi('Total leads', fmt(t.agentLeads + t.mgrLeads), '', 'navy')}
    </div>
    <div class="card"><h3>Traffic by agent · ${monthLabel(m, true)}</h3>
      <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th class="num">Visitors</th><th class="num">Page views</th><th class="num">Leads</th><th class="num">Share of traffic</th></tr></thead>
      <tbody>${agents.sort((x, y) => mstat(y, m, 'visitors') - mstat(x, m, 'visitors')).map(x => `<tr><td><a href="#/analytics" data-agent="${esc(x.id)}">${esc(x.name)}</a></td><td>${statusBadge(x.status)}</td>
        <td class="num">${fmt(mstat(x, m, 'visitors'))}</td><td class="num">${fmt(mstat(x, m, 'pageViews'))}</td><td class="num">${fmt(mstat(x, m, 'leads'))}</td>
        <td class="num">${t.agentVisitors ? (mstat(x, m, 'visitors') / t.agentVisitors * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">All agents</td><td class="num">${fmt(t.agentVisitors)}</td><td class="num">${fmt(t.agentViews)}</td><td class="num">${fmt(t.agentLeads)}</td><td class="num">100%</td></tr></tfoot></table></div>
    </div>
    <div class="card" id="agent-detail">
      <div class="page-head" style="margin-bottom:.5rem"><h3 style="margin:0">Individual agent analytics</h3>
        <select id="agent-pick" style="width:auto;margin:0">${[...state.data.agents].sort((x, y) => x.name.localeCompare(y.name)).map(x => `<option value="${esc(x.id)}" ${x.id === state.analyticsAgent ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      ${a ? `
      <p class="muted" style="margin-top:0">${linkOrText(a.websiteUrl)} · ${statusBadge(a.status)}</p>
      <div class="kpis">
        ${kpi('Visitors', fmt(mstat(a, m, 'visitors')), delta(mstat(a, m, 'visitors'), prevMonth(m) && mstat(a, prevMonth(m), 'visitors')))}
        ${kpi('Page views', fmt(mstat(a, m, 'pageViews')))}
        ${kpi('Leads', fmt(mstat(a, m, 'leads')), '', 'navy')}
        ${kpi('Posts deployed', fmt(mstat(a, m, 'posts')), `${(a.socials || []).length} accounts managed`, 'navy')}
      </div>
      <div class="chart-box"><canvas id="c-agent"></canvas></div>` : '<p class="empty">No agents yet</p>'}
    </div>`;
  el.querySelectorAll('[data-agent]').forEach(l => l.onclick = e => { e.preventDefault(); state.analyticsAgent = l.dataset.agent; route(); setTimeout(() => $('#agent-detail').scrollIntoView({ behavior: 'smooth' }), 50); });
  $('#agent-pick').onchange = e => { state.analyticsAgent = e.target.value; route(); setTimeout(() => $('#agent-detail').scrollIntoView(), 0); };
  if (a) chart('c-agent', { type: 'bar', data: { labels, datasets: [
    { type: 'line', label: 'Visitors', data: months.map(mm => mstat(a, mm, 'visitors')), borderColor: COLORS[0], backgroundColor: COLORS[0], tension: .3, yAxisID: 'y' },
    { type: 'line', label: 'Page views', data: months.map(mm => mstat(a, mm, 'pageViews')), borderColor: COLORS[2], backgroundColor: COLORS[2], tension: .3, yAxisID: 'y' },
    { label: 'Leads', data: months.map(mm => mstat(a, mm, 'leads')), backgroundColor: COLORS[1], yAxisID: 'y2' },
  ] }, options: { scales: { y: { beginAtZero: true, position: 'left' }, y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Leads' } } } } });
}

/* ---------------- Sales Manager Pages ---------------- */
function viewManagers(el) {
  const m = state.month;
  const months = allMonths();
  const list = [...state.data.managers].sort((a, b) => a.name.localeCompare(b.name));
  const t = totals(m);
  el.innerHTML = `
    <div class="page-head"><div><h2>Sales Manager Pages</h2><p class="muted">Sales manager pages created and managed by One Stop Marketing</p></div>
      ${isAdmin() ? '<button class="btn btn-primary" id="add-mgr">+ Add sales manager</button>' : ''}</div>
    <div class="kpis">
      ${kpi('Pages created', fmt(list.length), `${fmt(t.mgrActive)} active`)}
      ${kpi('Agents under management', fmt(t.mgrAgents), 'across all sales managers')}
      ${kpi(`Visitors · ${monthLabel(m, true)}`, fmt(t.mgrVisitors), '', 'navy')}
      ${kpi(`Leads · ${monthLabel(m, true)}`, fmt(t.mgrLeads), '', 'navy')}
    </div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Sales manager</th><th>Region / Team</th><th>Page</th><th>Launched</th><th class="num">Agents managed</th><th class="num">Visitors</th><th class="num">Leads</th><th>Status</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.region || '—')}</td><td>${linkOrText(x.pageUrl, 'View page')}</td><td>${esc(x.launchDate || '—')}</td>
        <td class="num">${fmt(x.agentsManaged)}</td><td class="num">${fmt(mstat(x, m, 'visitors'))}</td><td class="num">${fmt(mstat(x, m, 'leads'))}</td><td>${statusBadge(x.status, x.id)}</td>
        ${isAdmin() ? `<td><button class="btn btn-sm" data-edit="${esc(x.id)}">Edit</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="9" class="empty">No sales manager pages yet</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${fmt(t.mgrAgents)}</td><td class="num">${fmt(t.mgrVisitors)}</td><td class="num">${fmt(t.mgrLeads)}</td><td colspan="${isAdmin() ? 2 : 1}"></td></tr></tfoot></table></div></div>
    <div class="card"><h3>Sales manager page traffic by month</h3><div class="chart-box"><canvas id="c-mgr"></canvas></div></div>`;
  chart('c-mgr', { type: 'line', data: { labels: months.map(mm => monthLabel(mm, true)), datasets: list.map((x, i) => ({
    label: x.name, data: months.map(mm => mstat(x, mm, 'visitors')), borderColor: COLORS[i % COLORS.length], backgroundColor: COLORS[i % COLORS.length], tension: .3 })) },
    options: { scales: { y: { beginAtZero: true } } } });
  bindAdminRowActions(el, 'managers');
  const add = $('#add-mgr'); if (add) add.onclick = () => editManager(null);
}

/* ---------------- Admin: Manage Data ---------------- */
function viewManage(el) {
  const { agents, managers, settings } = state.data;
  el.innerHTML = `
    <div class="page-head"><div><h2>Manage Data</h2><p class="muted">Only One Stop Marketing admins see this tab. Changes save instantly and appear for the client.</p></div></div>
    <div class="grid-2">
      <div class="card"><h3>Agents (${agents.length})</h3>
        <p class="muted">Website, status, social accounts, and monthly posts & analytics.</p>
        <div class="toolbar"><button class="btn btn-primary" id="m-add-agent">+ Add agent</button><a class="btn" href="#/websites">View list</a></div>
        <div class="table-wrap" style="margin-top:.75rem;max-height:320px;overflow:auto"><table><tbody>${[...agents].sort((a, b) => a.name.localeCompare(b.name)).map(a => `<tr><td>${esc(a.name)}</td><td>${statusBadge(a.status, a.id)}</td><td class="num"><button class="btn btn-sm" data-edit="${esc(a.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="card"><h3>Sales managers (${managers.length})</h3>
        <p class="muted">Manager pages, agents managed, and monthly analytics.</p>
        <div class="toolbar"><button class="btn btn-primary" id="m-add-mgr">+ Add sales manager</button><a class="btn" href="#/managers">View list</a></div>
        <div class="table-wrap" style="margin-top:.75rem;max-height:320px;overflow:auto"><table><tbody>${[...managers].sort((a, b) => a.name.localeCompare(b.name)).map(x => `<tr><td>${esc(x.name)}</td><td>${statusBadge(x.status, x.id)}</td><td class="num"><button class="btn btn-sm" data-medit="${esc(x.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>
    <div class="card" style="margin-top:1.25rem"><h3>Monthly quick entry</h3>
      <p class="muted">Enter one month's numbers for every agent and sales manager at once.</p>
      <div class="toolbar"><input type="month" id="qe-month" value="${state.month || new Date().toISOString().slice(0, 7)}"><button class="btn btn-dark" id="qe-open">Open month</button></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Portal settings</h3>
        <label>Client name<input id="s-client" value="${esc(settings.clientName)}"></label>
        <div class="toolbar" style="margin-top:1rem"><button class="btn btn-dark" id="s-save">Save settings</button></div>
        <h3 style="margin-top:1.5rem">Backup & import</h3>
        <div class="toolbar"><button class="btn" id="d-export">Download backup (JSON)</button>
          <label class="btn" style="margin:0;color:var(--text)">Import JSON<input type="file" id="d-import" accept="application/json" hidden></label>
          <button class="btn btn-danger" id="d-clear">Clear all data</button></div>
      </div>
      <div class="card"><h3>Logins</h3><p class="muted">Change the password for the admin or client login.</p><div id="users">Loading…</div></div>
    </div>`;

  $('#m-add-agent').onclick = () => editAgent(null);
  $('#m-add-mgr').onclick = () => editManager(null);
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editAgent(b.dataset.edit));
  el.querySelectorAll('[data-medit]').forEach(b => b.onclick = () => editManager(b.dataset.medit));
  el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggleStatus(b.dataset.toggle));
  $('#qe-open').onclick = () => { const v = $('#qe-month').value; if (v) quickEntry(v); };
  $('#s-save').onclick = async () => { state.data.settings.clientName = $('#s-client').value.trim() || 'Allied Elite Financial'; await save('Settings saved'); };
  $('#d-export').onclick = () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `aef-report-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('#d-import').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.managers)) throw new Error('File must contain agents and managers arrays');
      if (!confirm('Replace all current data with this file?')) return;
      state.data = parsed; await save('Data imported');
    } catch (err) { alert('Import failed: ' + err.message); }
  };
  $('#d-clear').onclick = async () => {
    if (!confirm('Delete ALL agents and sales managers? (Download a backup first if unsure.)')) return;
    state.data.agents = []; state.data.managers = []; await save('All data cleared');
  };

  api('/api/users').then(users => {
    $('#users').innerHTML = users.map(u => `<div class="toolbar" style="margin:.5rem 0"><div style="min-width:150px"><strong>${esc(u.username)}</strong><div class="muted" style="font-size:.8rem">${u.role === 'admin' ? 'Admin (One Stop)' : 'Client (read-only)'}</div></div>
      <input type="password" placeholder="New password (8+ chars)" data-pw="${esc(u.username)}" style="flex:1;min-width:160px"><button class="btn btn-sm btn-dark" data-pwsave="${esc(u.username)}">Update</button></div>`).join('');
    document.querySelectorAll('[data-pwsave]').forEach(b => b.onclick = async () => {
      const input = document.querySelector(`[data-pw="${CSS.escape(b.dataset.pwsave)}"]`);
      try { await api('/api/users/password', { method: 'POST', body: JSON.stringify({ username: b.dataset.pwsave, password: input.value }) }); input.value = ''; toast('Password updated'); }
      catch (err) { alert(err.message); }
    });
  }).catch(() => { $('#users').textContent = 'Could not load logins.'; });
}

function bindAdminRowActions(el, kind) {
  el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggleStatus(b.dataset.toggle));
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => (kind === 'agents' ? editAgent : editManager)(b.dataset.edit));
}

async function toggleStatus(id) {
  const x = state.data.agents.find(a => a.id === id) || state.data.managers.find(a => a.id === id);
  if (!x) return;
  x.status = x.status === 'active' ? 'inactive' : 'active';
  await save(`${x.name} marked ${x.status}`);
}

async function save(message) {
  try {
    state.data = await api('/api/data', { method: 'PUT', body: JSON.stringify(state.data) });
    refreshMonths(); route();
    if (message) toast(message);
  } catch (err) {
    alert('Save failed: ' + err.message);
    if (err.status === 401) showLogin();
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'var(--brand)', color: '#fff', padding: '.6rem 1rem', borderRadius: '8px', zIndex: 99, boxShadow: 'var(--shadow)' });
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

/* ---------------- Modal editors ---------------- */
const modal = $('#modal');
const modalForm = $('#modal-form');

function monthlyRows(monthly, fields) {
  const months = Object.keys(monthly || {}).sort().reverse();
  return months.map(m => monthlyRow(m, monthly[m], fields)).join('');
}
function monthlyRow(m, vals, fields) {
  return `<tr><td><input type="month" name="mm" value="${esc(m)}" required></td>${fields.map(f => `<td><input type="number" min="0" name="${f}" value="${esc(num((vals || {})[f]))}"></td>`).join('')}<td><button type="button" class="btn btn-sm btn-danger" data-rm>✕</button></td></tr>`;
}
function socialRow(s = {}) {
  return `<tr><td><select name="platform">${PLATFORMS.map(p => `<option ${p === s.platform ? 'selected' : ''}>${p}</option>`).join('')}${s.platform && !PLATFORMS.includes(s.platform) ? `<option selected>${esc(s.platform)}</option>` : ''}</select></td>
    <td><input name="handle" placeholder="@handle" value="${esc(s.handle)}"></td><td><input name="url" placeholder="https://…" value="${esc(s.url)}"></td>
    <td><input type="number" min="0" name="followers" value="${esc(num(s.followers))}" style="width:100px"></td><td><button type="button" class="btn btn-sm btn-danger" data-rm>✕</button></td></tr>`;
}
function readMonthly(tbody, fields) {
  const out = {};
  tbody.querySelectorAll('tr').forEach(tr => {
    const m = tr.querySelector('[name=mm]').value;
    if (!m) return;
    out[m] = {};
    fields.forEach(f => { out[m][f] = num(tr.querySelector(`[name=${f}]`).value); });
  });
  return out;
}
function nextMonthFor(tbody) {
  const ms = [...tbody.querySelectorAll('[name=mm]')].map(i => i.value).filter(Boolean).sort();
  if (!ms.length) return new Date().toISOString().slice(0, 7);
  const [y, mo] = ms[ms.length - 1].split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function wireRemovers(root) { root.addEventListener('click', e => { if (e.target.matches('[data-rm]')) e.target.closest('tr').remove(); }); }

function openModal(html, onSubmit) {
  modalForm.innerHTML = html;
  modalForm.onsubmit = async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const keepOpen = await onSubmit(e.submitter && e.submitter.value);
    if (!keepOpen) modal.close();
  };
  wireRemovers(modalForm);
  modal.showModal();
}

const AGENT_FIELDS = ['posts', 'visitors', 'pageViews', 'leads'];
const MGR_FIELDS = ['visitors', 'pageViews', 'leads'];

function editAgent(id) {
  const existing = state.data.agents.find(a => a.id === id);
  const a = existing || { id: uid('a'), name: '', title: 'Financial Professional', websiteUrl: '', status: 'active', launchDate: '', socials: [], monthly: {} };
  openModal(`
    <h2>${existing ? 'Edit agent' : 'Add agent'}</h2>
    <div class="form-grid">
      <label>Agent name<input name="name" required value="${esc(a.name)}"></label>
      <label>Title<input name="title" value="${esc(a.title)}"></label>
      <label>Website URL<input name="websiteUrl" placeholder="https://…" value="${esc(a.websiteUrl)}"></label>
      <label>Launch date<input type="date" name="launchDate" value="${esc(a.launchDate)}"></label>
      <label>Status<select name="status"><option value="active" ${a.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${a.status !== 'active' ? 'selected' : ''}>Inactive</option></select></label>
    </div>
    <div class="section-title"><h3>Social accounts managed</h3><button type="button" class="btn btn-sm" id="add-social">+ Add account</button></div>
    <div class="table-wrap"><table class="sub-table"><thead><tr><th>Platform</th><th>Handle</th><th>Profile URL</th><th>Followers</th><th></th></tr></thead><tbody id="socials">${(a.socials || []).map(socialRow).join('')}</tbody></table></div>
    <div class="section-title"><h3>Monthly posts & analytics</h3><button type="button" class="btn btn-sm" id="add-month">+ Add month</button></div>
    <div class="table-wrap"><table class="sub-table"><thead><tr><th>Month</th><th>Posts</th><th>Visitors</th><th>Page views</th><th>Leads</th><th></th></tr></thead><tbody id="months">${monthlyRows(a.monthly, AGENT_FIELDS)}</tbody></table></div>
    <div class="modal-actions">
      ${existing ? '<button class="btn btn-danger" value="delete" formnovalidate style="margin-right:auto">Delete agent</button>' : ''}
      <button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="save">Save</button>
    </div>`, async action => {
    if (action === 'delete') {
      if (!confirm(`Delete ${a.name}?`)) return true;
      state.data.agents = state.data.agents.filter(x => x.id !== a.id);
      await save('Agent deleted'); return false;
    }
    const f = modalForm;
    Object.assign(a, { name: f.name.value.trim(), title: f.title.value.trim(), websiteUrl: f.websiteUrl.value.trim(), launchDate: f.launchDate.value, status: f.status.value });
    a.socials = [...$('#socials').querySelectorAll('tr')].map(tr => ({ platform: tr.querySelector('[name=platform]').value, handle: tr.querySelector('[name=handle]').value.trim(), url: tr.querySelector('[name=url]').value.trim(), followers: num(tr.querySelector('[name=followers]').value) }));
    a.monthly = readMonthly($('#months'), AGENT_FIELDS);
    if (!existing) state.data.agents.push(a);
    await save(existing ? 'Agent updated' : 'Agent added');
  });
  $('#add-social').onclick = () => $('#socials').insertAdjacentHTML('beforeend', socialRow());
  $('#add-month').onclick = () => $('#months').insertAdjacentHTML('afterbegin', monthlyRow(nextMonthFor($('#months')), {}, AGENT_FIELDS));
}

function editManager(id) {
  const existing = state.data.managers.find(x => x.id === id);
  const x = existing || { id: uid('m'), name: '', region: '', pageUrl: '', status: 'active', launchDate: '', agentsManaged: 0, monthly: {} };
  openModal(`
    <h2>${existing ? 'Edit sales manager' : 'Add sales manager'}</h2>
    <div class="form-grid">
      <label>Name<input name="name" required value="${esc(x.name)}"></label>
      <label>Region / Team<input name="region" value="${esc(x.region)}"></label>
      <label>Page URL<input name="pageUrl" placeholder="https://…" value="${esc(x.pageUrl)}"></label>
      <label>Launch date<input type="date" name="launchDate" value="${esc(x.launchDate)}"></label>
      <label>Agents managed<input type="number" min="0" name="agentsManaged" value="${esc(num(x.agentsManaged))}"></label>
      <label>Status<select name="status"><option value="active" ${x.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${x.status !== 'active' ? 'selected' : ''}>Inactive</option></select></label>
    </div>
    <div class="section-title"><h3>Monthly analytics</h3><button type="button" class="btn btn-sm" id="add-month">+ Add month</button></div>
    <div class="table-wrap"><table class="sub-table"><thead><tr><th>Month</th><th>Visitors</th><th>Page views</th><th>Leads</th><th></th></tr></thead><tbody id="months">${monthlyRows(x.monthly, MGR_FIELDS)}</tbody></table></div>
    <div class="modal-actions">
      ${existing ? '<button class="btn btn-danger" value="delete" formnovalidate style="margin-right:auto">Delete</button>' : ''}
      <button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="save">Save</button>
    </div>`, async action => {
    if (action === 'delete') {
      if (!confirm(`Delete ${x.name}?`)) return true;
      state.data.managers = state.data.managers.filter(y => y.id !== x.id);
      await save('Sales manager deleted'); return false;
    }
    const f = modalForm;
    Object.assign(x, { name: f.name.value.trim(), region: f.region.value.trim(), pageUrl: f.pageUrl.value.trim(), launchDate: f.launchDate.value, agentsManaged: num(f.agentsManaged.value), status: f.status.value });
    x.monthly = readMonthly($('#months'), MGR_FIELDS);
    if (!existing) state.data.managers.push(x);
    await save(existing ? 'Sales manager updated' : 'Sales manager added');
  });
  $('#add-month').onclick = () => $('#months').insertAdjacentHTML('afterbegin', monthlyRow(nextMonthFor($('#months')), {}, MGR_FIELDS));
}

/* Enter one month of numbers for everyone in a single grid. */
function quickEntry(m) {
  const agents = [...state.data.agents].sort((a, b) => a.name.localeCompare(b.name));
  const mgrs = [...state.data.managers].sort((a, b) => a.name.localeCompare(b.name));
  const cell = (ent, f) => `<td><input type="number" min="0" data-id="${esc(ent.id)}" data-f="${f}" value="${esc(mstat(ent, m, f))}"></td>`;
  openModal(`
    <h2>Monthly entry · ${monthLabel(m)}</h2>
    <h3>Agents</h3>
    <div class="table-wrap"><table class="sub-table"><thead><tr><th>Agent</th><th>Posts</th><th>Visitors</th><th>Page views</th><th>Leads</th></tr></thead>
      <tbody>${agents.map(a => `<tr><td>${esc(a.name)}</td>${AGENT_FIELDS.map(f => cell(a, f)).join('')}</tr>`).join('') || '<tr><td colspan="5" class="empty">No agents</td></tr>'}</tbody></table></div>
    <h3 style="margin-top:1rem">Sales managers</h3>
    <div class="table-wrap"><table class="sub-table"><thead><tr><th>Sales manager</th><th>Visitors</th><th>Page views</th><th>Leads</th></tr></thead>
      <tbody>${mgrs.map(x => `<tr><td>${esc(x.name)}</td>${MGR_FIELDS.map(f => cell(x, f)).join('')}</tr>`).join('') || '<tr><td colspan="4" class="empty">No sales managers</td></tr>'}</tbody></table></div>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="save">Save month</button></div>`, async () => {
    modalForm.querySelectorAll('input[data-id]').forEach(inp => {
      const ent = state.data.agents.find(a => a.id === inp.dataset.id) || state.data.managers.find(a => a.id === inp.dataset.id);
      ent.monthly = ent.monthly || {};
      ent.monthly[m] = ent.monthly[m] || {};
      ent.monthly[m][inp.dataset.f] = num(inp.value);
    });
    state.month = m;
    await save(`${monthLabel(m)} saved`);
  });
}

boot();
