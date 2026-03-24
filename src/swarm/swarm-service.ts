/**
 * SwarmService — A2A Server for Tars Swarm.
 *
 * Exposes this Tars instance as a remote agent that other Tars instances
 * (or any A2A-compliant agent) can discover and delegate tasks to.
 *
 * Endpoints:
 *   GET  /.well-known/agent.json  → Agent Card (public, no auth)
 *   POST /a2a                     → JSON-RPC handler (authenticated)
 */

import http from 'http';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { buildAgentCard } from './agent-card.js';
import { parseRPCRequest, handleRPCRequest } from './rpc-handler.js';
import type { Supervisor } from '../supervisor/supervisor.js';

/**
 * Maximum request body size (1MB). Prevents abuse.
 */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * Swarm depth header — prevents infinite delegation loops.
 * If a request arrives with X-Swarm-Depth >= MAX_DEPTH, the worker rejects it.
 */
const SWARM_DEPTH_HEADER = 'x-swarm-depth';
const MAX_SWARM_DEPTH = 3;

export class SwarmService {
    private server: http.Server | null = null;

    constructor(
        private readonly config: Config,
        private readonly supervisor: Supervisor
    ) {}

    /**
     * Starts the A2A HTTP server if swarm mode is enabled.
     */
    public async start(): Promise<void> {
        if (!this.config.swarm.enabled) {
            logger.debug('[Swarm] Swarm mode disabled, skipping.');
            return;
        }

        if (!this.config.swarm.apiKey) {
            logger.warn(
                '⚠️ [Swarm] Swarm mode is enabled but SWARM_API_KEY is not set. Run `tars setup` to configure.'
            );
            return;
        }

        return new Promise((resolve) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));

            this.server.listen(this.config.swarm.port, () => {
                logger.info(`🌐 [Swarm] A2A server listening on port ${this.config.swarm.port}`);
                logger.info(
                    `🌐 [Swarm] Agent card: http://localhost:${this.config.swarm.port}/.well-known/agent.json`
                );
                resolve();
            });

            this.server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    logger.error(
                        `❌ [Swarm] Port ${this.config.swarm.port} is already in use. Swarm server not started.`
                    );
                } else {
                    logger.error(`❌ [Swarm] Server error: ${err.message}`);
                }
                resolve();
            });
        });
    }

    /**
     * Stops the A2A server gracefully.
     */
    public stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            logger.info('🛑 [Swarm] A2A server stopped.');
        }
    }

    /**
     * Main request router.
     */
    private async handleRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        // CORS headers for broad compatibility
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Swarm-Depth');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '/';

        try {
            if (req.method === 'GET' && url === '/.well-known/agent.json') {
                return this.handleAgentCard(req, res);
            }

            if (req.method === 'POST' && url === '/a2a') {
                return await this.handleA2A(req, res);
            }

            // Health check
            if (req.method === 'GET' && url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', agent: this.config.assistantName }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        } catch (error: any) {
            logger.error(`❌ [Swarm] Request handler error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }

    /**
     * Serve the agent card. This endpoint is public (no auth required).
     */
    private handleAgentCard(_req: http.IncomingMessage, res: http.ServerResponse): void {
        const card = buildAgentCard(this.config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(card, null, 2));
    }

    /**
     * Handle A2A JSON-RPC requests. Requires authentication.
     */
    private async handleA2A(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Auth check
        if (!this.validateAuth(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 0,
                    error: { code: -32000, message: 'Unauthorized: invalid or missing API key' }
                })
            );
            return;
        }

        // Swarm depth check (loop prevention)
        const depthStr = req.headers[SWARM_DEPTH_HEADER] as string | undefined;
        const depth = depthStr ? parseInt(depthStr, 10) : 0;
        if (depth >= MAX_SWARM_DEPTH) {
            logger.warn(
                `⚠️ [Swarm] Rejecting request: swarm depth ${depth} >= max ${MAX_SWARM_DEPTH}`
            );
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 0,
                    error: {
                        code: -32000,
                        message: `Swarm delegation depth limit reached (max=${MAX_SWARM_DEPTH})`
                    }
                })
            );
            return;
        }

        // Read body
        const body = await this.readBody(req);
        if (body === null) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 0,
                    error: { code: -32000, message: 'Request body too large' }
                })
            );
            return;
        }

        // Parse JSON-RPC
        const parsed = parseRPCRequest(body);
        if ('error' in parsed) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(parsed.error));
            return;
        }

        // Handle the RPC request
        const result = await handleRPCRequest(parsed.request, this.supervisor);

        const statusCode = result.error ? 400 : 200;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    }

    /**
     * Validates the API key from the request headers.
     */
    private validateAuth(req: http.IncomingMessage): boolean {
        const apiKey =
            (req.headers['x-api-key'] as string) ||
            (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '');

        if (!apiKey) return false;
        return apiKey === this.config.swarm.apiKey;
    }

    /**
     * Reads the request body up to MAX_BODY_SIZE.
     * Returns null if the body exceeds the limit.
     */
    private readBody(req: http.IncomingMessage): Promise<string | null> {
        return new Promise((resolve) => {
            const chunks: Buffer[] = [];
            let totalSize = 0;

            req.on('data', (chunk: Buffer) => {
                totalSize += chunk.length;
                if (totalSize > MAX_BODY_SIZE) {
                    req.destroy();
                    resolve(null);
                    return;
                }
                chunks.push(chunk);
            });

            req.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf-8'));
            });

            req.on('error', () => {
                resolve(null);
            });
        });
    }
}
