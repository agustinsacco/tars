import { GeminiCli } from './gemini-cli.js';
import { SessionManager } from './session-manager.js';
import { GeminiEvent, GeminiOutputHandler } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';

/**
 * Tars Supervisor - Core Orchestrator
 * Simplified to handle session management and Gemini CLI execution.
 */
export class Supervisor {
    private readonly config: Config;

    constructor(
        private readonly gemini: GeminiCli,
        private readonly sessionManager: SessionManager
    ) {
        this.config = Config.getInstance();
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
            if (!sessionIdToUse) {
                // For new sessions, we'll let Gemini CLI handle ID generation or just use a placeholder
                sessionIdToUse = `tars-${Date.now()}`;
                this.sessionManager.save(sessionIdToUse);
            }

            // Run Gemini CLI
            await this.gemini.run(
                content,
                (event) => {
                    // Extract data for session tracking if possible
                    if (event.type === 'done') {
                        // usage is usually passed in structured output, here we just increment
                        this.sessionManager.save(sessionIdToUse!);
                    }
                    onEvent(event);
                },
                sessionIdToUse
            );
        } catch (error: any) {
            logger.error(`❌ Supervisor execution error: ${error.message}`);
            onEvent({ type: 'error', error: error.message });
        }
    }

    /**
     * Specialized execution for background tasks
     */
    public async executeTask(
        prompt: string,
        mode: 'notify' | 'silent' = 'silent'
    ): Promise<string> {
        logger.info(`⚙️ Executing background task...`);

        try {
            const result = await this.gemini.runSync(prompt);
            return result;
        } catch (error: any) {
            logger.error(`❌ Background task failed: ${error.message}`);
            throw error;
        }
    }
}
