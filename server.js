// ============================================================================
// GovRisk - Project Risk Intelligence Server
// Node.js built-in SQLite (node:sqlite) + auth. ZERO npm dependencies.
//
//  - User accounts (register / login / logout) with scrypt password hashing
//  - Session cookies stored in SQLite (govrisk.db)
//  - Projects database managed in SQLite, seeded from projects.json
//  - Per-user saved analyses
//  - Admin role can add / edit / delete / re-seed projects
//
// Default admin account (created on first run):  admin / admin123
// Usage: node server.js   (then open the printed URL)
// ============================================================================
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8765;
const DB_PATH = path.join(ROOT, 'govrisk.db');
const SEED_FILE = path.join(ROOT, 'projects.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'govrisk_session';

// ----------------------------------------------------------------------------
// DATABASE
// ----------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT '',
    inputs TEXT NOT NULL,
    outputs TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'custom',
    ref_id INTEGER DEFAULT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
`);

// ----------------------------------------------------------------------------
// AUTH HELPERS
// ----------------------------------------------------------------------------
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createUser(username, email, password, role) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users (username,email,password_hash,password_salt,role,created_at) VALUES (?,?,?,?,?,?)')
        .run(username, email || '', hashPassword(password, salt), salt, role || 'viewer', new Date().toISOString());
}

function verifyPassword(password, salt, expectedHash) {
    const calc = Buffer.from(hashPassword(password, salt), 'hex');
    const exp = Buffer.from(expectedHash, 'hex');
    return calc.length === exp.length && crypto.timingSafeEqual(calc, exp);
}

function parseCookies(req) {
    const out = {};
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > -1) {
            let v = part.slice(i + 1).trim();
            try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
            out[part.slice(0, i).trim()] = v;
        }
    }
    return out;
}

function userFromRequest(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const row = db.prepare(
        `SELECT s.token, s.expires_at, u.id, u.username, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    ).get(token);
    if (!row) return null;
    if (Date.parse(row.expires_at) < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        return null;
    }
    return { id: row.id, username: row.username, email: row.email, role: row.role, token: row.token, expiresAt: row.expires_at };
}

function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)')
        .run(token, userId, new Date(Date.now() + SESSION_TTL_MS).toISOString());
    return token;
}

