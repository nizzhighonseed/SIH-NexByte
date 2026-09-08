// ============================================
// INDIAN GOV PROJECT DATABASE (Real Reference)
// ============================================
// ============================================
// PROJECT DATA (stored separately in projects.json)
// ============================================
let INDIA_PROJECT_DB = [];

// Currency conversion rates (approximate, to INR)
const CURRENCY_RATES = {
    INR: 1,
    USD: 83.5,
    EUR: 91.2,
    GBP: 106.0,
    JPY: 0.56,
    AED: 22.7,
    SGD: 62.5,
};

const CURRENCY_SYMBOLS = {
    INR: '\u20B9',
    USD: '$',
    EUR: '\u20AC',
    GBP: '\u00A3',
    JPY: '\u00A5',
    AED: 'AED',
    SGD: 'S$',
};

// NLP keyword analysis for project descriptions
const RISK_KEYWORDS = {
    high: [
        'delay', 'delayed', 'overrun', 'corruption', 'scam', 'dispute',
        'litigation', 'legal', 'court', 'protest', 'agitation', 'strikes',
        'land acquisition', 'environmental clearance', 'forest clearance',
        'tribal', 'rehabilitation', 'encumbrance', 'litigation',
        'cost overrun', 'time overrun', 'abandoned', 'stalled',
        'contractor dispute', 'payment delay', 'funding gap',
        'poor quality', 'structural failure', 'accident', 'casualty',
        'natural disaster', 'flood', 'earthquake', 'cyclone',
        'political', 'election', 'change of government', 'policy shift',
        'unstable terrain', 'seismic zone', 'difficult terrain',
        'multiple stakeholders', 'inter-agency', 'coordination issues',
        'bureaucratic', 'red tape', 'clearance delays',
    ],
    medium: [
        'phase', 'phased', 'revised', 'amendment', 're-estimated',
        'partial funding', 'tender', 're-tender', 'cancellation',
        'monitoring', 'audit', 'review', 'inspection',
        'technical complexity', 'innovative', 'first-of-its-kind',
        'public private', 'PPP', 'concession', 'viability gap',
        'multi-package', 'multiple contractors',
    ],
    positive: [
        'on track', 'ahead of schedule', 'completed', 'commissioned',
        'inaugurated', 'operational', 'best practices', 'model project',
        'world bank', 'ADB', 'Japanese funding', 'exemplary',
        'successful', 'award winning', 'sustainable', 'green',
    ],
};

// ============================================
// DOM REFERENCES
// ============================================
const form = document.getElementById('riskForm');
const themeToggle = document.getElementById('themeToggle');
const currencySelect = document.getElementById('currencySelect');
const emptyState = document.getElementById('emptyState');
const resultsDashboard = document.getElementById('resultsDashboard');
const analyzeBtn = document.getElementById('analyzeBtn');

let budgetChart = null, riskRadar = null, timelineChart = null;
let currentCurrency = 'INR';
let currentTheme = 'light';
let dbCurrentFilter = 'all';
let dbCurrentSort = 'risk-desc';
let modalChart = null;
let lastAnalysis = null;

let currentUser = null;
let savedProjects = [];
let editingProjectId = null;

function typeIcon(type) {
    const icons = {
        railway: '\uD83D\uDE88',
        infrastructure: '\uD83C\uDFD7\uFE0F',
        water: '\uD83D\uDCA7',
        energy: '\u26A1',
        housing: '\uD83C\uDFE0',
        it: '\uD83D\uDCBB',
        defense: '\uD83D\uDCAA',
        health: '\u2695\uFE0F',
        education: '\uD83C\uDF93',
    };
    return icons[type] || '\uD83D\uDCCB';
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// DB VIEW STATE
// ============================================
const dbView = document.getElementById('dbView');
const analyzerView = document.getElementById('analyzerView');
const sidebar = document.getElementById('sidebar');
let reportsView = document.getElementById('reportsView');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const modalClose = document.getElementById('modalClose');
const dbGrid = document.getElementById('dbGrid');
const dbSearch = document.getElementById('dbSearch');
const dbCount = document.getElementById('dbCount');
const dbStateFilter = document.getElementById('dbStateFilter');
const savedView = document.getElementById('savedView');
const savedGrid = document.getElementById('savedGrid');
const savedCount = document.getElementById('savedCount');
const adminView = document.getElementById('adminView');
const adminGrid = document.getElementById('adminGrid');
const adminCount = document.getElementById('adminCount');
const adminFormCard = document.getElementById('adminFormCard');

let dbCurrentState = 'all';

// ============================================
// API HELPER + DATA LOADER (server-backed DB)
// ============================================
async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
        opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
        const msg = (data && data.error) ? data.error : 'HTTP ' + res.status;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
    return data;
}

async function loadProjectData() {
    return api('/api/projects');
}

function showDataLoadError(err) {
    const banner = document.getElementById('dataLoadBanner');
    if (!banner) return;
    banner.style.display = 'block';
    banner.innerHTML =
        '<strong>Project database could not be loaded.</strong> ' +
        (err && err.message ? ' Error: ' + err.message : ' Is the server running?');
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // ---- Auth gate: must be signed in ----
    let me = null;
    try {
        me = await api('/api/auth/me');
    } catch (err) {
        window.location.href = '/login';
        return;
    }
    currentUser = me.user;
    initUserChip(currentUser);
    showAdminTab(currentUser);

    // Load project data from the server database
    try {
        INDIA_PROJECT_DB = await loadProjectData();
    } catch (err) {
        console.error('Failed to load projects:', err);
        showDataLoadError(err);
    }

    // Load this user's saved analyses
    try {
        savedProjects = await api('/api/saved');
    } catch (err) {
        savedProjects = [];
    }

    // Theme
    const saved = localStorage.getItem('govrisk-theme');
    if (saved) {
        currentTheme = saved;
        document.documentElement.setAttribute('data-theme', saved);
    }

    // Currency
    const savedCur = localStorage.getItem('govrisk-currency');
    if (savedCur) {
        currentCurrency = savedCur;
        currencySelect.value = savedCur;
        updateCurrencySymbols(savedCur);
    }

    // Events
    themeToggle.addEventListener('click', toggleTheme);
    currencySelect.addEventListener('change', (e) => {
        currentCurrency = e.target.value;
        localStorage.setItem('govrisk-currency', currentCurrency);
        updateCurrencySymbols(currentCurrency);
    });
    form.addEventListener('submit', handleSubmit);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            handleTabSwitch(tab.dataset.tab);
        });
    });

    // Database view controls
    dbSearch.addEventListener('input', renderDbCards);
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            dbCurrentFilter = btn.dataset.filter;
            renderDbCards();
        });
    });
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            dbCurrentSort = btn.dataset.sort;
            renderDbCards();
        });
    });
    if (dbStateFilter) {
        dbStateFilter.addEventListener('change', () => {
            dbCurrentState = dbStateFilter.value;
            renderDbCards();
        });
    }

    // Populate state filter dropdown
    populateStateFilter();

    // Modal close
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Saved projects
    const saveBtn = document.getElementById('saveAnalysisBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentAnalysis);
    const clearSavedBtn = document.getElementById('clearSavedBtn');
    if (clearSavedBtn) clearSavedBtn.addEventListener('click', clearSaved);
    const exportAllBtn = document.getElementById('exportAllBtn');
    if (exportAllBtn) exportAllBtn.addEventListener('click', () => exportSaved(null));

    // Admin controls
    const adminSaveBtn = document.getElementById('adminSaveBtn');
    if (adminSaveBtn) adminSaveBtn.addEventListener('click', adminSubmit);
    const adminCancelBtn = document.getElementById('adminCancelBtn');
    if (adminCancelBtn) adminCancelBtn.addEventListener('click', adminResetForm);
    const adminSeedBtn = document.getElementById('adminSeedBtn');
    if (adminSeedBtn) adminSeedBtn.addEventListener('click', adminSeed);

    // Mobile sidebar collapse toggle
    const collapseBtn = document.getElementById('sidebarCollapse');
    const floatingInputBtn = document.getElementById('floatingInputBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            sidebar.classList.add('sidebar-hidden');
            if (floatingInputBtn) floatingInputBtn.style.display = 'flex';
        });
    }
    if (floatingInputBtn) {
        floatingInputBtn.addEventListener('click', () => {
            sidebar.classList.remove('sidebar-hidden');
            floatingInputBtn.style.display = 'none';
        });
    }

    // Render DB cards on init
    renderDbCards();
});

// ============================================
// USER SESSION UI
// ============================================
function initUserChip(user) {
    const chip = document.getElementById('userChip');
    if (!chip) return;
    chip.style.display = 'flex';
    const nameEl = document.getElementById('userDisplayName');
    if (nameEl) nameEl.textContent = user.username + (user.role === 'admin' ? ' ★' : '');
    chip.title = 'Signed in as ' + user.username + ' (' + user.role + ')';
}

