import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from './logger.js';
import chalk from 'chalk';
import { getTarsHome } from './paths.js';

/**
 * BrainAuditor - Ensures the stability and structural integrity of the Tars workspace (~/.tars).
 * Use this during setup, import, or supervisor startup to heal old or broken configurations.
 */
export class BrainAuditor {
    private tarsHome: string;

    constructor(tarsHome?: string) {
        this.tarsHome = tarsHome || getTarsHome();
    }

    /**
     * Run a full audit and repair cycle.
     */
    public async audit(options: { silent?: boolean } = {}): Promise<void> {
        const log = (msg: string) => {
            if (!options.silent) console.log(chalk.blue(`🔍 ${msg}`));
            logger.debug(`[Auditor] ${msg}`);
        };

        if (!fs.existsSync(this.tarsHome)) return;

        log('Auditing Tars brain structure...');

        // 1. Remove recursive anomalies (e.g. ~/.tars/.tars or ~/.tars/~)
        this.cleanupAnomalies(log);

        // 2. Re-home extension paths in extension-enablement.json
        this.rehomeExtensions(log);

        // 3. Audit Skills (clean up flat files shadowed by folders)
        this.auditSkills(log);

        // 4. Update Metadata
        this.updateMetadata();
    }

    private cleanupAnomalies(log: (msg: string) => void): void {
        const anomalies = ['.tars', '~', 'tmp/gemini-cli'];
        for (const anomaly of anomalies) {
            const anomalyPath = path.join(this.tarsHome, anomaly);
            if (fs.existsSync(anomalyPath)) {
                log(`Removing anomaly: ${anomaly}`);
                fs.rmSync(anomalyPath, { recursive: true, force: true });
            }
        }

        // Deep check for tilde anomalies in extensions
        const extDir = path.join(this.tarsHome, '.gemini', 'extensions');
        if (fs.existsSync(extDir)) {
            const extensions = fs.readdirSync(extDir);
            for (const ext of extensions) {
                const tildeChild = path.join(extDir, ext, '~');
                if (fs.existsSync(tildeChild)) {
                    log(`Removing nested extension anomaly: ${ext}/~`);
                    fs.rmSync(tildeChild, { recursive: true, force: true });
                }
            }
        }
    }

    private rehomeExtensions(log: (msg: string) => void): void {
        const enablementPath = path.join(
            this.tarsHome,
            '.gemini',
            'extensions',
            'extension-enablement.json'
        );
        if (!fs.existsSync(enablementPath)) return;

        try {
            const content = fs.readFileSync(enablementPath, 'utf-8');
            // Re-home /home/olduser/.tars or /Users/olduser/.tars to current tarsHome
            const rehomedContent = content.replace(/\/(home|Users)\/[^/]+\/\.tars/g, this.tarsHome);

            if (content !== rehomedContent) {
                fs.writeFileSync(enablementPath, rehomedContent);
                log('Normalized extension paths for this machine.');
            }
        } catch (err: any) {
            logger.warn(`Auditor failed to re-home extensions: ${err.message}`);
        }
    }

    private auditSkills(log: (msg: string) => void): void {
        const skillsDir = path.join(this.tarsHome, '.gemini', 'skills');
        if (!fs.existsSync(skillsDir)) return;

        const entries = fs.readdirSync(skillsDir);
        const folders = entries.filter((e) => fs.statSync(path.join(skillsDir, e)).isDirectory());
        const files = entries.filter((e) => fs.statSync(path.join(skillsDir, e)).isFile());

        for (const file of files) {
            if (!file.endsWith('.md')) continue;
            const skillName = file.replace(/\.md$/, '');

            // If there's a folder with the same name, the file is likely a legacy artifact
            if (folders.includes(skillName)) {
                log(`Removing legacy flat skill artifact: ${file}`);
                fs.unlinkSync(path.join(skillsDir, file));
            }
        }
    }

    private updateMetadata(): void {
        const metaPath = path.join(this.tarsHome, 'metadata.json');
        const meta = {
            lastAudit: new Date().toISOString(),
            version: '1.0.48'
        };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
}