function sessionCookie(token, maxAge) {
    return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function publicUser(user) {
    return { id: user.id, username: user.username, email: user.email, role: user.role };
}

// ----------------------------------------------------------------------------
// PROJECT DATA
// ----------------------------------------------------------------------------
function loadProjects() {
    const rows = db.prepare('SELECT id, data FROM projects ORDER BY id').all();
    return rows.map(r => JSON.parse(r.data));
}

function insertProject(project, forceId) {
    const id = forceId != null ? Number(forceId) : (db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM projects').get().m + 1);
    project.id = id;
    db.prepare('INSERT INTO projects (id, data) VALUES (?, ?)').run(id, JSON.stringify(project));
    return id;
}

function seedProjects(reset) {
    if (reset) db.prepare('DELETE FROM projects').run();
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM projects').get();
    if (c > 0) return;
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch (e) { /* no seed file */ }
    for (const p of arr) {
        const project = (p && typeof p.id !== 'undefined') ? p : Object.assign({ id: arr.indexOf(p) + 1 }, p);
        insertProject(project, project.id);
    }
}

// ----------------------------------------------------------------------------
// PROGRESS TRACKER  (per-user snapshots + automatic risk flags)
// ----------------------------------------------------------------------------
function getLevelFor(s) {
    s = Number(s) || 0;
    if (s <= 25) return 'low';
    if (s <= 50) return 'medium';
    if (s <= 75) return 'high';
    return 'critical';
}

const STATUS_RANK = { 'on-track': 0, 'attention': 1, 'high-risk': 2, 'completed': 3 };

function snapshotForProject(p) {
    const spent = Number(p.spent) || 0;
    const budget = Number(p.budget) || 0;
    const risk = Number(p.risk) || 0;
    return {
        name: p.name,
        type: p.type || (p.category || '').toLowerCase() || '',
        category: p.category || '',
        status: p.status || 'attention',
        risk,
        score: risk,
        level: getLevelFor(risk),
        completion: Number(p.completion) || 0,
        budget,
        spent,
        timeline: Number(p.timeline) || 0,
        elapsed: Number(p.elapsed) || 0,
        spentPct: budget > 0 ? Math.round((spent / budget) * 10000) / 100 : 0,
    };
}

// Compare a snapshot against the previous one and produce human-readable flags.
function computeFlags(prevData, currData) {
    const flags = [];
    const riskOf = d => (d && d.risk != null ? d.risk : (d && d.score != null ? d.score : 0)) || 0;
    const compOf = d => (d && d.completion) || 0;
    const spentPctOf = d => (d && d.spentPct) || 0;
    const statusOf = d => (d && d.status) || '';
    const pRisk = riskOf(prevData);
    const cRisk = riskOf(currData);

    if (prevData) {
        const d = cRisk - pRisk;
        if (d >= 15) flags.push({ level: 'critical', text: 'Major risk surge (+' + d + ' points vs previous snapshot)' });
        else if (d >= 5) flags.push({ level: 'warning', text: 'Risk escalating (+' + d + ' points since last snapshot)' });
        else if (d <= -5) flags.push({ level: 'success', text: 'Risk improving (' + d + ' points since last snapshot)' });

        const pComp = compOf(prevData);
        const cComp = compOf(currData);
        if (cComp < pComp) {
            flags.push({ level: 'warning', text: 'Progress regression (completion dropped ' + pComp + '% -> ' + cComp + '%)' });
        } else if (cComp - pComp >= 10) {
            flags.push({ level: 'success', text: 'Strong progress (+' + (cComp - pComp) + '% completion since last snapshot)' });
        }

        const prevGap = spentPctOf(prevData) - pComp;
        const currGap = spentPctOf(currData) - cComp;
        if (currGap - prevGap >= 5) {
            flags.push({ level: 'warning', text: 'Budget overrun widening (spend now runs ' + Math.round(currGap) + ' pts ahead of completion)' });
        }

        const pr = STATUS_RANK[statusOf(prevData)];
        const cr = STATUS_RANK[statusOf(currData)];
        if (cr != null && pr != null) {
            if (cr > pr && statusOf(currData) !== 'completed') {
                flags.push({ level: 'warning', text: 'Status downgraded: ' + statusOf(prevData) + ' -> ' + statusOf(currData) });
            } else if (cr < pr) {
                flags.push({ level: 'success', text: 'Status improved: ' + statusOf(prevData) + ' -> ' + statusOf(currData) });
            }
        }
    }

    if (cRisk >= 75) flags.push({ level: 'critical', text: 'Critical risk threshold (score ' + cRisk + '/100) - escalate to oversight committee' });
    else if (cRisk >= 60) flags.push({ level: 'warning', text: 'High risk zone (score ' + cRisk + '/100) - monitor closely' });

    const gap = spentPctOf(currData) - compOf(currData);
    if (gap >= 15) flags.push({ level: 'warning', text: 'Budget overrun: spend is ' + Math.round(gap) + ' pts ahead of completion progress' });

    if (!prevData) flags.push({ level: 'info', text: 'Baseline snapshot recorded. Keep updating to detect emerging risks.' });
    return flags;
}

function lastSnapshot(userId, type, name) {
    const row = db.prepare(
        'SELECT data, created_at FROM tracking WHERE user_id = ? AND type = ? AND name = ? ORDER BY id DESC LIMIT 1'
    ).get(userId, type, name);
    return row ? JSON.parse(row.data) : null;
}

function insertSnapshot(userId, type, refId, name, data) {
    const prev = lastSnapshot(userId, type, name);
    const flags = computeFlags(prev, data);
    const info = db.prepare(
        'INSERT INTO tracking (user_id, type, ref_id, name, data, flags, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(userId, type, refId, name, JSON.stringify(data), JSON.stringify(flags), new Date().toISOString());
    return { id: Number(info.lastInsertRowid), flags };
}

// First time a user opens the tracker, seed a baseline snapshot of every real
// government project so progress (risk / completion / budget) can be compared.
function ensureProjectBaseline(userId) {
    const { c } = db.prepare("SELECT COUNT(*) AS c FROM tracking WHERE user_id = ? AND type = 'realworld'").get(userId);
    if (c > 0) return 0;
    let count = 0;
    for (const p of loadProjects()) {
        insertSnapshot(userId, 'realworld', p.id, p.name, snapshotForProject(p));
        count++;
    }
    return count;
}

// ----------------------------------------------------------------------------
// HTTP HELPERS
// ----------------------------------------------------------------------------
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}

function sendFile(res, filePath) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}

function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 8 * 1024 * 1024) {
                reject(new Error('Payload too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON body')); }
        });
        req.on('error', reject);
    });
}

// Files that can be served without auth
const PUBLIC_FILES = {
    '/login': 'login.html',
    '/register': 'register.html',
    '/app.js': 'app.js',
    '/styles.css': 'styles.css',
    '/auth.css': 'auth.css',
};