async function handleLogout() {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    window.location.href = '/login';
}

// ============================================
// STATE FILTER
// ============================================
function populateStateFilter() {
    if (!dbStateFilter) return;
    dbStateFilter.options.length = 1;
    const states = new Set();
    INDIA_PROJECT_DB.forEach(p => {
        if (p.state) {
            p.state.split(',').map(s => s.trim()).forEach(s => states.add(s));
        }
    });
    const sorted = [...states].sort();
    sorted.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        dbStateFilter.appendChild(opt);
    });
}

function projectMatchesState(p, state) {
    if (!state || state === 'all') return true;
    if (!p.state) return false;
    return p.state.split(',').map(s => s.trim()).includes(state);
}

// ============================================
// TAB SWITCHING
// ============================================
function handleTabSwitch(tab) {
    // Hide analyzer view
    analyzerView.style.display = 'none';
    // Hide db view
    if (dbView) dbView.style.display = 'none';
    // Hide reports view if exists
    if (reportsView) reportsView.style.display = 'none';
    // Hide saved view if exists
    if (savedView) savedView.style.display = 'none';
    // Hide admin view if exists
    if (adminView) adminView.style.display = 'none';

    if (tab === 'analyzer') {
        analyzerView.style.display = 'block';
        if (sidebar) sidebar.style.display = 'flex';
    } else if (tab === 'projects') {
        dbView.style.display = 'block';
        if (sidebar) sidebar.style.display = 'none';
        renderDbCards();
    } else if (tab === 'reports') {
        if (!reportsView) {
            createReportsView();
        }
        reportsView.style.display = 'block';
        if (sidebar) sidebar.style.display = 'none';
        renderReports();
    } else if (tab === 'saved') {
        if (savedView) savedView.style.display = 'block';
        if (sidebar) sidebar.style.display = 'none';
        renderSavedCards();
    } else if (tab === 'admin') {
        if (adminView) adminView.style.display = 'block';
        if (sidebar) sidebar.style.display = 'none';
        renderAdminList();
    }
}

// ============================================
// REPORTS VIEW
// ============================================
function createReportsView() {
    const view = document.createElement('div');
    view.id = 'reportsView';
    view.className = 'db-view';
    view.style.display = 'none';
    view.innerHTML = `
        <div class="db-topbar">
            <div class="db-topbar-left">
                <h2>Project Reports & Insights</h2>
                <span class="db-count" id="reportCount"></span>
            </div>
        </div>
        <div class="report-summary" style="margin-bottom:1.5rem;">
            <div style="font-size:0.95rem;color:var(--text-secondary);line-height:1.6;">
                Consolidated analytics across the Indian government project database. This section aggregates
                portfolio-level risk, budget, and completion insights across all monitored projects.
            </div>
        </div>
        <div class="db-grid" id="reportGrid"></div>
    `;
    // Place after db view in main content
    const content = document.querySelector('.analyzer-view');
    content.parentNode.insertBefore(view, content.nextSibling);
    reportsView = view;
}

