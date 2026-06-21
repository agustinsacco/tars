import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import chalk from 'chalk';
import logger from './logger.js';

/**
 * Handles migration from legacy engine hidden directories to a consolidated ~/.tars layout
 */
export async function migrateLegacyConfig(tarsHome: string) {
    const geminiDir = path.join(tarsHome, '.gemini');

    // Check if legacy directory exists
    if (!fsSync.existsSync(geminiDir)) {
        return;
    }

    console.log(chalk.yellow.bold('\n📦 Legacy Tars environment detected in ~/.tars/.gemini'));
    console.log(chalk.yellow('Commencing automated migration to Pi Agent layout...\n'));

    try {
        // 1. Ensure target directory structures exist
        const targetChats = path.join(tarsHome, 'chats');
        const targetExtensions = path.join(tarsHome, 'extensions');
        const targetSkills = path.join(tarsHome, 'skills');
        const targetAgents = path.join(tarsHome, 'agents');

        for (const dir of [targetChats, targetExtensions, targetSkills, targetAgents]) {
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
        }

        // 2. Migrate system.md
        const oldSystemMd = path.join(geminiDir, 'system.md');
        const newSystemMd = path.join(tarsHome, 'system.md');
        if (fsSync.existsSync(oldSystemMd)) {
            if (!fsSync.existsSync(newSystemMd)) {
                await fs.copyFile(oldSystemMd, newSystemMd);
                logger.info(`Migrated system.md to ${newSystemMd}`);
            }
            await fs.unlink(oldSystemMd).catch(() => {});
        }

        // 3. Helper to migrate folder contents
        const migrateFolder = async (srcName: string, destPath: string) => {
            const srcPath = path.join(geminiDir, srcName);
            if (!fsSync.existsSync(srcPath)) return;

            const items = await fs.readdir(srcPath);
            for (const item of items) {
                const itemSrc = path.join(srcPath, item);
                const itemDest = path.join(destPath, item);

                if (fsSync.existsSync(itemDest)) {
                    // Avoid overwriting newer user files
                    continue;
                }

                await fs.rename(itemSrc, itemDest).catch(async () => {
                    // Fallback to copy if cross-device rename fails
                    const stat = await fs.stat(itemSrc);
                    if (stat.isDirectory()) {
                        await fs.cp(itemSrc, itemDest, { recursive: true });
                    } else {
                        await fs.copyFile(itemSrc, itemDest);
                    }
                });
            }
            // Clean up old directory contents recursively
            await fs.rm(srcPath, { recursive: true, force: true }).catch(() => {});
        };

        // Migrate folders
        await migrateFolder('extensions', targetExtensions);

        // Rename gemini-extension.json to tars-extension.json in targetExtensions
        if (fsSync.existsSync(targetExtensions)) {
            const extDirs = await fs.readdir(targetExtensions).catch(() => [] as string[]);
            for (const extDir of extDirs) {
                const extPath = path.join(targetExtensions, extDir);
                const stat = await fs.stat(extPath).catch(() => null);
                if (stat?.isDirectory() || stat?.isSymbolicLink()) {
                    const oldManifest = path.join(extPath, 'gemini-extension.json');
                    const newManifest = path.join(extPath, 'tars-extension.json');
                    if (fsSync.existsSync(oldManifest) && !fsSync.existsSync(newManifest)) {
                        await fs.rename(oldManifest, newManifest).catch(() => {});
                        logger.info(`Renamed legacy manifest to tars-extension.json in ${extDir}`);
                    }
                }
            }
        }

        await migrateFolder('skills', targetSkills);
        await migrateFolder('agents', targetAgents);
        await migrateFolder('chats', targetChats);

        // 4. Best-effort chat history conversion from tmp directories
        const tmpDir = path.join(geminiDir, 'tmp');
        if (fsSync.existsSync(tmpDir)) {
            const hashes = await fs.readdir(tmpDir).catch(() => [] as string[]);
            for (const hash of hashes) {
                const subChatPath = path.join(tmpDir, hash, 'chats');
                if (fsSync.existsSync(subChatPath)) {
                    const chatFiles = await fs.readdir(subChatPath).catch(() => [] as string[]);
                    for (const file of chatFiles) {
                        if (file.endsWith('.json')) {
                            const oldChatFile = path.join(subChatPath, file);
                            const newChatFile = path.join(targetChats, file);

                            try {
                                const raw = await fs.readFile(oldChatFile, 'utf-8');
                                const conversation = JSON.parse(raw);

                                // Perform legacy conversation structure translation
                                if (conversation && Array.isArray(conversation.messages)) {
                                    const messages: any[] = [];
                                    for (const msg of conversation.messages) {
                                        const timestamp = new Date().toISOString();
                                        if (msg.type === 'user') {
                                            messages.push({
                                                role: 'user',
                                                content: msg.content || '',
                                                timestamp
                                            });
                                        } else if (msg.type === 'gemini') {
                                            const content: any[] = [];
                                            if (msg.content) {
                                                content.push({ type: 'text', text: msg.content });
                                            }
                                            if (Array.isArray(msg.toolCalls)) {
                                                for (const tc of msg.toolCalls) {
                                                    content.push({
                                                        type: 'toolCall',
                                                        id: tc.id,
                                                        name: tc.name,
                                                        arguments: tc.args || {}
                                                    });
                                                }
                                            }
                                            messages.push({
                                                role: 'assistant',
                                                content,
                                                timestamp
                                            });

                                            // Append tool results immediately following the assistant toolCall turn
                                            if (Array.isArray(msg.toolCalls)) {
                                                for (const tc of msg.toolCalls) {
                                                    if (tc.status === 'done') {
                                                        const resultText =
                                                            typeof tc.result === 'string'
                                                                ? tc.result
                                                                : JSON.stringify(tc.result);
                                                        messages.push({
                                                            role: 'toolResult',
                                                            toolCallId: tc.id,
                                                            toolName: tc.name,
                                                            content: [
                                                                { type: 'text', text: resultText }
                                                            ],
                                                            details:
                                                                typeof tc.result === 'object' &&
                                                                tc.result !== null
                                                                    ? tc.result
                                                                    : {},
                                                            isError: false,
                                                            timestamp
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    await fs.writeFile(
                                        newChatFile,
                                        JSON.stringify(messages, null, 2)
                                    );
                                }
                            } catch (e: any) {
                                logger.warn(
                                    `Failed to migrate legacy chat file ${file}: ${e.message}`
                                );
                            }
                        }
                    }
                }
            }
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }

        // 5. Purge Gemini configuration files
        const filesToPurge = [
            'google_accounts.json',
            'oauth_creds.json',
            'oauth_creds.json.bak',
            'settings.json',
            'projects.json',
            'installation_id',
            'GEMINI.md'
        ];

        for (const file of filesToPurge) {
            const filePath = path.join(geminiDir, file);
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath).catch(() => {});
            }
        }

        // 6. Delete empty hidden folder
        await fs.rm(geminiDir, { recursive: true, force: true }).catch(() => {});

        // 7. Clean up other hidden folders (.claude, .codex, etc.)
        const obsoleteFolders = ['.claude', '.codex', '.pi'];
        for (const folder of obsoleteFolders) {
            const folderPath = path.join(tarsHome, folder);
            if (fsSync.existsSync(folderPath)) {
                await fs.rm(folderPath, { recursive: true, force: true }).catch(() => {});
                logger.info(`Purged obsolete hidden folder: ${folder}`);
            }
        }

        console.log(
            chalk.green.bold(
                '✨ Migration completed. Legacy Gemini primitives successfully purged.\n'
            )
        );
    } catch (err: any) {
        console.log(chalk.red(`❌ Automated migration failed: ${err.message}`));
        logger.error(`Automated migration failed: ${err.stack}`);
    }
}
