const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');
const { execFile } = require('child_process');

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_FAILURES = 5;
const MIN_DASHBOARD_PASSWORD_LENGTH = 16;
const MAX_FILE_PREVIEW_BYTES = 2 * 1024 * 1024;
const UNSAFE_PASSWORDS = new Set(['changeme', 'tars123']);
const CREDENTIAL_FILE_NAMES = new Set([
    '.env',
    'auth.json',
    'config.json',
    'credentials.json',
    'models.json',
    'secrets.json'
]);
const CREDENTIAL_FILE_PATTERN = /(^|[._-])(credential|password|secret|token)([._-]|$)/i;
const CREDENTIAL_EXTENSION_PATTERN = /\.(key|p12|pfx|pem)$/i;

dotenv.config({ quiet: true });

const requestedPort = process.env.DASH_PORT || process.env.PORT || '3000';
const host = process.env.DASH_HOST || '127.0.0.1';
const DASH_PASSWORD = process.env.DASH_PASSWORD;

// Path Agnostic Configuration
const homedir = os.homedir();
const TARS_HOME = process.env.TARS_HOME || process.env.BASE_DIR;

let BASE_DIR;
let REAL_HOME;

if (TARS_HOME) {
    BASE_DIR = canonicalPath(TARS_HOME);
    REAL_HOME = homedir.endsWith('.tars') ? path.dirname(homedir) : homedir;
} else {
    if (homedir.endsWith('.tars')) {
        BASE_DIR = canonicalPath(homedir);
        REAL_HOME = path.dirname(homedir);
    } else {
        BASE_DIR = canonicalPath(path.resolve(homedir, '.tars'));
        REAL_HOME = homedir;
    }
}

const DATA_DIR = path.join(BASE_DIR, 'data');
const CHATS_DIR = path.join(BASE_DIR, 'chats');
const configuredInstanceName = process.env.TARS_INSTANCE_NAME || 'tars-supervisor';
const instanceName = /^[A-Za-z0-9._-]+$/.test(configuredInstanceName)
    ? configuredInstanceName
    : 'tars-supervisor';

const OUT_LOG = path.join(REAL_HOME, `.pm2/logs/${instanceName}-out.log`);
const ERR_LOG = path.join(REAL_HOME, `.pm2/logs/${instanceName}-error.log`);

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function canonicalPath(candidatePath) {
    const resolvedPath = path.resolve(candidatePath);
    try {
        return fs.realpathSync.native(resolvedPath);
    } catch {
        return resolvedPath;
    }
}

function validateDashboardPassword(password) {
    const normalized = typeof password === 'string' ? password.trim().toLowerCase() : '';
    if (normalized.length < MIN_DASHBOARD_PASSWORD_LENGTH || UNSAFE_PASSWORDS.has(normalized)) {
        throw new Error(
            'Dashboard disabled: configure a strong DASH_PASSWORD before enabling the service.'
        );
    }
}

function parseDashboardPort(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error('Dashboard disabled: DASH_PORT must be an integer from 1 to 65535.');
    }
    return parsed;
}

function hashValue(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeEqual(actual, expected) {
    return crypto.timingSafeEqual(hashValue(actual), hashValue(expected));
}

function parseBasicCredentials(authHeader) {
    if (typeof authHeader !== 'string') return null;

    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authHeader.trim());
    if (!match) return null;

    try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        const separatorIndex = decoded.indexOf(':');
        if (separatorIndex < 0) return null;

        return {
            username: decoded.slice(0, separatorIndex),
            password: decoded.slice(separatorIndex + 1)
        };
    } catch {
        return null;
    }
}

function isAuthorized(authHeader, expectedPassword) {
    if (typeof expectedPassword !== 'string') return false;
    const credentials = parseBasicCredentials(authHeader);
    if (!credentials) return false;

    const validUsername = constantTimeEqual(credentials.username, 'admin');
    const validPassword = constantTimeEqual(credentials.password, expectedPassword);
    return validUsername && validPassword;
}

