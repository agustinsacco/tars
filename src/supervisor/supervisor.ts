import { GeminiCli } from './gemini-cli.js';
import { SessionManager } from './session-manager.js';
import { GeminiOutputHandler } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { MemoryManager } from '../memory/memory-manager.js';

/**
 * Tars Supervisor - Core Orchestrator
 * Simplified to handle session management and Gemini CLI execution.
 */
export class Supervisor {
    private readonly config: Config;
    public readonly memory: MemoryManager;
    private isProcessing: boolean = false;

    constructor(
        private readonly gemini: GeminiCli,
        private readonly sessionManager: SessionManager
    ) {
        this.config = Config.getInstance();
        this.memory = new MemoryManager(this.config);
    }

    /**
     * Executes a user prompt through the Gemini CLI
     */
    public async run(
        content: string,
        onEvent: GeminiOutputHandler,
        sessionId?: string
    ): Promise<void> {
        logger.info(
            `🤖 Supervisor processing request: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
        );

        try {
            // Get or create session
            let sessionIdToUse = sessionId || this.sessionManager.load();

            // Lock the supervisor
            this.isProcessing = true;

            // Run Gemini CLI
            await this.gemini.run(
                content,
                (event) => {
                    // Learn session ID from Gemini CLI if it was newly generated
                    if (event.sessionId) {
                        sessionIdToUse = event.sessionId;
                        if (sessionIdToUse) {
                            this.sessionManager.save(sessionIdToUse);
                        }
                    }

                    // Extract data for session tracking
                    if (event.type === 'done') {
                        if (event.usageStats) {
                            this.sessionManager.updateUsage(event.usageStats);
                        }
                        if (sessionIdToUse) {
                            this.sessionManager.save(sessionIdToUse);
                        }
                    }
                    onEvent(event);
                },
                sessionIdToUse || undefined
            );
        } catch (error: any) {
            logger.error(`❌ Supervisor execution error: ${error.message}`);
            onEvent({ type: 'error', error: error.message });
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Specialized execution for background tasks
     */
    public async executeTask(prompt: string): Promise<string> {
        if (this.isProcessing) {
            logger.warn('⚠️ Supervisor is busy, skipping background task');
            throw new Error('Supervisor is busy');
        }

        logger.info(`⚙️ Executing background task...`);

        try {
            this.isProcessing = true;
            const sessionId = this.sessionManager.load();
            const result = await this.gemini.runSync(prompt, sessionId || undefined);
            return result;
        } catch (error: any) {
            logger.error(`❌ Background task failed: ${error.message}`);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Prunes the last turn from the current session.
     */
    public async pruneLastTurn(): Promise<void> {
        const sessionId = this.sessionManager.load();
        if (sessionId) {
            await this.gemini.pruneLastTurn(sessionId);
        }
    }
    /**
     * Checks if the supervisor is currently processing a request
     */
    public isBusy(): boolean {
        return this.isProcessing;
    }
}
