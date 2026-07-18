const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');

const {
    createAuthRateLimiter,
    createSocketAuthMiddleware,
    createSocketIoOptions,
    toDashboardRelativePath
} = require('../server.js');

const DASHBOARD_PASSWORD = 'integration-dashboard-password';
const BASIC_AUTHORIZATION = `Basic ${Buffer.from(`admin:${DASHBOARD_PASSWORD}`).toString('base64')}`;
const activeHarnesses = [];
const temporaryDirectories = [];

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

function closeHttpServer(server) {
    return new Promise((resolve) => server.close(() => resolve()));
}

async function createHarness(allowedOrigins) {
    const httpServer = http.createServer();
    const socketServer = new Server(httpServer, createSocketIoOptions(allowedOrigins));
    socketServer.use(createSocketAuthMiddleware(DASHBOARD_PASSWORD, createAuthRateLimiter()));
    await listen(httpServer);

    const address = httpServer.address();
    assert.equal(typeof address, 'object');
    assert.notEqual(address, null);
    const origin = `http://127.0.0.1:${address.port}`;
    const harness = { httpServer, socketServer, origin };
    activeHarnesses.push(harness);
    return harness;
}

function connectWebSocket(origin, requestOrigin) {
    return createClient(origin, {
        forceNew: true,
        reconnection: false,
        timeout: 2_000,
        transports: ['websocket'],
        extraHeaders: {
            Authorization: BASIC_AUTHORIZATION,
            Origin: requestOrigin
        }
    });
}

function waitForConnection(client) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 3_000);
        client.once('connect', () => {
            clearTimeout(timeout);
            resolve();
        });
        client.once('connect_error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

afterEach(async () => {
    // ARRANGE
    const harnesses = activeHarnesses.splice(0);
    const directories = temporaryDirectories.splice(0);

    // ACT
    await Promise.all(
        harnesses.map(async ({ httpServer, socketServer }) => {
            await socketServer.close();
            if (httpServer.listening) await closeHttpServer(httpServer);
        })
    );
    await Promise.all(
        directories.map((directory) => fs.rm(directory, { recursive: true, force: true }))
    );
});

test('accepts a same-origin polling handshake and rejects a cross-origin handshake', async () => {
    // ARRANGE
    const harness = await createHarness();
    const handshakeUrl = `${harness.origin}/socket.io/?EIO=4&transport=polling`;

    // ACT
    const sameOrigin = await fetch(handshakeUrl, {
        headers: { Authorization: BASIC_AUTHORIZATION, Origin: harness.origin }
    });
    const crossOrigin = await fetch(handshakeUrl, {
        headers: { Authorization: BASIC_AUTHORIZATION, Origin: 'https://attacker.example' }
    });

    // ASSERT
    assert.equal(sameOrigin.status, 200);
    assert.equal(crossOrigin.status, 403);
});

test('accepts a same-origin authenticated WebSocket and rejects a cross-origin upgrade', async () => {
    // ARRANGE
    const harness = await createHarness();
    const sameOriginClient = connectWebSocket(harness.origin, harness.origin);
    const crossOriginClient = connectWebSocket(harness.origin, 'https://attacker.example');
    const sameOriginConnection = waitForConnection(sameOriginClient);
    const rejectedConnection = assert.rejects(waitForConnection(crossOriginClient));

    // ACT
    await Promise.all([sameOriginConnection, rejectedConnection]);

    // ASSERT
    assert.equal(sameOriginClient.connected, true);
    assert.equal(crossOriginClient.connected, false);
    sameOriginClient.close();
    crossOriginClient.close();
});

test('permits an explicitly allowlisted cross-origin WebSocket', async () => {
    // ARRANGE
    const allowedOrigin = 'https://trusted.example';
    const harness = await createHarness(allowedOrigin);
    const client = connectWebSocket(harness.origin, allowedOrigin);

    // ACT
    await waitForConnection(client);

    // ASSERT
    assert.equal(client.connected, true);
    client.close();
});

test('keeps file navigation relative when TARS_HOME is reached through a symlink', async () => {
    // ARRANGE
    const parentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-dash-path-test-'));
    temporaryDirectories.push(parentDirectory);
    const realHome = path.join(parentDirectory, 'real-home');
    const linkedHome = path.join(parentDirectory, 'linked-home');
    const notesDirectory = path.join(realHome, 'notes');
    await fs.mkdir(notesDirectory, { recursive: true });
    await fs.symlink(realHome, linkedHome, 'dir');

    // ACT
    const relativePath = toDashboardRelativePath(linkedHome, notesDirectory);

    // ASSERT
    assert.equal(relativePath, 'notes');
    assert.equal(path.isAbsolute(relativePath), false);
    assert.equal(relativePath.startsWith('..'), false);
});