function createAuthRateLimiter() {
    const failures = new Map();

    function getRecord(clientKey) {
        const record = failures.get(clientKey);
        if (!record) return null;
        if (Date.now() - record.firstFailureAt <= AUTH_WINDOW_MS) return record;
        failures.delete(clientKey);
        return null;
    }

    return {
        isBlocked(clientKey) {
            const record = getRecord(clientKey);
            return Boolean(record && record.count >= MAX_AUTH_FAILURES);
        },
        recordFailure(clientKey) {
            const record = getRecord(clientKey);
            if (record) {
                record.count += 1;
                return;
            }
            failures.set(clientKey, { count: 1, firstFailureAt: Date.now() });
        },
        reset(clientKey) {
            failures.delete(clientKey);
        }
    };
}

function parseAllowedOrigins(value) {
    if (typeof value !== 'string' || !value.trim()) return [];

    return [...new Set(value.split(',').map((origin) => normalizeAllowedOrigin(origin)))];
}

function normalizeAllowedOrigin(value) {
    const candidate = value.trim();
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('DASH_ALLOWED_ORIGIN entries must use HTTP or HTTPS.');
    }
    if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
    ) {
        throw new Error(
            'DASH_ALLOWED_ORIGIN entries must be origins without paths or credentials.'
        );
    }
    return parsed.origin;
}

function readHeader(request, name) {
    const value = request.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
}

function getRequestProtocol(request) {
    const forwardedProtocol = readHeader(request, 'x-forwarded-proto')?.split(',')[0]?.trim();
    if (forwardedProtocol === 'http' || forwardedProtocol === 'https') {
        return forwardedProtocol;
    }
    return request.socket?.encrypted ? 'https' : 'http';
}

function isSocketOriginAllowed(request, configuredOrigins = []) {
    const originHeader = readHeader(request, 'origin');
    if (!originHeader) return true;

    try {
        const origin = new URL(originHeader);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== originHeader) {
            return false;
        }

        const requestHost = readHeader(request, 'host');
        const expectedOrigin = requestHost
            ? `${getRequestProtocol(request)}://${requestHost}`
            : undefined;
        return origin.origin === expectedOrigin || configuredOrigins.includes(origin.origin);
    } catch {
        return false;
    }
}

function createSocketIoOptions(allowedOriginValue) {
    const configuredOrigins = parseAllowedOrigins(allowedOriginValue);
    const options = {
        allowRequest: (request, callback) => {
            callback(null, isSocketOriginAllowed(request, configuredOrigins));
        }
    };

    if (configuredOrigins.length === 0) return options;
    return {
        ...options,
        cors: {
            origin: configuredOrigins,
            credentials: true,
            allowedHeaders: ['Authorization']
        }
    };
}

function createSocketAuthMiddleware(expectedPassword, authRateLimiter) {
    return (socket, next) => {
        const clientKey = socket.handshake.address || 'unknown';
        if (authRateLimiter.isBlocked(clientKey)) {
            next(new Error('Too many authentication attempts'));
            return;
        }

        const authHeader = socket.handshake.headers.authorization;
        if (!isAuthorized(authHeader, expectedPassword)) {
            authRateLimiter.recordFailure(clientKey);
            next(new Error('Authentication required'));
            return;
        }

        authRateLimiter.reset(clientKey);
        next();
    };
}