// ----------------------------------------------------------------------------
// REQUEST HANDLER
// ----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
    }
    const method = req.method;
    const user = userFromRequest(req);

    try {
        // ---------- Auth API ----------
        if (pathname === '/api/auth/me' && method === 'GET') {
            if (!user) return sendJson(res, 401, { error: 'Not signed in' });
            return sendJson(res, 200, { user: publicUser(user) });
        }

        if (pathname === '/api/auth/login' && method === 'POST') {
            const body = await readBody(req);
            const username = String(body.username || '').trim();
            const password = String(body.password || '');
            const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
            if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
                return sendJson(res, 401, { error: 'Invalid username or password' });
            }
            const token = createSession(row.id);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)) });
            return res.end(JSON.stringify({ user: { id: row.id, username: row.username, email: row.email, role: row.role } }));
        }

        if (pathname === '/api/auth/register' && method === 'POST') {
            const body = await readBody(req);
            const username = String(body.username || '').trim();
            const email = String(body.email || '').trim();
            const password = String(body.password || '');
            if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
                return sendJson(res, 400, { error: 'Username must be 3-30 characters (letters, numbers, _ . -)' });
            }
            if (password.length < 6) return sendJson(res, 400, { error: 'Password must be at least 6 characters' });
            if (email && !/.+@.+\..+/.test(email)) return sendJson(res, 400, { error: 'Enter a valid email or leave blank' });
            if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
                return sendJson(res, 409, { error: 'Username already taken' });
            }
            createUser(username, email, password, 'viewer');
            const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
            const token = createSession(row.id);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)) });
            return res.end(JSON.stringify({ user: { id: row.id, username: row.username, email: row.email, role: row.role } }));
        }

        if (pathname === '/api/auth/logout' && method === 'POST') {
            if (user) db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie('', 0) });
            return res.end('{"ok":true}');
        }

        // ---------- Projects API (auth required) ----------
        if (pathname === '/api/projects' && method === 'GET') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            return sendJson(res, 200, loadProjects());
        }

        if (pathname === '/api/projects' && method === 'POST') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
            const body = await readBody(req);
            const project = body.project && typeof body.project === 'object' ? body.project : body;
            if (!project || !project.name) return sendJson(res, 400, { error: 'Project name is required' });
            delete project.id;
            const id = insertProject(project, null);
            const saved = JSON.parse(db.prepare('SELECT data FROM projects WHERE id = ?').get(id).data);
            return sendJson(res, 201, { project: saved });
        }

        if (pathname === '/api/projects/seed' && method === 'POST') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
            seedProjects(true);
            return sendJson(res, 200, loadProjects());
        }

        let m;
        if ((m = pathname.match(/^\/api\/projects\/(\d+)$/))) {
            const id = Number(m[1]);
            if (method === 'GET') {
                if (!user) return sendJson(res, 401, { error: 'Sign in required' });
                const row = db.prepare('SELECT data FROM projects WHERE id = ?').get(id);
                if (!row) return sendJson(res, 404, { error: 'Project not found' });
                return sendJson(res, 200, JSON.parse(row.data));
            }
            if (method === 'PUT') {
                if (!user) return sendJson(res, 401, { error: 'Sign in required' });
                if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
                if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) {
                    return sendJson(res, 404, { error: 'Project not found' });
                }
                let body;
                try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
                const project = Object.assign({ id }, body.project && typeof body.project === 'object' ? body.project : body);
                if (!project.name) return sendJson(res, 400, { error: 'Project name is required' });
                db.prepare('UPDATE projects SET data = ? WHERE id = ?').run(JSON.stringify(project), id);
                return sendJson(res, 200, { project });
            }
            if (method === 'DELETE') {
                if (!user) return sendJson(res, 401, { error: 'Sign in required' });
                if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
                const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
                if (info.changes === 0) return sendJson(res, 404, { error: 'Project not found' });
                return sendJson(res, 200, { ok: true });
            }
        }

        // ---------- Saved analyses API (per user) ----------
        if (pathname === '/api/saved' && method === 'GET') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            const rows = db.prepare('SELECT * FROM saved_projects WHERE user_id = ? ORDER BY id DESC').all(user.id);
            return sendJson(res, 200, rows.map(r => ({
                id: r.id,
                savedAt: r.created_at,
                type: r.type,
                project: JSON.parse(r.inputs),
                output: JSON.parse(r.outputs),
            })));
        }

        if (pathname === '/api/saved' && method === 'POST') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            const body = await readBody(req);
            const project = body.project;
            const output = body.output;
            if (!project || !project.name) return sendJson(res, 400, { error: 'Project data is invalid' });
            const info = db.prepare('INSERT INTO saved_projects (user_id,name,type,inputs,outputs,created_at) VALUES (?,?,?,?,?,?)')
                .run(user.id, project.name, body.type || project.type || '', JSON.stringify(project), JSON.stringify(output || {}), new Date().toISOString());
            return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (pathname === '/api/saved' && method === 'DELETE') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            db.prepare('DELETE FROM saved_projects WHERE user_id = ?').run(user.id);
            return sendJson(res, 200, { ok: true });
        }

        if ((m = pathname.match(/^\/api\/saved\/(\d+)$/))) {
            const id = Number(m[1]);
            if (method === 'DELETE') {
                if (!user) return sendJson(res, 401, { error: 'Sign in required' });
                const info = db.prepare('DELETE FROM saved_projects WHERE id = ? AND user_id = ?').run(id, user.id);
                if (info.changes === 0) return sendJson(res, 404, { error: 'Saved project not found' });
                return sendJson(res, 200, { ok: true });
            }
        }

        // ---------- Progress tracker API (per user) ----------
        if (pathname === '/api/tracking' && method === 'GET') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            ensureProjectBaseline(user.id);
            const rows = db.prepare('SELECT * FROM tracking WHERE user_id = ? ORDER BY name, created_at').all(user.id);
            return sendJson(res, 200, rows.map(r => ({
                id: r.id,
                type: r.type,
                refId: r.ref_id,
                name: r.name,
                data: JSON.parse(r.data),
                flags: JSON.parse(r.flags),
                trackedAt: r.created_at,
            })));
        }

        if (pathname === '/api/tracking' && method === 'POST') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            let body;
            try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
            const name = String(body.name || '').trim();
            const type = body.type === 'realworld' ? 'realworld' : 'custom';
            const refId = body.refId != null ? Number(body.refId) : null;
            const data = body.data && typeof body.data === 'object' ? body.data : null;
            if (!name || !data) return sendJson(res, 400, { error: 'Project name and data are required' });
            const saved = insertSnapshot(user.id, type, refId, name, data);
            return sendJson(res, 201, saved);
        }

        if (pathname === '/api/tracking/sync' && method === 'POST') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            let count = 0;
            for (const p of loadProjects()) {
                insertSnapshot(user.id, 'realworld', p.id, p.name, snapshotForProject(p));
                count++;
            }
            return sendJson(res, 200, { count });
        }

        if (pathname === '/api/tracking' && method === 'DELETE') {
            if (!user) return sendJson(res, 401, { error: 'Sign in required' });
            db.prepare('DELETE FROM tracking WHERE user_id = ?').run(user.id);
            return sendJson(res, 200, { ok: true });
        }

        if ((m = pathname.match(/^\/api\/tracking\/(\d+)$/))) {
            const id = Number(m[1]);
            if (method === 'DELETE') {
                if (!user) return sendJson(res, 401, { error: 'Sign in required' });
                const info = db.prepare('DELETE FROM tracking WHERE id = ? AND user_id = ?').run(id, user.id);
                if (info.changes === 0) return sendJson(res, 404, { error: 'Tracking entry not found' });
                return sendJson(res, 200, { ok: true });
            }
        }

        // ---------- Static pages ----------
        if (method === 'GET') {
            if (pathname === '/favicon.ico') {
                res.writeHead(204); return res.end();
            }
            if (pathname === '/' || pathname === '/index.html' || pathname === '/index') {
                if (!user) {
                    redirect(res, '/login');
                    return;
                }
                return sendFile(res, path.join(ROOT, 'index.html'));
            }
            if (PUBLIC_FILES[pathname]) {
                return sendFile(res, path.join(ROOT, PUBLIC_FILES[pathname]));
            }
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + pathname);
    } catch (err) {
        if (res.headersSent) { res.end(); return; }
        sendJson(res, 500, { error: 'Server error: ' + err.message });
    }
});

// ----------------------------------------------------------------------------
// STARTUP
// ----------------------------------------------------------------------------
seedProjects(false);
try { createUser('admin', 'admin@in.gov', 'admin123', 'admin'); } catch (e) { /* admin already exists */ }

const { exec } = require('node:child_process');
server.listen(PORT, () => {
    const url = 'http://localhost:' + PORT + '/';
    console.log('==============================================');
    console.log('  GovRisk running at: ' + url);
    console.log('  Default admin login: admin / admin123');
    console.log('  Database file: ' + DB_PATH);
    console.log('  First registered user becomes a viewer.');
    console.log('  Press Ctrl+C to stop.');
    console.log('==============================================');
    if (process.platform === 'win32' && process.env.GOVRISK_NO_BROWSER !== '1') {
        exec('start "" "' + url + '"');
    }
});