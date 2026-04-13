const express = require('express');
const next = require('next');
const { Server } = require('socket.io');
const http = require('http');
const si = require('systeminformation');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');
const { exec } = require('child_process');

dotenv.config();

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;
const DASH_PASSWORD = process.env.DASH_PASSWORD || 'changeme';

// Path Agnostic Configuration
const homedir = os.homedir();
const TARS_HOME = process.env.TARS_HOME || process.env.BASE_DIR;

let BASE_DIR;
let REAL_HOME;

if (TARS_HOME) {
    BASE_DIR = TARS_HOME;
    REAL_HOME = homedir.endsWith('.tars') ? path.dirname(homedir) : homedir;
} else {
    if (homedir.endsWith('.tars')) {
        BASE_DIR = homedir;
        REAL_HOME = path.dirname(homedir);
    } else {
        BASE_DIR = path.join(homedir, '.tars');
        REAL_HOME = homedir;
    }
}

const DATA_DIR = path.join(BASE_DIR, 'data');

const OUT_LOG = path.join(REAL_HOME, '.pm2/logs/tars-supervisor-out.log');
const ERR_LOG = path.join(REAL_HOME, '.pm2/logs/tars-supervisor-error.log');

app.prepare().then(() => {
    const server = express();
    const httpServer = http.createServer(server);
    const io = new Server(httpServer, {
        cors: { origin: '*' }
    });

    // Socket.io Authentication Middleware
    io.use((socket, next) => {
        const authHeader = socket.handshake.headers.authorization;
        if (!authHeader) {
            return next(new Error('Authentication required'));
        }

        const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        const user = auth[0];
        const pass = auth[1];

        if (user === 'admin' && pass === DASH_PASSWORD) {
            return next();
        } else {
            return next(new Error('Invalid credentials'));
        }
    });

    // Basic Auth Middleware for Express
    const basicAuth = (req, res, nextMiddleware) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.setHeader('WWW-Authenticate', 'Basic realm="TarsDash"');
            return res.status(401).send('Authentication required');
        }

        const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        const user = auth[0];
        const pass = auth[1];

        if (user === 'admin' && pass === DASH_PASSWORD) {
            return nextMiddleware();
        } else {
            res.setHeader('WWW-Authenticate', 'Basic realm="TarsDash"');
            return res.status(401).send('Invalid credentials');
        }
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
            console.error(`Error reading ${filePath}:`, e.message);
        }
        return null;
    };

    // Tars CLI Commands
    server.post('/api/tars/command', (req, res) => {
        const { action, key, value } = req.body;
        const TARS_BIN = path.join(BASE_DIR, 'apps/tars/dist/cli/index.js');
        let command = '';

        if (action === 'restart') {
            command = `${TARS_BIN} restart`;
        } else if (action === 'secret' && key && value) {
            // Basic sanitization to prevent command injection
            const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '');
            const sanitizedValue = value.replace(/'/g, "'\\''");
            command = `${TARS_BIN} secret set ${sanitizedKey} '${sanitizedValue}'`;
        } else {
            return res.status(400).json({ error: 'Invalid action or missing parameters' });
        }

        console.log(`Executing Tars Command: ${command}`);
        // Inherit environment including PATH
        exec(command, { env: process.env }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Tars Command Error: ${error.message}`);
                return res.status(500).json({ error: error.message, stderr });
            }
            res.json({ status: 'success', stdout, stderr });
        });
    });

    // API Routes
    server.get('/api/files', (req, res) => {
        const relativePath = req.query.path || '';
        const absolutePath = path.resolve(BASE_DIR, relativePath);

        if (!absolutePath.startsWith(BASE_DIR)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        try {
            if (!fs.existsSync(absolutePath)) {
                return res.status(404).json({ error: 'Not found' });
            }

            const stats = fs.statSync(absolutePath);
            if (stats.isDirectory()) {
                const files = fs
                    .readdirSync(absolutePath)
                    .map((file) => {
                        const fPath = path.join(absolutePath, file);
                        try {
                            const fStats = fs.statSync(fPath);
                            return {
                                name: file,
                                path: path.relative(BASE_DIR, fPath),
                                isDirectory: fStats.isDirectory(),
                                size: fStats.size,
                                mtime: fStats.mtime
                            };
                        } catch (e) {
                            return null;
                        }
                    })
                    .filter(Boolean);
                return res.json({ type: 'directory', files });
            } else {
                const ext = path.extname(absolutePath).toLowerCase();
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

                const content = fs.readFileSync(absolutePath, 'utf8');
                return res.json({ type: 'file', content });
            }
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    // Socket.io
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('subscribe', (room) => {
            socket.join(room);
            console.log(`Client ${socket.id} subscribed to ${room}`);

            if (room === 'logs') {
                exec(`tail -n 100 ${OUT_LOG}`, (error, stdout) => {
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
                const CHATS_DIR = path.join(BASE_DIR, '.gemini/tmp/tars/chats');
                let sessionStats = { total: 0, lastSwitch: null, history: [] };
                try {
                    if (fs.existsSync(CHATS_DIR)) {
                        const files = fs
                            .readdirSync(CHATS_DIR)
                            .filter((f) => f.endsWith('.json'))
                            .map((f) => ({
                                name: f,
                                mtime: fs.statSync(path.join(CHATS_DIR, f)).mtime
                            }))
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
            const { stdout } = await new Promise((resolve, reject) => {
                exec('rocm-smi -a --json', (error, stdout) => {
                    if (error) reject(error);
                    else resolve({ stdout });
                });
            });
            const data = JSON.parse(stdout);
            const card = data.card0;
            if (!card) return null;

            const { stdout: memStdout } = await new Promise((resolve, reject) => {
                exec('rocm-smi --showmeminfo vram --json', (error, stdout) => {
                    if (error) reject(error);
                    else resolve({ stdout });
                });
            });
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
        } catch (e) {
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
            path.join(BASE_DIR, '.gemini/tmp/tars/chats')
        ],
        { persistent: true }
    );

    dataWatcher.on('all', (event, filePath) => {
        if (!fs.existsSync(filePath)) return;
        if (fs.statSync(filePath).isDirectory()) return;

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
            const CHATS_DIR = path.join(BASE_DIR, '.gemini/tmp/tars/chats');
            try {
                if (fs.existsSync(CHATS_DIR)) {
                    const files = fs
                        .readdirSync(CHATS_DIR)
                        .filter((f) => f.endsWith('.json'))
                        .map((f) => ({
                            name: f,
                            mtime: fs.statSync(path.join(CHATS_DIR, f)).mtime
                        }))
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
            } catch (e) {}
        }
    });

    // File Watcher
    const fsWatcher = chokidar.watch(BASE_DIR, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        depth: 3
    });

    fsWatcher.on('all', (event, path) => {
        io.to('fs').emit('fs_event', { event, path: path.replace(BASE_DIR, '') });
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

    httpServer.listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);
    });
});