function renderReports() {
    const view = document.getElementById('reportsView');
    if (!view) return;
    const countEl = view.querySelector('#reportCount');
    if (countEl) countEl.textContent = INDIA_PROJECT_DB.length + ' projects';

    const grid = view.querySelector('#reportGrid');
    if (!grid) return;

    const totalBudget = INDIA_PROJECT_DB.reduce((s, p) => s + p.budget, 0);
    const totalSpent = INDIA_PROJECT_DB.reduce((s, p) => s + p.spent, 0);
    const avgRisk = Math.round(INDIA_PROJECT_DB.reduce((s, p) => s + p.risk, 0) / INDIA_PROJECT_DB.length);
    const onTrack = INDIA_PROJECT_DB.filter(p => p.status === 'on-track' || p.status === 'completed').length;
    const attention = INDIA_PROJECT_DB.filter(p => p.status === 'attention').length;
    const highRisk = INDIA_PROJECT_DB.filter(p => p.status === 'high-risk').length;

    grid.innerHTML = `
        <div class="section-card" style="grid-column:1/-1;">
            <div class="section-header">
                <h3>Portfolio Overview</h3>
                <span class="section-tag">Aggregate Data</span>
            </div>
            <div class="modal-stats" style="grid-template-columns:repeat(3,1fr);">
                <div class="modal-stat">
                    <div class="modal-stat-label">Total Budget</div>
                    <div class="modal-stat-value">${formatMoney(totalBudget)}</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat-label">Total Spent</div>
                    <div class="modal-stat-value">${formatMoney(totalSpent)}</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat-label">Average Risk</div>
                    <div class="modal-stat-value" style="color:${avgRisk > 60 ? 'var(--red)' : avgRisk > 40 ? 'var(--orange)' : 'var(--green)'}">${avgRisk}/100</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat-label">On Track / Done</div>
                    <div class="modal-stat-value" style="color:var(--green)">${onTrack}</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat-label">Needs Attention</div>
                    <div class="modal-stat-value" style="color:var(--orange)">${attention}</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat-label">High Risk</div>
                    <div class="modal-stat-value" style="color:var(--red)">${highRisk}</div>
                </div>
            </div>
        </div>

        <div class="section-card">
            <div class="section-header">
                <h3>Top Projects by Risk</h3>
            </div>
            <div class="comp-compact">
                ${[...INDIA_PROJECT_DB].sort((a, b) => b.risk - a.risk).slice(0, 8).map((p, i) => `
                    <div class="comp-item" style="cursor:pointer;border-radius:8px;padding:0.75rem;background:var(--bg-tertiary);margin-bottom:0.5rem;" onclick="openModal(${p.id})">
                        <div class="comp-rank">${i + 1}</div>
                        <div class="comp-info">
                            <div class="comp-name">${p.name}</div>
                            <div class="comp-meta">${p.category} | ${formatMoney(p.budget)}</div>
                        </div>
                        <div class="comp-risk ${getStatusClass(p.risk)}">${p.risk}</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="section-card">
            <div class="section-header">
                <h3>Budget Distribution by Category</h3>
            </div>
            <div class="comp-compact">
                ${Object.entries(categoryBreakdown()).map(([cat, amt], i) => {
                    const pct = (amt / totalBudget * 100).toFixed(1);
                    return `
                        <div style="padding:0.6rem 0;border-bottom:1px solid var(--border-light);">
                            <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:0.3rem;">
                                <span style="font-weight:700;">${cat}</span>
                                <span style="color:var(--text-muted);">${formatMoney(amt)} (${pct}%)</span>
                            </div>
                            <div class="db-progress-bar"><div class="db-progress-fill" style="width:${pct}%;background:${['var(--accent)','var(--green)','var(--orange)','var(--red)','var(--gold)','var(--blue)','var(--purple)','var(--cyan)','var(--pink)'][i % 9]}"></div></div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function categoryBreakdown() {
    const map = {};
    INDIA_PROJECT_DB.forEach(p => {
        map[p.category] = (map[p.category] || 0) + p.budget;
    });
    return map;
}

// ============================================
// DATABASE CARD RENDERING
// ============================================
function getStatusClass(riskVal) {
    if (riskVal <= 25) return 'low';
    if (riskVal <= 50) return 'medium';
    if (riskVal <= 75) return 'high';
    return 'critical';
}

function renderDbCards() {
    let list = [...INDIA_PROJECT_DB];

// Filter by category
    if (dbCurrentFilter !== 'all') {
        list = list.filter(p => p.type === dbCurrentFilter);
    }

    // Filter by state
    if (dbCurrentState !== 'all') {
        list = list.filter(p => projectMatchesState(p, dbCurrentState));
    }

    // Search
    const q = (dbSearch.value || '').toLowerCase().trim();
    if (q) {
        list = list.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q) ||
            (p.location || '').toLowerCase().includes(q) ||
            (p.category || '').toLowerCase().includes(q) ||
            (p.state || '').toLowerCase().includes(q)
        );
    }

    // Sort
    switch (dbCurrentSort) {
        case 'risk-desc': list.sort((a, b) => b.risk - a.risk); break;
        case 'risk-asc': list.sort((a, b) => a.risk - b.risk); break;
        case 'budget-desc': list.sort((a, b) => b.budget - a.budget); break;
        case 'completion-desc': list.sort((a, b) => b.completion - a.completion); break;
    }

    dbCount.textContent = list.length + ' projects';

    if (list.length === 0) {
        dbGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:3rem;">No projects found matching your criteria.</div>';
        return;
    }

dbGrid.innerHTML = list.map(p => `
        <div class="db-card risk-${getStatusClass(p.risk)}" onclick="openModal(${p.id})">
            <div class="db-card-top">
                <div class="db-card-heading">
                    <span class="db-card-icon">${typeIcon(p.type)}</span>
                    <div class="db-card-name">${p.name}</div>
                </div>
                <div class="db-card-risk ${getStatusClass(p.risk)}">${p.risk}</div>
            </div>
<div class="db-card-category">${typeIcon(p.type)} ${p.category}</div>
            ${p.state ? `<div class="db-card-state">&#128506; ${p.state}</div>` : ''}
            <div class="db-card-meta">
                <div class="db-meta-item">
                    <span class="db-meta-label">Budget</span>
                    <span class="db-meta-value">${formatMoney(p.budget)}</span>
                </div>
                <div class="db-meta-item">
                    <span class="db-meta-label">Timeline</span>
                    <span class="db-meta-value">${p.timeline} months</span>
                </div>
            </div>
            <div class="db-card-progress">
                <div class="db-progress-label">
                    <span>Completion</span>
                    <span>${p.completion}%</span>
                </div>
                <div class="db-progress-bar">
                    <div class="db-progress-fill" style="width:${p.completion}%;background:${p.completion > 70 ? 'var(--green)' : p.completion > 40 ? 'var(--orange)' : 'var(--red)'};"></div>
                </div>
            </div>
            <div class="db-card-footer">
                <span class="db-card-status ${p.status}">${p.status.replace('-', ' ').toUpperCase()}</span>
                <span class="db-card-link">${p.agency} →</span>
            </div>
        </div>
    `).join('');
}

// ============================================
// PROJECT DETAIL MODAL
// ============================================
function openModal(id) {
    const p = INDIA_PROJECT_DB.find(x => x.id === id);
    if (!p) return;
    modalContent.dataset.projectId = String(id);

    const risksHtml = (p.keyRisks || []).map(r => `
        <div class="modal-risk-item ${r.severity}">
            <span class="modal-risk-dot ${r.severity}"></span>
            <span>${r.text}</span>
        </div>
    `).join('');

    const swGrid = `
        <div class="modal-sw-grid">
            <div class="modal-sw-box strengths">
                <div class="modal-sw-title">&#9989; Strengths</div>
                <ul class="modal-sw-list">
                    ${(p.strengths || []).map(s => `<li>${s}</li>`).join('')}
                </ul>
            </div>
            <div class="modal-sw-box weaknesses">
                <div class="modal-sw-title">&#9888;&#65039; Weaknesses</div>
                <ul class="modal-sw-list">
                    ${(p.weaknesses || []).map(w => `<li>${w}</li>`).join('')}
                </ul>
            </div>
        </div>
    `;

    const lessonsHtml = (p.lessons || []).map(l => `
        <div class="modal-lesson">
            <span class="modal-lesson-icon">&#128161;</span>
            <span>${l}</span>
        </div>
    `).join('');

    const timelineHtml = (p.timeline_events || []).map(t => `
        <div class="timeline-item">
            <span class="timeline-dot ${t.status}"></span>
            <div class="timeline-title">${t.year} - ${t.title}</div>
            <div class="timeline-desc">${t.desc}</div>
        </div>
    `).join('');

    const contractorsHtml = (p.contractors || []).join(', ');

    modalContent.innerHTML = `
        <div class="modal-header">
<div class="modal-header-icon" style="background:var(--accent-bg);color:var(--accent);">
                ${typeIcon(p.type)}
            </div>
            <div class="modal-header-info">
                <h2>${p.name}</h2>
<div class="modal-subtitle">${p.agency} &middot; ${p.location} &middot; ${p.category}</div>
                <div class="modal-header-badges">
                    ${p.state ? `<span class="modal-badge" style="background:var(--accent-bg);color:var(--accent);">&#128506; ${p.state}</span>` : ''}
                    <span class="modal-badge ${p.status}" style="background:${p.status === 'on-track' ? 'var(--green-bg)' : p.status === 'high-risk' ? 'var(--red-bg)' : p.status === 'completed' ? 'var(--blue-bg)' : 'var(--orange-bg)'};color:${p.status === 'on-track' ? 'var(--green)' : p.status === 'high-risk' ? 'var(--red)' : p.status === 'completed' ? 'var(--blue)' : 'var(--orange)'};">${p.status.replace('-', ' ')}</span>
                    <span class="modal-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">${p.funding}</span>
                </div>
            </div>
        </div>

        <div class="modal-stats">
            <div class="modal-stat">
                <div class="modal-stat-label">Budget</div>
                <div class="modal-stat-value">${formatMoney(p.budget)}</div>
                <div class="modal-stat-sub">${p.spent ? formatMoney(p.spent) + ' spent' : ''}</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Risk Score</div>
                <div class="modal-stat-value" style="color:${p.risk > 60 ? 'var(--red)' : p.risk > 40 ? 'var(--orange)' : 'var(--green)'};">${p.risk}/100</div>
                <div class="modal-stat-sub">${p.risk <= 25 ? 'Low' : p.risk <= 50 ? 'Medium' : p.risk <= 75 ? 'High' : 'Critical'}</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Completion</div>
                <div class="modal-stat-value">${p.completion}%</div>
                <div class="modal-stat-sub">${p.startDate} - ${p.revisedDate || 'TBD'}</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Timeline</div>
                <div class="modal-stat-value">${p.timeline} mo</div>
                <div class="modal-stat-sub">${p.elapsed} elapsed</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Workforce</div>
                <div class="modal-stat-value">${p.workforce ? p.workforce.toLocaleString() : '--'}</div>
                <div class="modal-stat-sub">${contractorsHtml.length > 30 ? contractorsHtml.substring(0, 30) + '...' : contractorsHtml}</div>
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128172;</span> Project Description</div>
            <p style="font-size:0.82rem;color:var(--text-secondary);line-height:1.6;">${p.description}</p>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#9888;&#65039;</span> Key Risks</div>
            <div class="modal-risks">
                ${risksHtml}
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#129504;</span> Strengths & Weaknesses</div>
            ${swGrid}
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128197;</span> Project Timeline</div>
            <div class="modal-timeline">
                ${timelineHtml}
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128161;</span> Lessons Learned</div>
            <div class="modal-lessons">
                ${lessonsHtml}
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128202;</span> Risk Radar</div>
            <div class="modal-chart-box" style="height:320px;">
                <h4>Risk Factor Breakdown</h4>
                <canvas id="modalRiskRadar" style="width:100%;height:260px;"></canvas>
            </div>
        </div>
    `;

    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Build radar chart
    setTimeout(() => buildModalRadar(p), 50);
}

function buildModalRadar(p) {
    const ctx = document.getElementById('modalRiskRadar');
    if (!ctx) return;
    if (modalChart) modalChart.destroy();

    const isDark = currentTheme === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const budgetRisk = Math.min(100, Math.max(0, (p.budget - p.spent) / p.budget * 0));  // placeholder until we compute
    // Compute a realistic radar from project data
    let bRisk = 0;
    if (p.spent > 0 && p.budget > 0) {
        const util = p.spent / p.budget;
        const expected = p.completion / 100;
        const variance = util - expected;
        bRisk = Math.min(100, Math.max(0, variance * 250));
    }
    if (p.spent === 0) bRisk = 50;

    const sRisk = Math.min(100, Math.max(0, (100 - p.completion) * 0.5 + (p.elapsed / p.timeline) * 50));
    const rRisk = p.risk > 60 ? 75 : p.risk > 40 ? 50 : 25;
    const tRisk = Math.min(100, Math.max(0, 100 - (p.completion / (p.timeline > 0 ? (p.elapsed / p.timeline) : 1))));
    const wRisk = p.workforce > 5000 ? 20 : p.workforce > 2000 ? 45 : p.workforce > 500 ? 65 : 85;

    modalChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Budget', 'Schedule', 'Resources', 'Timeline', 'Workforce'],
            datasets: [{
                data: [bRisk, sRisk, rRisk, tRisk, wRisk],
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderColor: 'rgba(239, 68, 68, 0.7)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(239, 68, 68, 1)',
                pointRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { display: false },
                    grid: { color: gridColor },
                    pointLabels: { color: textColor, font: { size: 11, weight: '600' } }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function closeModal() {
    modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
    if (modalChart) { modalChart.destroy(); modalChart = null; }
}

// ============================================
// THEME TOGGLE
// ============================================
function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('govrisk-theme', currentTheme);
    // Rebuild charts with new theme colors
    if (resultsDashboard.style.display !== 'none') {
        const data = gatherFormData();
        const risk = computeRisk(data);
        buildCharts(data, risk);
    }
    // Rebuild modal radar if open
    if (modalOverlay.classList.contains('open')) {
        const id = modalContent.dataset.projectId;
        if (id) {
            const proj = INDIA_PROJECT_DB.find(x => String(x.id) === id);
            if (proj) buildModalRadar(proj);
        }
    }
}

// ============================================
// CURRENCY
// ============================================
function updateCurrencySymbols(code) {
    const sym = CURRENCY_SYMBOLS[code] || code;
    document.getElementById('currencySymbol1').textContent = sym;
    document.getElementById('currencySymbol2').textContent = sym;
}

function convertCurrency(amountINR) {
    const rate = CURRENCY_RATES[currentCurrency] || 1;
    return amountINR / rate;
}

function formatMoney(amount) {
    const sym = CURRENCY_SYMBOLS[currentCurrency] || '';
    const converted = convertCurrency(amount);
    if (converted >= 1e12) return sym + (converted / 1e12).toFixed(1) + 'T';
    if (converted >= 1e9) return sym + (converted / 1e9).toFixed(1) + 'B';
    if (converted >= 1e7) return sym + (converted / 1e7).toFixed(1) + 'Cr';
    if (converted >= 1e5) return sym + (converted / 1e5).toFixed(1) + 'L';
    return sym + converted.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ============================================
// FORM DATA GATHERING
// ============================================
function gatherFormData() {
    return {
        name: document.getElementById('projectName').value,
        description: document.getElementById('projectDesc').value,
        type: document.getElementById('projectType').value,
        totalBudget: parseFloat(document.getElementById('totalExpenditure').value),
        spentToDate: parseFloat(document.getElementById('spentToDate').value),
        fundSource: document.getElementById('fundSource').value,
        completionRate: parseFloat(document.getElementById('completionRate').value),
        buildTime: parseFloat(document.getElementById('buildTime').value),
        milestonesCompleted: parseInt(document.getElementById('milestonesCompleted').value),
        totalMilestones: parseInt(document.getElementById('totalMilestones').value),
        startDate: document.getElementById('projectStartDate').value,
        workforce: parseInt(document.getElementById('workforce').value),
        resources: document.getElementById('resources').value,
        contractorCount: parseInt(document.getElementById('contractorCount').value) || 1,
    };
}

// ============================================
// NLP DESCRIPTION ANALYSIS
// ============================================
function analyzeDescription(text) {
    if (!text || text.trim().length === 0) {
        return { riskScore: 0, keywords: [], insights: ['No description provided. Add a project description for deeper AI analysis.'] };
    }
    const lower = text.toLowerCase();
    let riskAdd = 0;
    const found = [];
    const insights = [];

    RISK_KEYWORDS.high.forEach(kw => {
        if (lower.includes(kw)) {
            riskAdd += 6;
            found.push(kw);
            insights.push('Risk keyword detected: "' + kw + '" - commonly associated with project delays/failures in Indian projects.');
        }
    });

    RISK_KEYWORDS.medium.forEach(kw => {
        if (lower.includes(kw)) {
            riskAdd += 3;
            found.push(kw);
        }
    });

    RISK_KEYWORDS.positive.forEach(kw => {
        if (lower.includes(kw)) {
            riskAdd -= 4;
            found.push(kw);
            insights.push('Positive indicator: "' + kw + '" - suggests favorable project conditions.');
        }
    });

    // Length analysis
    if (text.length > 200) {
        insights.push('Detailed description provided - enables more accurate risk prediction.');
    }

    // Type-specific risks
    const typeRisks = {
        infrastructure: ['Land acquisition challenges', 'Environmental clearance requirements', 'Terrain complexity common in Indian infrastructure'],
        railway: ['Multi-agency coordination required (Railways, State, Local)', 'Right-of-way disputes typical', 'Long gestation periods common'],
        water: ['Interstate water sharing issues', 'Seasonal variation impacts', 'Rural last-mile connectivity challenges'],
        energy: ['Regulatory clearances required', 'Grid connectivity dependencies', 'Fuel supply chain considerations'],
        housing: ['Urban planning approvals', 'Slum rehabilitation complexity', 'Utility infrastructure dependencies'],
        defense: ['Security clearance requirements', 'Strategic sensitivity', 'Import dependency for components'],
        it: ['Technology obsolescence risk', 'Cybersecurity requirements', 'Vendor lock-in potential'],
        health: ['Multi-specialty coordination', 'Equipment procurement delays', 'Staffing challenges in tier-2/3 cities'],
        education: ['Academic calendar alignment', 'Faculty recruitment timelines', 'Accreditation requirements'],
    };

    (typeRisks[document.getElementById('projectType').value] || []).forEach(r => {
        insights.push(r);
    });

    return { riskScore: Math.max(-15, Math.min(30, riskAdd)), keywords: found, insights: insights.slice(0, 6) };
}

// ============================================
// RISK CALCULATION ENGINE
// ============================================
function computeRisk(data) {
    let score = 0;
    const factors = {};

    // 1. Budget overrun (30 pts max)
    const budgetUtil = data.spentToDate / data.totalBudget;
    const expectedSpend = data.completionRate / 100;
    const budgetVar = budgetUtil - expectedSpend;
    factors.budgetVariance = budgetVar;

    if (budgetVar > 0.3) score += 30;
    else if (budgetVar > 0.2) score += 24;
    else if (budgetVar > 0.1) score += 16;
    else if (budgetVar > 0.05) score += 10;
    else if (budgetVar > 0) score += 5;
    else score += 1;

    // 2. Schedule risk (25 pts max)
    const milestoneProg = data.totalMilestones > 0 ? data.milestonesCompleted / data.totalMilestones : 0;
    const schedVar = Math.abs(data.completionRate / 100 - milestoneProg);
    factors.scheduleRisk = schedVar;

    if (schedVar > 0.3) score += 25;
    else if (schedVar > 0.2) score += 18;
    else if (schedVar > 0.1) score += 12;
    else if (schedVar > 0.05) score += 6;
    else score += 2;

    // 3. Resource risk (20 pts max)
    const resMap = { scarce: 20, limited: 12, adequate: 4, abundant: 1 };
    score += resMap[data.resources] || 10;
    factors.resourceLevel = data.resources;

    // 4. Workforce density (10 pts max)
    const workerDensity = data.workforce / (data.totalBudget / 10000000);
    factors.workerDensity = workerDensity;
    if (workerDensity < 10) score += 10;
    else if (workerDensity < 20) score += 6;
    else if (workerDensity > 80) score += 8;
    else score += 2;

    // 5. Timeline pressure (10 pts max)
    const remainingTime = data.buildTime * (1 - data.completionRate / 100);
    const remainingMiles = data.totalMilestones - data.milestonesCompleted;
    const timePerMilestone = remainingMiles > 0 ? remainingTime / remainingMiles : 999;
    factors.timePressure = timePerMilestone;

    if (timePerMilestone < 0.3) score += 10;
    else if (timePerMilestone < 0.5) score += 7;
    else if (timePerMilestone < 1) score += 4;
    else score += 1;

    // 6. Contractor complexity (5 pts max)
    if (data.contractorCount > 5) score += 5;
    else if (data.contractorCount > 3) score += 3;
    else score += 1;

    // 7. Fund source reliability (5 pts max)
    const fundRisk = { worldbank: 1, central: 2, internal: 2, ppp: 4, state: 5 };
    score += fundRisk[data.fundSource] || 3;

    // 8. NLP description analysis
    const descAnalysis = analyzeDescription(data.description);
    score += descAnalysis.riskScore;

    // 9. Benchmark against similar Indian projects
    const benchmark = findBenchmark(data);
    if (benchmark) {
        const benchDiff = (score - benchmark.risk) / benchmark.risk;
        factors.benchmarkDeviation = benchDiff;
    }

    score = Math.max(1, Math.min(100, Math.round(score)));

    // Completion probability
    let compProb = 100 - score;
    // Adjust based on current progress momentum
    const progressMomentum = data.completionRate > 50 ? 5 : data.completionRate > 25 ? 0 : -5;
    compProb += progressMomentum;
    // Budget factor
    if (budgetVar > 0.15) compProb -= 10;
    if (budgetVar > 0.25) compProb -= 15;
    compProb = Math.max(3, Math.min(97, Math.round(compProb)));

    // Generate outputs
    const pros = generatePros(data, factors, score);
    const cons = generateCons(data, factors, score);
    const recommendations = generateRecs(data, factors, score, compProb);

    return {
        score,
        level: getLevel(score),
        compProb,
        pros,
        cons,
        recommendations,
        factors,
        descAnalysis,
        benchmark,
    };
}

function getLevel(s) {
    if (s <= 25) return 'low';
    if (s <= 50) return 'medium';
    if (s <= 75) return 'high';
    return 'critical';
}

function findBenchmark(data) {
    return INDIA_PROJECT_DB.find(p => p.type === data.type) || INDIA_PROJECT_DB[0];
}

// ============================================
// PROS / CONS / RECOMMENDATIONS GENERATORS
// ============================================
function generatePros(d, f, score) {
    const p = [];
    if (d.completionRate > 70) p.push('Project is well past the halfway mark with strong completion momentum');
    if (f.budgetVariance <= 0.05) p.push('Expenditure closely tracks project progress - excellent fiscal discipline');
    if (d.resources === 'abundant') p.push('Resource availability exceeds requirements - minimal bottleneck risk');
    if (d.resources === 'adequate') p.push('Resource levels meet project requirements');
    if (f.scheduleRisk < 0.05) p.push('Milestone completion rate is closely aligned with overall progress');
    if (score < 25) p.push('Overall risk profile is within acceptable government benchmarks');
    if (d.workforce > 200) p.push('Large workforce provides capacity for parallel execution');
    if (d.fundSource === 'central' || d.fundSource === 'worldbank') p.push('Strong funding source provides financial stability');
    if (d.completionRate > 40 && f.budgetVariance <= 0.1) p.push('Project has passed the critical early-stage risk window successfully');
    if (d.contractorCount <= 2) p.push('Fewer contractors reduces coordination complexity');
    if (p.length === 0) p.push('Project has government backing and sanctioned funding in place');
    return p.slice(0, 5);
}

function generateCons(d, f, score) {
    const c = [];
    if (f.budgetVariance > 0.25) c.push('Critical budget overrun - expenditure far exceeds completion progress');
    if (f.budgetVariance > 0.15) c.push('Significant budget overrun detected - spending acceleration is unsustainable');
    if (f.budgetVariance > 0.08) c.push('Moderate budget variance - early signs of cost escalation');
    if (d.resources === 'scarce') c.push('Critical resource shortage - severe delivery risk');
    if (d.resources === 'limited') c.push('Below-required resource availability - bottleneck risk');
    if (f.scheduleRisk > 0.25) c.push('Major schedule misalignment between milestones and completion');
    if (f.scheduleRisk > 0.15) c.push('Noticeable gap between milestone completion and overall progress');
    if (d.completionRate < 20 && f.budgetVariance > 0.1) c.push('Early-stage cost escalation - pattern resembles known stalled projects');
    if (f.timePressure < 0.4) c.push('Extremely tight remaining timeline per milestone');
    if (score > 70) c.push('Aggregate risk exceeds safety threshold - escalation to oversight committee advised');
    if (d.workforce < 50 && d.totalBudget > 1e10) c.push('Workforce may be insufficient for project scale');
    if (d.contractorCount > 5) c.push('High contractor count increases coordination and dispute risk');
    if (d.completionRate < 10) c.push('Project is in nascent stage - risk indicators require time to stabilize');
    if (c.length === 0) c.push('No critical weaknesses identified at current project stage');
    return c.slice(0, 6);
}

function generateRecs(d, f, score, prob) {
    const r = [];
    if (score > 75) r.push({ type: 'critical', icon: '\u26A0\uFE0F', text: 'IMMEDIATE ACTION: Form an empowered review committee. Consider temporary hold for comprehensive reassessment.' });
    if (f.budgetVariance > 0.2) r.push({ type: 'critical', icon: '\uD83D\uDCB0', text: 'Budget review mandatory. Current expenditure trajectory will exhaust funds before completion. Consider scope rationalization.' });
    if (d.resources === 'scarce' || d.resources === 'limited') r.push({ type: 'warning', icon: '\uD83D\uDCE6', text: 'Resource augmentation plan needed. Explore inter-departmental sharing or emergency procurement provisions.' });
    if (f.scheduleRisk > 0.15) r.push({ type: 'warning', icon: '\u23F0', text: 'Milestone targets need realignment with actual completion. Update revised project timeline with implementing agency.' });
    if (d.workforce < 50 && d.totalBudget > 5e9) r.push({ type: 'info', icon: '\uD83D\uDC65', text: 'Consider workforce augmentation to match project scale. Benchmark against similar completed projects.' });
    if (prob < 40) r.push({ type: 'critical', icon: '\uD83D\uDCCA', text: 'Completion probability critically low. Recommend phased completion approach with prioritized deliverables.' });
    else if (prob < 60) r.push({ type: 'warning', icon: '\uD83D\uDCCA', text: 'Moderate completion risk. Implement bi-weekly progress reviews and establish early warning triggers.' });
    if (score <= 30) r.push({ type: 'success', icon: '\u2705', text: 'Project is performing well within benchmarks. Maintain current governance framework with quarterly reviews.' });
    if (d.fundSource === 'ppp') r.push({ type: 'info', icon: '\uD83E\uDD1D', text: 'PPP project: Ensure concession agreement milestones are aligned and availability payments are structured correctly.' });
    r.push({ type: 'info', icon: '\uD83D\uDCCB', text: 'File updated Project Implementation Report (PIR) with the monitoring division for continued oversight.' });
    return r.slice(0, 5);
}

// ============================================
// FORM SUBMIT
// ============================================
function handleSubmit(e) {
    e.preventDefault();
    const data = gatherFormData();
    const risk = computeRisk(data);
    lastAnalysis = { data, risk };

    emptyState.style.display = 'none';
    resultsDashboard.style.display = 'flex';

    updateGauge(risk.score);
    updateCompletion(risk.compProb);
    updateVerdict(risk);
    updateProsCons(risk);
    updateComparison(data, risk);
    updateDescInsights(risk.descAnalysis);
    updateRecs(risk.recommendations);
    updateLiveMetrics(data, risk);
    buildCharts(data, risk);
}

// ============================================
// UI UPDATES
// ============================================
function updateGauge(score) {
    const num = document.getElementById('gaugeNum');
    const arc = document.getElementById('gaugeArc');
    const badge = document.getElementById('riskLevelBadge');

    num.textContent = score;

    // Arc animation: total length ~251
    const offset = 251 - (251 * score / 100);
    arc.style.transition = 'stroke-dashoffset 1s ease';
    arc.setAttribute('stroke-dashoffset', offset);

    badge.textContent = getLevel(score).toUpperCase() + ' RISK';
    badge.className = 'risk-level-badge ' + getLevel(score);
}

function updateCompletion(prob) {
    const num = document.getElementById('compProbNum');
    const bar = document.getElementById('compProbBar');
    const desc = document.getElementById('compProbDesc');

    num.textContent = prob + '%';
    bar.style.width = prob + '%';
    bar.style.background = prob > 70 ? 'var(--green)' : prob > 45 ? 'var(--orange)' : 'var(--red)';

    if (prob > 75) desc.textContent = 'Strong likelihood of successful completion';
    else if (prob > 55) desc.textContent = 'Moderate - requires focused management';
    else if (prob > 35) desc.textContent = 'Significant risks to completion';
    else desc.textContent = 'Critical intervention required';
}

function updateVerdict(risk) {
    const icon = document.getElementById('verdictIcon');
    const text = document.getElementById('verdictText');
    const desc = document.getElementById('verdictDesc');
    const card = document.querySelector('.verdict-card');

    if (risk.score <= 25) {
        icon.textContent = '\u2705';
        text.textContent = 'On Track';
        text.style.color = 'var(--green)';
        desc.textContent = 'Project meets benchmark standards';
        card.style.borderLeftColor = 'var(--green)';
    } else if (risk.score <= 50) {
        icon.textContent = '\u26A0\uFE0F';
        text.textContent = 'Needs Attention';
        text.style.color = 'var(--orange)';
        desc.textContent = 'Some corrective actions needed';
        card.style.borderLeftColor = 'var(--orange)';
    } else if (risk.score <= 75) {
        icon.textContent = '\uD83D\uDEA8';
        text.textContent = 'High Risk';
        text.style.color = 'var(--red)';
        desc.textContent = 'Immediate management review advised';
        card.style.borderLeftColor = 'var(--red)';
    } else {
        icon.textContent = '\uD83D\uDEA8';
        text.textContent = 'Critical Alert';
        text.style.color = 'var(--red)';
        desc.textContent = 'Escalate to oversight committee';
        card.style.borderLeftColor = 'var(--red)';
    }
}

function updateProsCons(risk) {
    document.getElementById('prosList').innerHTML = risk.pros.map(p => '<li>' + p + '</li>').join('');
    document.getElementById('consList').innerHTML = risk.cons.map(c => '<li>' + c + '</li>').join('');
}

function updateDescInsights(descAnalysis) {
    document.getElementById('descInsights').innerHTML = descAnalysis.insights.map(i => '<li>' + i + '</li>').join('');
}

function updateComparison(data, risk) {
    const grid = document.getElementById('comparisonGrid');

    // Get similar projects from DB
    let similar = INDIA_PROJECT_DB.filter(p => p.type === data.type).slice(0, 4);
    if (similar.length < 4) {
        const extra = INDIA_PROJECT_DB.filter(p => p.type !== data.type && !similar.includes(p)).slice(0, 4 - similar.length);
        similar = similar.concat(extra);
    }

    // Add current project
    const allItems = [...similar.map(p => ({
        name: p.name,
        meta: p.category + ' | ' + formatMoney(p.budget),
        risk: p.risk,
        level: getLevel(p.risk),
        isUser: false,
    })), {
        name: data.name || 'Your Project',
        meta: getProjectTypeLabel(data.type) + ' | ' + formatMoney(data.totalBudget),
        risk: risk.score,
        level: risk.level,
        isUser: true,
    }];

    // Sort by risk
    allItems.sort((a, b) => a.risk - b.risk);

    grid.innerHTML = allItems.map((item, i) => `
        <div class="comp-item ${item.isUser ? 'you' : ''}">
            <div class="comp-rank">${i + 1}</div>
            <div class="comp-info">
                <div class="comp-name" title="${item.name}">${item.isUser ? '&#9733; ' + item.name : item.name}</div>
                <div class="comp-meta">${item.meta}</div>
            </div>
            <div class="comp-risk ${item.level}">${item.risk}</div>
        </div>
    `).join('');
}

function getProjectTypeLabel(type) {
    const labels = {
        infrastructure: 'Infrastructure', railway: 'Railway/Metro', water: 'Water/Irrigation',
        energy: 'Energy/Power', housing: 'Housing/Urban', defense: 'Defense',
        it: 'IT/Digital', health: 'Healthcare', education: 'Education', other: 'Other',
    };
    return labels[type] || 'Other';
}

function updateRecs(recs) {
    document.getElementById('recsList').innerHTML = recs.map(r =>
        `<div class="rec-item ${r.type}"><span class="rec-icon">${r.icon}</span><span>${r.text}</span></div>`
    ).join('');
}

function updateLiveMetrics(data, risk) {
    const burnRate = data.buildTime > 0 ? (data.spentToDate / (data.buildTime * (data.completionRate / 100 || 0.01))).toFixed(0) : '--';
    const scheduleVar = (data.completionRate / 100 - data.spentToDate / data.totalBudget).toFixed(2);
    const cpi = data.spentToDate > 0 ? ((data.completionRate / 100) / (data.spentToDate / data.totalBudget)).toFixed(2) : '--';
    const spi = data.totalMilestones > 0 ? ((data.milestonesCompleted / data.totalMilestones) / (data.completionRate / 100 || 0.01)).toFixed(2) : '--';
    const resUtil = { scarce: '35%', limited: '55%', adequate: '78%', abundant: '92%' }[data.resources] || '--';
    const eac = data.spentToDate / (data.completionRate / 100 || 0.01);
    const vac = data.totalBudget - eac;
    const tcpi = data.totalBudget !== eac ? ((data.totalBudget - data.spentToDate) / (data.totalBudget - eac)).toFixed(2) : '--';

    document.getElementById('lmBurn').textContent = formatMoney(parseFloat(burnRate || 0)) + '/mo';
    document.getElementById('lmSchedule').textContent = (scheduleVar > 0 ? '+' : '') + (scheduleVar * 100).toFixed(1) + '%';
    document.getElementById('lmSchedule').style.color = scheduleVar >= 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('lmCPI').textContent = cpi;
    document.getElementById('lmCPI').style.color = cpi >= 1 ? 'var(--green)' : cpi >= 0.85 ? 'var(--orange)' : 'var(--red)';
    document.getElementById('lmSPI').textContent = spi;
    document.getElementById('lmSPI').style.color = spi >= 1 ? 'var(--green)' : spi >= 0.85 ? 'var(--orange)' : 'var(--red)';
    document.getElementById('lmResource').textContent = resUtil;
    document.getElementById('lmEAC').textContent = formatMoney(eac);
    document.getElementById('lmVAC').textContent = (vac >= 0 ? '+' : '') + formatMoney(vac);
    document.getElementById('lmVAC').style.color = vac >= 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('lmTCPI').textContent = tcpi;
}

// ============================================
// CHARTS
// ============================================
function getChartColors() {
    const isDark = currentTheme === 'dark';
    return {
        grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        text: isDark ? '#94a3b8' : '#64748b',
        bg: isDark ? '#131b2e' : '#ffffff',
    };
}

function buildCharts(data, risk) {
    const cc = getChartColors();

    // Budget Chart
    const bCtx = document.getElementById('budgetChart').getContext('2d');
    if (budgetChart) budgetChart.destroy();
    budgetChart = new Chart(bCtx, {
        type: 'bar',
        data: {
            labels: ['Sanctioned', 'Spent', 'Remaining', 'Projected EAC'],
            datasets: [{
                data: [
                    data.totalBudget,
                    data.spentToDate,
                    Math.max(0, data.totalBudget - data.spentToDate),
                    data.spentToDate / (data.completionRate / 100 || 0.01)
                ],
                backgroundColor: [
                    'rgba(30, 64, 175, 0.8)',
                    risk.factors.budgetVariance > 0.15 ? 'rgba(220, 38, 38, 0.8)' : 'rgba(5, 150, 105, 0.8)',
                    'rgba(148, 163, 184, 0.4)',
                    'rgba(217, 119, 6, 0.7)',
                ],
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: cc.grid }, ticks: { color: cc.text, callback: v => formatMoney(v) } },
                x: { grid: { display: false }, ticks: { color: cc.text } }
            }
        }
    });

    // Radar Chart
    const rCtx = document.getElementById('riskRadar').getContext('2d');
    if (riskRadar) riskRadar.destroy();

    const bRisk = Math.min(100, Math.max(0, risk.factors.budgetVariance * 250));
    const sRisk = Math.min(100, risk.factors.scheduleRisk * 300);
    const rRisk = { scarce: 90, limited: 60, adequate: 25, abundant: 10 }[data.resources];
    const tRisk = Math.min(100, Math.max(0, (1 - Math.min(risk.factors.timePressure, 2)) * 50));
    const wRisk = risk.factors.workerDensity < 20 ? 70 : risk.factors.workerDensity > 60 ? 60 : 20;

    riskRadar = new Chart(rCtx, {
        type: 'radar',
        data: {
            labels: ['Budget', 'Schedule', 'Resources', 'Timeline', 'Workforce'],
            datasets: [{
                data: [bRisk, sRisk, rRisk, tRisk, wRisk],
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderColor: 'rgba(239, 68, 68, 0.7)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(239, 68, 68, 1)',
                pointRadius: 4,
            }]
        },
        options: {
            responsive: true,
            scales: {
                r: {
                    beginAtZero: true, max: 100,
                    ticks: { display: false },
                    grid: { color: cc.grid },
                    pointLabels: { color: cc.text, font: { size: 11, weight: '600' } }
                }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Timeline Projection Chart
    const tCtx = document.getElementById('timelineChart').getContext('2d');
    if (timelineChart) timelineChart.destroy();

    const months = Array.from({ length: data.buildTime + 1 }, (_, i) => i);
    const idealProgress = months.map(m => Math.min(100, (m / data.buildTime) * 100));
    const projectedProgress = months.map(m => {
        if (m <= data.buildTime * (data.completionRate / 100)) {
            return Math.min(100, (data.completionRate / (data.completionRate / 100 * data.buildTime)) * m);
        }
        const rate = data.completionRate / Math.max(1, data.buildTime * (data.completionRate / 100));
        return Math.min(100, data.completionRate + rate * (m - data.buildTime * (data.completionRate / 100)));
    });

    timelineChart = new Chart(tCtx, {
        type: 'line',
        data: {
            labels: months.map(m => m % 12 === 0 ? (m / 12) + 'yr' : ''),
            datasets: [
                {
                    label: 'Ideal',
                    data: idealProgress,
                    borderColor: 'rgba(148, 163, 184, 0.6)',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                },
                {
                    label: 'Projected',
                    data: projectedProgress,
                    borderColor: 'rgba(37, 99, 235, 0.8)',
                    backgroundColor: 'rgba(37, 99, 235, 0.08)',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.3,
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    min: 0, max: 100,
                    grid: { color: cc.grid },
                    ticks: { color: cc.text, callback: v => v + '%' }
                },
                x: { grid: { display: false }, ticks: { color: cc.text, maxRotation: 0 } }
            },
            plugins: {
                legend: { labels: { color: cc.text, usePointStyle: true, pointStyle: 'line' } }
            }
}
    });
}

// ============================================
// SAVED PROJECTS (per-user, server database)
// ============================================
async function refreshSaved() {
    try {
        savedProjects = await api('/api/saved');
    } catch (e) {
        showToast('Could not load saved projects: ' + e.message);
    }
    renderSavedCards();
}

function saveCurrentAnalysis() {
    if (!lastAnalysis || !lastAnalysis.data) {
        showToast('Run an analysis first, then save it.');
        handleTabSwitch('analyzer');
        return;
    }
    const { data, risk } = lastAnalysis;
    const snapshot = {
        type: data.type,
        project: {
            name: data.name,
            type: data.type,
            description: data.description,
            totalBudget: data.totalBudget,
            spentToDate: data.spentToDate,
            fundSource: data.fundSource,
            completionRate: data.completionRate,
            buildTime: data.buildTime,
            milestonesCompleted: data.milestonesCompleted,
            totalMilestones: data.totalMilestones,
            startDate: data.startDate,
            workforce: data.workforce,
            resources: data.resources,
            contractorCount: data.contractorCount,
        },
        output: {
            score: risk.score,
            level: risk.level,
            compProb: risk.compProb,
            pros: risk.pros,
            cons: risk.cons,
            insights: risk.descAnalysis ? risk.descAnalysis.insights : [],
            recommendations: risk.recommendations,
            factors: risk.factors,
        },
    };
    api('/api/saved', { method: 'POST', body: snapshot })
        .then(() => {
            refreshSaved();
            showToast('Analysis saved to your account.');
        })
        .catch(err => showToast('Save failed: ' + err.message));
}

function formatSavedDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function renderSavedCards() {
    if (savedCount) savedCount.textContent = savedProjects.length + ' saved';
    if (!savedGrid) return;
    const list = savedProjects;

    if (list.length === 0) {
        savedGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:3rem;">' +
            'No saved projects yet. Analyze a project and click \u201CSave to Database\u201D to keep its inputs and outputs here.</div>';
        return;
    }

    savedGrid.innerHTML = list.map(s => `
        <div class="db-card saved-card">
            <div class="db-card-top">
                <div class="db-card-heading">
                    <span class="db-card-icon">${typeIcon(s.type)}</span>
                    <div class="db-card-name">${escapeHtml(s.project.name)}</div>
                </div>
                <div class="db-card-risk ${getStatusClass(s.output.score)}">${s.output.score}</div>
            </div>
            <div class="db-card-category">${typeIcon(s.type)} ${getProjectTypeLabel(s.type)}</div>
            <div class="db-card-state saved-date">&#128337; ${formatSavedDate(s.savedAt)}</div>
            <div class="db-card-meta">
                <div class="db-meta-item">
                    <span class="db-meta-label">Budget</span>
                    <span class="db-meta-value">${formatMoney(s.project.totalBudget)}</span>
                </div>
                <div class="db-meta-item">
                    <span class="db-meta-label">Completion Prob.</span>
                    <span class="db-meta-value">${s.output.compProb}%</span>
                </div>
            </div>
            <div class="db-card-progress">
                <div class="db-progress-label">
                    <span>${s.output.level.toUpperCase()} RISK</span>
                    <span>${s.output.compProb}%</span>
                </div>
                <div class="db-progress-bar">
                    <div class="db-progress-fill" style="width:${s.output.compProb}%;background:${s.output.compProb > 70 ? 'var(--green)' : s.output.compProb > 45 ? 'var(--orange)' : 'var(--red)'};"></div>
                </div>
            </div>
            <div class="db-card-footer saved-footer">
                <button class="mini-btn" onclick="viewSaved(${s.id})">View</button>
                <button class="mini-btn" onclick="exportSaved(${s.id})">Export</button>
                <button class="mini-btn danger" onclick="deleteSaved(${s.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

function viewSaved(id) {
    const s = savedProjects.find(x => x.id === id);
    if (!s) return;
    modalContent.dataset.projectId = 'saved-' + s.id;
    renderSavedDetail(s);
    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

async function deleteSaved(id) {
    if (!confirm('Delete this saved project?')) return;
    try {
        await api('/api/saved/' + id, { method: 'DELETE' });
        savedProjects = savedProjects.filter(x => x.id !== id);
        renderSavedCards();
        showToast('Saved project deleted.');
    } catch (e) {
        showToast('Delete failed: ' + e.message);
    }
}

async function clearSaved() {
    if (!confirm('Delete all saved projects? This cannot be undone.')) return;
    try {
        await api('/api/saved', { method: 'DELETE' });
        savedProjects = [];
        renderSavedCards();
        showToast('All saved projects cleared.');
    } catch (e) {
        showToast('Clear failed: ' + e.message);
    }
}

function exportSaved(id) {
    const list = id ? savedProjects.filter(x => x.id === id) : savedProjects;
    if (list.length === 0) {
        showToast('Nothing to export.');
        return;
    }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'govrisk-saved-projects.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    showToast('Saved projects exported as JSON.');
}

function renderSavedDetail(s) {
    const input = s.project;
    const out = s.output;

    const rows = [
        ['Project Name', input.name],
        ['Project Type', getProjectTypeLabel(input.type)],
        ['Description', input.description || '—'],
        ['Total Budget', formatMoney(input.totalBudget)],
        ['Spent to Date', formatMoney(input.spentToDate)],
        ['Funding Source', (input.fundSource || '').charAt(0).toUpperCase() + (input.fundSource || '').slice(1)],
        ['Completion Rate', input.completionRate + '%'],
        ['Build Time', input.buildTime + ' months'],
        ['Milestones', input.milestonesCompleted + ' / ' + input.totalMilestones],
        ['Start Date', input.startDate || '—'],
        ['Workforce', input.workforce],
        ['Resources', (input.resources || '').charAt(0).toUpperCase() + (input.resources || '').slice(1)],
        ['Contractors', input.contractorCount],
    ];

    const rowHtml = rows.map(([k, v]) => `
        <div class="saved-detail-row"><span class="saved-detail-key">${k}</span><span class="saved-detail-val">${escapeHtml(v)}</span></div>
    `).join('');

    const levelColor = out.level === 'low' ? 'var(--green)' : out.level === 'medium' ? 'var(--orange)' : 'var(--red)';

    modalContent.innerHTML = `
        <div class="modal-header">
            <div class="modal-header-icon" style="background:var(--accent-bg);color:var(--accent);">${typeIcon(s.type)}</div>
            <div class="modal-header-info">
                <h2>${escapeHtml(input.name)}</h2>
                <div class="modal-subtitle">Saved ${formatSavedDate(s.savedAt)} &middot; ${getProjectTypeLabel(s.type)}</div>
                <div class="modal-header-badges">
                    <span class="modal-badge risk-level-badge ${out.level}" style="color:${levelColor};">${out.level.toUpperCase()} RISK</span>
                    <span class="modal-badge" style="background:var(--bg-tertiary);color:var(--text-secondary);">${out.score}/100</span>
                </div>
            </div>
        </div>

        <div class="modal-stats">
            <div class="modal-stat">
                <div class="modal-stat-label">Risk Score</div>
                <div class="modal-stat-value" style="color:${levelColor};">${out.score}</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Completion Probability</div>
                <div class="modal-stat-value">${out.compProb}%</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Budget</div>
                <div class="modal-stat-value">${formatMoney(input.totalBudget)}</div>
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128194;</span> Saved Inputs</div>
            <div class="saved-detail-table">${rowHtml}</div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#9989;</span> Strengths</div>
            <div class="modal-sw-box strengths">
                <ul class="modal-sw-list">${(out.pros || []).map(p => '<li>' + p + '</li>').join('')}</ul>
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#9888;&#65039;</span> Weaknesses</div>
            <div class="modal-sw-box weaknesses">
                <ul class="modal-sw-list">${(out.cons || []).map(c => '<li>' + c + '</li>').join('')}</ul>
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128161;</span> Description Insights</div>
            <div class="modal-lessons">${(out.insights || []).map(i =>
                '<div class="modal-lesson"><span class="modal-lesson-icon">&#128161;</span><span>' + i + '</span></div>'
            ).join('')}</div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title"><span class="ms-icon">&#128220;</span> Recommendations</div>
            <div class="recs-list">${(out.recommendations || []).map(r =>
                '<div class="rec-item ' + r.type + '"><span class="rec-icon">' + r.icon + '</span><span>' + r.text + '</span></div>'
            ).join('')}</div>
        </div>
    `;
}

// ============================================
// ADMIN - PROJECT DATABASE CONTROLS
// ============================================
function showAdminTab(user) {
    const tab = document.getElementById('adminTab');
    if (tab) tab.style.display = (user && user.role === 'admin') ? '' : 'none';
}

const ADMIN_TYPE_LABELS = {
    infrastructure: 'Infrastructure', railway: 'Railway/Metro', water: 'Water/Irrigation',
    energy: 'Energy/Power', housing: 'Housing/Urban', defense: 'Defense',
    it: 'IT/Digital', health: 'Healthcare', education: 'Education', other: 'Other',
};

function adminVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function adminNum(id) {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? 0 : v;
}

function adminInt(id) {
    const v = parseInt(document.getElementById(id).value, 10);
    return isNaN(v) ? 0 : v;
}

function adminLines(id) {
    return adminVal(id).split('\n').map(s => s.trim()).filter(Boolean);
}

function adminSet(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = (value == null) ? '' : String(value);
}

function adminResetForm() {
    editingProjectId = null;
    const ids = [
        'admName', 'admType', 'admStatus', 'admState', 'admLocation', 'admAgency', 'admFunding',
        'admBudget', 'admSpent', 'admRisk', 'admCompletion', 'admTimeline', 'admElapsed',
        'admWorkforce', 'admStartDate', 'admRevisedDate', 'admOriginalDeadline',
        'admContractors', 'admDescription', 'admKeyRisks', 'admStrengths', 'admWeaknesses',
        'admLessons', 'admTimelineEvents',
    ];
    ids.forEach(id => adminSet(id, ''));
    const title = document.getElementById('adminFormTitle');
    if (title) title.textContent = 'Add New Project';
    const cancelBtn = document.getElementById('adminCancelBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function adminBuildFromForm() {
    const keyRisks = adminLines('admKeyRisks').map(line => {
        const parts = line.split('|');
        const severity = parts.length > 1 ? parts[0].trim().toLowerCase() : 'medium';
        const text = parts.length > 1 ? parts.slice(1).join('|').trim() : line.trim();
        return {
            text,
            severity: ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'medium',
        };
    });
    let timelineEvents = [];
    const te = adminVal('admTimelineEvents');
    if (te) {
        try { timelineEvents = JSON.parse(te); } catch (e) { timelineEvents = []; }
    }
    const type = adminVal('admType') || 'other';
    return {
        id: editingProjectId !== null ? editingProjectId : null,
        name: adminVal('admName'),
        shortName: '',
        type,
        state: adminVal('admState'),
        budget: adminNum('admBudget'),
        spent: adminNum('admSpent'),
        risk: adminInt('admRisk'),
        completion: adminInt('admCompletion'),
        timeline: adminInt('admTimeline'),
        elapsed: adminInt('admElapsed'),
        category: ADMIN_TYPE_LABELS[type] || 'Other',
        status: adminVal('admStatus') || 'attention',
        agency: adminVal('admAgency'),
        location: adminVal('admLocation'),
        funding: adminVal('admFunding'),
        workforce: adminInt('admWorkforce'),
        contractors: adminLines('admContractors'),
        description: adminVal('admDescription'),
        startDate: adminVal('admStartDate'),
        revisedDate: adminVal('admRevisedDate'),
        originalDeadline: adminVal('admOriginalDeadline'),
        keyRisks,
        strengths: adminLines('admStrengths'),
        weaknesses: adminLines('admWeaknesses'),
        lessons: adminLines('admLessons'),
        timeline_events: timelineEvents,
    };
}

async function reloadProjects() {
    try {
        INDIA_PROJECT_DB = await loadProjectData();
    } catch (err) {
        showDataLoadError(err);
    }
    populateStateFilter();
    renderDbCards();
    renderAdminList();
}

async function adminSubmit() {
    const name = adminVal('admName');
    if (!name) {
        showToast('Project name is required.');
        return;
    }
    const wasEdit = editingProjectId !== null;
    const p = adminBuildFromForm();
    try {
        if (wasEdit) {
            await api('/api/projects/' + editingProjectId, { method: 'PUT', body: p });
        } else {
            await api('/api/projects', { method: 'POST', body: p });
        }
        await reloadProjects();
        adminResetForm();
        showToast(wasEdit ? 'Project updated.' : 'Project added to database.');
    } catch (err) {
        showToast('Save failed: ' + err.message);
    }
}

function renderAdminList() {
    if (!adminGrid) return;
    if (adminCount) adminCount.textContent = INDIA_PROJECT_DB.length + ' projects';
    if (INDIA_PROJECT_DB.length === 0) {
        adminGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:3rem;">No projects in the database yet. Add one above.</div>';
        return;
    }
    adminGrid.innerHTML = INDIA_PROJECT_DB.map(p => `
        <div class="db-card risk-${getStatusClass(p.risk)}">
            <div class="db-card-top">
                <div class="db-card-heading">
                    <span class="db-card-icon">${typeIcon(p.type)}</span>
                    <div class="db-card-name">${escapeHtml(p.name)}</div>
                </div>
                <div class="db-card-risk ${getStatusClass(p.risk)}">${p.risk}</div>
            </div>
            <div class="db-card-category">${typeIcon(p.type)} ${escapeHtml(p.category || '')}</div>
            ${p.state ? `<div class="db-card-state">&#128506; ${escapeHtml(p.state)}</div>` : ''}
            <div class="db-card-meta">
                <div class="db-meta-item">
                    <span class="db-meta-label">Budget</span>
                    <span class="db-meta-value">${formatMoney(p.budget)}</span>
                </div>
                <div class="db-meta-item">
                    <span class="db-meta-label">Timeline</span>
                    <span class="db-meta-value">${p.timeline} months</span>
                </div>
            </div>
            <div class="db-card-progress">
                <div class="db-progress-label">
                    <span>Completion</span>
                    <span>${p.completion}%</span>
                </div>
                <div class="db-progress-bar">
                    <div class="db-progress-fill" style="width:${p.completion}%;background:${p.completion > 70 ? 'var(--green)' : p.completion > 40 ? 'var(--orange)' : 'var(--red)'};"></div>
                </div>
            </div>
            <div class="db-card-footer">
                <span class="db-card-status ${p.status}">${p.status.replace('-', ' ').toUpperCase()}</span>
                <span class="admin-actions">
                    <button class="mini-btn" onclick="openModal(${p.id})">View</button>
                    <button class="mini-btn" onclick="adminEdit(${p.id})">Edit</button>
                    <button class="mini-btn danger" onclick="adminDelete(${p.id})">Delete</button>
                </span>
            </div>
        </div>
    `).join('');
}

function adminEdit(id) {
    const p = INDIA_PROJECT_DB.find(x => x.id === id);
    if (!p) return;
    editingProjectId = id;
    adminView.style.display = 'block';
    adminSet('admName', p.name);
    adminSet('admType', p.type);
    adminSet('admStatus', p.status);
    adminSet('admState', p.state);
    adminSet('admLocation', p.location);
    adminSet('admAgency', p.agency);
    adminSet('admFunding', p.funding);
    adminSet('admBudget', p.budget);
    adminSet('admSpent', p.spent);
    adminSet('admRisk', p.risk);
    adminSet('admCompletion', p.completion);
    adminSet('admTimeline', p.timeline);
    adminSet('admElapsed', p.elapsed);
    adminSet('admWorkforce', p.workforce);
    adminSet('admStartDate', p.startDate);
    adminSet('admRevisedDate', p.revisedDate);
    adminSet('admOriginalDeadline', p.originalDeadline);
    adminSet('admContractors', (p.contractors || []).join('\n'));
    adminSet('admDescription', p.description);
    adminSet('admKeyRisks', (p.keyRisks || []).map(r => (r.severity ? r.severity + '|' : '') + (r.text || '')).join('\n'));
    adminSet('admStrengths', (p.strengths || []).join('\n'));
    adminSet('admWeaknesses', (p.weaknesses || []).join('\n'));
    adminSet('admLessons', (p.lessons || []).join('\n'));
    adminSet('admTimelineEvents', JSON.stringify(p.timeline_events || [], null, 2));
    const title = document.getElementById('adminFormTitle');
    if (title) title.textContent = 'Editing: ' + p.name;
    const cancelBtn = document.getElementById('adminCancelBtn');
    if (cancelBtn) cancelBtn.style.display = '';
    if (adminFormCard) adminFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function adminDelete(id) {
    const p = INDIA_PROJECT_DB.find(x => x.id === id);
    if (!p) return;
    if (!confirm('Delete "' + p.name + '"? This cannot be undone.')) return;
    try {
        await api('/api/projects/' + id, { method: 'DELETE' });
        if (editingProjectId === id) adminResetForm();
        await reloadProjects();
        showToast('Project deleted.');
    } catch (err) {
        showToast('Delete failed: ' + err.message);
    }
}

async function adminSeed() {
    if (!confirm('Re-import all projects from projects.json? Existing database projects will be replaced.')) return;
    try {
        INDIA_PROJECT_DB = await api('/api/projects/seed', { method: 'POST' });
        populateStateFilter();
        renderDbCards();
        renderAdminList();
        showToast('Project database reset from seed.');
    } catch (err) {
        showToast('Re-seed failed: ' + err.message);
    }
}

let toastTimer = null;
function showToast(msg) {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
