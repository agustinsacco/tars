import { spawn } from 'child_process';
import { GeminiEvent, GeminiOutputHandler } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import path from 'path';
import os from 'os';

/**
 * Wrapper for the Gemini CLI process
 */
export class GeminiCli {
    private readonly config: Config;

    constructor(private readonly model: string) {
        this.config = Config.getInstance();
    }

    /**
     * Executes a prompt via Gemini CLI and streams events
     */
    public async run(
        prompt: string,
        onEvent: GeminiOutputHandler,
        sessionId?: string,
        extensions: string[] = []
    ): Promise<void> {
        const args = ['chat', '--model', this.model];

        if (sessionId) {
            args.push('--session', sessionId);
        }

        // Add extensions
        for (const ext of extensions) {
            args.push('--extension', ext);
        }

        args.push('--yolo', prompt);

        logger.debug(`Executing Gemini CLI: gemini ${args.join(' ')}`);

        // Use GEMINI_CLI_HOME for full isolation
        // Gemini CLI uses homedir()/.gemini/ for everything.
        // By setting GEMINI_CLI_HOME=~/.tars, it will use ~/.tars/.gemini/
        // GEMINI_SYSTEM_MD overrides the default system prompt with Tars' custom persona
        const env = {
            ...process.env,
            GEMINI_CLI_HOME: this.config.homeDir,
            GEMINI_SYSTEM_MD: this.config.systemPromptPath
        };

        return new Promise((resolve, reject) => {
            const childDescription = `gemini chat [session: ${sessionId || 'new'}]`;
            const child = spawn('gemini', args, { env });

            let buffer = '';

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                buffer += chunk;

                // For now, we stream raw text events.
                // Future improvement: Parse structured output if Gemini CLI supports it.
                onEvent({ type: 'text', content: chunk });
            });

            child.stderr.on('data', (data) => {
                const error = data.toString();
                if (error.toLowerCase().includes('error')) {
                    onEvent({ type: 'error', error });
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    onEvent({ type: 'done' });
                    resolve();
                } else {
                    reject(new Error(`${childDescription} exited with code ${code}`));
                }
            });

            child.on('error', (err) => {
                logger.error(`Failed to start ${childDescription}: ${err.message}`);
                reject(err);
            });
        });
    }

    /**
     * Synchronous execution (collects all output)
     */
    public async runSync(
        prompt: string,
        sessionId?: string,
        extensions: string[] = []
    ): Promise<string> {
        let fullContent = '';
        await this.run(
            prompt,
            (event) => {
                if (event.type === 'text' && event.content) {
                    fullContent += event.content;
                }
            },
            sessionId,
            extensions
        );
        return fullContent;
    }
}