function isPathInside(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    return (
        relative === '' ||
        (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
}

function isCredentialPath(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    if (!relative || relative === '.') return false;

    return relative.split(path.sep).some((segment) => {
        const normalized = segment.toLowerCase();
        if (normalized === '.env' || normalized.startsWith('.env.')) return true;
        if (CREDENTIAL_FILE_NAMES.has(normalized)) return true;
        if (CREDENTIAL_EXTENSION_PATTERN.test(normalized)) return true;
        return CREDENTIAL_FILE_PATTERN.test(normalized);
    });
}

function resolveReadablePath(rootPath, requestedPath) {
    if (typeof requestedPath !== 'string' || requestedPath.includes('\0')) {
        return { status: 400 };
    }

    const resolvedRoot = canonicalPath(rootPath);
    const candidatePath = path.resolve(resolvedRoot, requestedPath);
    if (
        !isPathInside(resolvedRoot, candidatePath) ||
        isCredentialPath(resolvedRoot, candidatePath)
    ) {
        return { status: 403 };
    }
    if (!fs.existsSync(candidatePath)) return { status: 404 };

    try {
        const realRoot = fs.realpathSync(resolvedRoot);
        const realPath = fs.realpathSync(candidatePath);
        if (!isPathInside(realRoot, realPath) || isCredentialPath(realRoot, realPath)) {
            return { status: 403 };
        }
        return { status: 200, path: realPath };
    } catch {
        return { status: 404 };
    }
}

function toDashboardRelativePath(rootPath, candidatePath) {
    const realRoot = canonicalPath(rootPath);
    const realCandidate = canonicalPath(candidatePath);
    if (!isPathInside(realRoot, realCandidate)) {
        throw new Error('Dashboard path escapes the configured Tars home.');
    }
    return path.relative(realRoot, realCandidate);
}

function readTextPreview(filePath, maxBytes = MAX_FILE_PREVIEW_BYTES) {
    const stats = fs.statSync(filePath);
    if (stats.size > maxBytes) {
        return { status: 413, size: stats.size, maxBytes };
    }
    return { status: 200, size: stats.size, content: fs.readFileSync(filePath, 'utf8') };
}

function runFile(file, args, stdinValue) {
    return new Promise((resolve, reject) => {
        const child = execFile(
            file,
            args,
            { env: process.env, maxBuffer: 1024 * 1024, timeout: 30_000 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve({ stdout, stderr });
            }
        );
        child.stdin?.end(stdinValue);
    });
}

async function startDashboard() {
    validateDashboardPassword(DASH_PASSWORD);
    const port = parseDashboardPort(requestedPort);

    const express = require('express');
    const next = require('next');
    const { Server } = require('socket.io');
    const http = require('http');
    const si = require('systeminformation');
    const chokidar = require('chokidar');
    const dev = process.env.NODE_ENV !== 'production';
    const app = next({ dev });
    const handle = app.getRequestHandler();

    await app.prepare();
    const server = express();
    const httpServer = http.createServer(server);
    const ioOptions = createSocketIoOptions(process.env.DASH_ALLOWED_ORIGIN);
    const io = new Server(httpServer, ioOptions);
    const authRateLimiter = createAuthRateLimiter();

    server.disable('x-powered-by');
    server.use((req, res, nextMiddleware) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
        nextMiddleware();
    });

    // Socket.io Authentication Middleware
    io.use(createSocketAuthMiddleware(DASH_PASSWORD, authRateLimiter));

    // Basic Auth Middleware for Express
    const basicAuth = (req, res, nextMiddleware) => {
        const clientKey = req.socket.remoteAddress || 'unknown';
        if (authRateLimiter.isBlocked(clientKey)) {
            res.setHeader('Retry-After', String(Math.ceil(AUTH_WINDOW_MS / 1000)));
            return res.status(429).send('Too many authentication attempts');
        }

        const authHeader = req.headers.authorization;
        if (!isAuthorized(authHeader, DASH_PASSWORD)) {
            authRateLimiter.recordFailure(clientKey);
            res.setHeader('WWW-Authenticate', 'Basic realm="TarsDash"');
            return res.status(401).send('Authentication required');
        }

        authRateLimiter.reset(clientKey);
        return nextMiddleware();
    };

    // Apply Basic Auth globally to all routes (including /api/files and Next.js assets)
    server.use(basicAuth);

    // Parse JSON bodies
    server.use(express.json());

    // Helper to read JSON safely
    const readJson = (filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) {
            console.error(`Dashboard data read failed: ${getErrorMessage(e)}`);
        }
        return null;
    };

    // Tars CLI Commands
    server.post('/api/tars/command', async (req, res) => {
        const { action, key, value } = req.body;
        const bundledTarsBin = path.join(BASE_DIR, 'apps/tars/dist/cli/index.js');
        const tarsBin =
            process.env.TARS_CLI_PATH || (fs.existsSync(bundledTarsBin) ? bundledTarsBin : 'tars');
        let args;

        if (action === 'restart') {
            args = ['restart'];
        } else if (
            action === 'secret' &&
            typeof key === 'string' &&
            /^[A-Z][A-Z0-9_]*$/.test(key) &&
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= 65_536
        ) {
            args = ['secret', 'set', key];
        } else {
            return res.status(400).json({ error: 'Invalid action or missing parameters' });
        }

        try {
            console.log(`Executing Tars action: ${action}`);
            const result = await runFile(
                tarsBin,
                args,
                action === 'secret' ? `${value}\n` : undefined
            );
            return res.json({
                status: 'success',
                stdout: action === 'secret' ? undefined : result.stdout
            });
        } catch (error) {
            if (action === 'secret') console.error('Tars secret action failed.');
            else console.error(`Tars action failed: ${getErrorMessage(error)}`);
            return res.status(500).json({ error: 'Tars action failed' });
        }
    });

    // API Routes
    server.get('/api/files', (req, res) => {
        const relativePath = req.query.path || '';
        const resolvedPath = resolveReadablePath(BASE_DIR, relativePath);
        if (resolvedPath.status !== 200) {
            const message = resolvedPath.status === 404 ? 'Not found' : 'Forbidden';
            return res.status(resolvedPath.status).json({ error: message });
        }

        try {
            const stats = fs.statSync(resolvedPath.path);
            if (stats.isDirectory()) {
                const files = fs
                    .readdirSync(resolvedPath.path)
                    .map((file) => {
                        const childPath = resolveReadablePath(
                            BASE_DIR,
                            path.join(relativePath, file)
                        );
                        if (childPath.status !== 200) return null;

                        try {
                            const fStats = fs.statSync(childPath.path);
                            return {
                                name: file,
                                path: toDashboardRelativePath(BASE_DIR, childPath.path),
                                isDirectory: fStats.isDirectory(),
                                size: fStats.size,
                                mtime: fStats.mtime
                            };
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean);
                return res.json({ type: 'directory', files });
            } else {
                const ext = path.extname(resolvedPath.path).toLowerCase();
                const binaryExtensions = [
                    '.png',
                    '.jpg',
                    '.jpeg',
                    '.gif',
                    '.pdf',
                    '.zip',
                    '.tar',
                    '.gz',
                    '.db',
                    '.sqlite',
                    '.exe',
                    '.bin',
                    '.node'
                ];

                if (binaryExtensions.includes(ext)) {
                    return res.json({
                        type: 'file',
                        content: '>>> BINARY_FILE_PREVIEW_NOT_SUPPORTED'
                    });
                }

                const preview = readTextPreview(resolvedPath.path);
                if (preview.status !== 200) {
                    return res.status(preview.status).json({
                        error: 'File is too large to preview',
                        size: preview.size,
                        maxBytes: preview.maxBytes
                    });
                }
                return res.json({ type: 'file', content: preview.content, size: preview.size });
            }
        } catch (err) {
            console.error(`Dashboard file read failed: ${getErrorMessage(err)}`);
            return res.status(500).json({ error: 'Unable to read file' });
        }
    });

    // Socket.io
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('subscribe', (room) => {
            socket.join(room);
            console.log(`Client ${socket.id} subscribed to ${room}`);

            if (room === 'logs') {
                execFile('tail', ['-n', '100', OUT_LOG], (error, stdout) => {
                    if (!error) {
                        socket.emit(
                            'logs_init',
                            stdout
                                .split('\n')
                                .filter(Boolean)
                                .map((l) => `[OUT] ${l}`)
                        );
                    }
                });
            }

            if (room === 'intelligence') {
                const facts = readJson(path.join(DATA_DIR, 'memory/facts.json'));
                const tasks = readJson(path.join(DATA_DIR, 'tasks.json'));
                let session = readJson(path.join(DATA_DIR, 'session.json')) || {};

                // Add session stats
                let sessionStats = { total: 0, lastSwitch: null, history: [] };
                try {
                    if (fs.existsSync(CHATS_DIR)) {
                        const files = fs
                            .readdirSync(CHATS_DIR)
                            .filter((f) => f.endsWith('.json'))
                            .map((f) => {
                                try {
                                    return {
                                        name: f,
                                        mtime: fs.statSync(path.join(CHATS_DIR, f)).mtime
                                    };
                                } catch {
                                    return null;
                                }
                            })
                            .filter(Boolean)
                            .sort((a, b) => b.mtime - a.mtime);

                        sessionStats.total = files.length;
                        sessionStats.lastSwitch = files[0]?.mtime || null;
                        sessionStats.history = files.slice(0, 10).map((f) => ({
                            id: f.name.split('-').pop().replace('.json', ''),
                            time: f.mtime
                        }));

                        // If session interaction count is 0 or low, try to count from the current chat file
                        if (
                            session.sessionId &&
                            (!session.interactionCount || session.interactionCount < 2)
                        ) {
                            const currentChatFile = files.find((f) =>
                                f.name.includes(session.sessionId.split('-')[0])
                            );
                            if (currentChatFile) {
                                const chatData = readJson(
                                    path.join(CHATS_DIR, currentChatFile.name)
                                );
                                if (chatData && chatData.messages) {
                                    session.interactionCount = chatData.messages.filter(
                                        (m) => m.type === 'user'
                                    ).length;
                                    // Also pull token info from chat file if it's more accurate
                                    if (chatData.tokenStats) {
                                        session.totalInputTokens =
                                            chatData.tokenStats.totalInputTokens;
                                        session.totalOutputTokens =
                                            chatData.tokenStats.totalOutputTokens;
                                        session.totalCachedTokens =
                                            chatData.tokenStats.totalCachedTokens;
                                        session.totalNetTokens = chatData.tokenStats.totalNetTokens;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error reading sessions:', e.message);
                }

                socket.emit('intelligence_init', { facts, tasks, session, sessionStats });
            }
        });

        socket.on('unsubscribe', (room) => {
            socket.leave(room);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected');
        });
    });

    // Metrics Loop
    const getGpuStats = async () => {
        try {
            const { stdout } = await runFile('rocm-smi', ['-a', '--json']);
            const data = JSON.parse(stdout);
            const card = data.card0;
            if (!card) return null;

            const { stdout: memStdout } = await runFile('rocm-smi', [
                '--showmeminfo',
                'vram',
                '--json'
            ]);
            const memData = JSON.parse(memStdout);
            const vram = memData.card0;

            return {
                name: card['Device Name'] || 'AMD GPU',
                usage: card['GPU use (%)'] || '0',
                memTotal: vram
                    ? (parseInt(vram['VRAM Total Memory (B)']) / 1024 / 1024 / 1024).toFixed(2)
                    : '0',
                memUsed: vram
                    ? (parseInt(vram['VRAM Total Used Memory (B)']) / 1024 / 1024 / 1024).toFixed(2)
                    : '0',
                memUsage: card['GPU Memory Allocated (VRAM%)'] || '0',
                temp: card['Temperature (Sensor edge) (C)'] || '0',
                power: card['Current Socket Graphics Package Power (W)'] || '0',
                clock: card['sclk clock speed:']
                    ? card['sclk clock speed:'].replace(/[()]/g, '')
                    : '0'
            };
        } catch {
            return null;
        }
    };

    setInterval(async () => {
        try {
            const [cpu, mem, disk, net, time, temp, gpu] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.fsSize(),
                si.networkStats(),
                si.time(),
                si.cpuTemperature(),
                getGpuStats()
            ]);

            io.to('metrics').emit('metrics_update', {
                cpu: {
                    load: cpu.currentLoad.toFixed(1),
                    cpus: cpu.cpus.map((c) => c.load.toFixed(1)),
                    temp: temp.main || 0
                },
                mem: {
                    usage: ((mem.active / mem.total) * 100).toFixed(1),
                    used: (mem.active / 1024 / 1024 / 1024).toFixed(2),
                    total: (mem.total / 1024 / 1024 / 1024).toFixed(2),
                    cached: (mem.cached / 1024 / 1024 / 1024).toFixed(2),
                    swapUsed: (mem.swapused / 1024 / 1024 / 1024).toFixed(2),
                    swapTotal: (mem.swaptotal / 1024 / 1024 / 1024).toFixed(2)
                },
                disks: disk
                    .filter(
                        (d) =>
                            d.size > 0 &&
                            !d.mount.startsWith('/sys') &&
                            !d.mount.startsWith('/proc')
                    )
                    .map((d) => ({
                        fs: d.fs,
                        mount: d.mount,
                        use: d.use.toFixed(1),
                        used: (d.used / 1024 / 1024 / 1024).toFixed(1),
                        size: (d.size / 1024 / 1024 / 1024).toFixed(1)
                    })),
                net: net
                    .filter((n) => n.operstate === 'up')
                    .map((n) => ({
                        iface: n.iface,
                        rx: (n.rx_sec / 1024).toFixed(1),
                        tx: (n.tx_sec / 1024).toFixed(1)
                    })),
                gpu,
                uptime: time.uptime
            });
        } catch (err) {
            console.error('Metrics loop error:', err);
        }
    }, 2000);

    // Intelligence Watcher
    const dataWatcher = chokidar.watch(
        [
            path.join(DATA_DIR, 'memory/facts.json'),
            path.join(DATA_DIR, 'tasks.json'),
            path.join(DATA_DIR, 'session.json'),
            CHATS_DIR
        ],
        { persistent: true }
    );

    dataWatcher.on('all', (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) return;
            if (fs.statSync(filePath).isDirectory()) return;
        } catch {
            return;
        }

        const fileName = path.basename(filePath);
        const data = readJson(filePath);
        let type = '';
        if (fileName === 'facts.json') type = 'facts';
        if (fileName === 'tasks.json') type = 'tasks';
        if (fileName === 'session.json') type = 'session';

        if (type) {
            io.to('intelligence').emit('intelligence_update', { type, data });
        }

        // Always refresh session stats if anything in chats or session.json changes
        if (filePath.includes('chats') || fileName === 'session.json') {
            try {
                if (fs.existsSync(CHATS_DIR)) {
                    const files = fs
                        .readdirSync(CHATS_DIR)
                        .filter((f) => f.endsWith('.json'))
                        .map((f) => {
                            try {
                                return {
                                    name: f,
                                    mtime: fs.statSync(path.join(CHATS_DIR, f)).mtime
                                };
                            } catch {
                                return null;
                            }
                        })
                        .filter(Boolean)
                        .sort((a, b) => b.mtime - a.mtime);

                    io.to('intelligence').emit('intelligence_update', {
                        type: 'sessionStats',
                        data: {
                            total: files.length,
                            lastSwitch: files[0]?.mtime || null,
                            history: files.slice(0, 10).map((f) => ({
                                id: f.name.split('-').pop().replace('.json', ''),
                                time: f.mtime
                            }))
                        }
                    });
                }
            } catch {}
        }
    });

    // File Watcher
    const fsWatcher = chokidar.watch(BASE_DIR, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        depth: 3
    });

    fsWatcher.on('all', (event, changedPath) => {
        const absolutePath = path.resolve(changedPath);
        if (!isPathInside(BASE_DIR, absolutePath) || isCredentialPath(BASE_DIR, absolutePath)) {
            return;
        }
        io.to('fs').emit('fs_event', {
            event,
            path: path.relative(BASE_DIR, absolutePath)
        });
    });

    // Log Tailing
    const tailLog = (logPath, type) => {
        if (!fs.existsSync(logPath)) return;
        let currentOffset = fs.statSync(logPath).size;

        setInterval(() => {
            try {
                const stats = fs.statSync(logPath);
                if (stats.size > currentOffset) {
                    const stream = fs.createReadStream(logPath, {
                        start: currentOffset,
                        end: stats.size
                    });
                    stream.on('data', (chunk) => {
                        const lines = chunk.toString().split('\n').filter(Boolean);
                        io.to('logs').emit(
                            'logs_update',
                            lines.map((line) => `[${type}] ${line}`)
                        );
                    });
                    currentOffset = stats.size;
                } else if (stats.size < currentOffset) {
                    currentOffset = 0; // Rotated
                }
            } catch (e) {
                console.error(`Log tailing error for ${type}:`, e.message);
            }
        }, 1000);
    };

    tailLog(OUT_LOG, 'OUT');
    tailLog(ERR_LOG, 'ERR');

    // Next.js Handler
    server.use((req, res) => {
        return handle(req, res);
    });

    httpServer.listen(port, host, () => {
        console.log(`> Ready on http://${host}:${port}`);
    });
}

if (require.main === module) {
    startDashboard().catch((error) => {
        console.error(`Dashboard startup failed: ${getErrorMessage(error)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    constantTimeEqual,
    createAuthRateLimiter,
    createSocketAuthMiddleware,
    createSocketIoOptions,
    isAuthorized,
    isCredentialPath,
    isPathInside,
    isSocketOriginAllowed,
    parseAllowedOrigins,
    parseBasicCredentials,
    parseDashboardPort,
    readTextPreview,
    resolveReadablePath,
    toDashboardRelativePath,
    validateDashboardPassword
};
