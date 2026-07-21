import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import { z } from 'zod';
import logger from './logger.js';
import { getTarsHome } from './paths.js';
import { pkg } from './version.js';

const currentPackageVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
const metadataRecordSchema = z.record(z.unknown());

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

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
     * Inspect the brain and optionally apply legacy structural repairs.
     */
    public async audit(options: { repair?: boolean; silent?: boolean } = {}): Promise<void> {
        const log = (msg: string) => {
            if (!options.silent) console.log(chalk.blue(`🔍 ${msg}`));
            logger.debug(`[Auditor] ${msg}`);
        };

        if (!fs.existsSync(this.tarsHome)) return;

        log('Auditing Tars brain structure...');

        this.inspectAnomalies(log, options.repair === true);
        if (!options.repair) return;
        this.rehomeExtensions(log);
        this.auditSkills(log);
        this.updateMetadata();
    }

    private inspectAnomalies(log: (msg: string) => void, repair: boolean): void {
        const anomalies = ['.tars', '~', 'tmp/gemini-cli', 'tmp/tars-cli'];
        for (const anomaly of anomalies) {
            const anomalyPath = path.join(this.tarsHome, anomaly);
            if (fs.existsSync(anomalyPath)) {
                log(`${repair ? 'Removing' : 'Found'} anomaly: ${anomaly}`);
                if (repair) fs.rmSync(anomalyPath, { recursive: true, force: true });
            }
        }

        // Deep check for tilde anomalies in extensions
        const extDir = path.join(this.tarsHome, 'extensions');
        if (fs.existsSync(extDir)) {
            const extensions = fs.readdirSync(extDir);
            for (const ext of extensions) {
                const tildeChild = path.join(extDir, ext, '~');
                if (fs.existsSync(tildeChild)) {
                    log(`${repair ? 'Removing' : 'Found'} nested extension anomaly: ${ext}/~`);
                    if (repair) fs.rmSync(tildeChild, { recursive: true, force: true });
                }
            }
        }
    }

    private rehomeExtensions(log: (msg: string) => void): void {
        const enablementPath = path.join(this.tarsHome, 'extensions', 'extension-enablement.json');
        if (!fs.existsSync(enablementPath)) return;

        try {
            const content = fs.readFileSync(enablementPath, 'utf-8');
            // Re-home /home/olduser/.tars or /Users/olduser/.tars to current tarsHome
            const rehomedContent = content.replace(/\/(home|Users)\/[^/]+\/\.tars/g, this.tarsHome);

            if (content !== rehomedContent) {
                fs.writeFileSync(enablementPath, rehomedContent);
                log('Normalized extension paths for this machine.');
            }
        } catch (error) {
            logger.warn(`Auditor failed to re-home extensions: ${getErrorMessage(error)}`);
        }
    }

    private auditSkills(log: (msg: string) => void): void {
        const skillsDir = path.join(this.tarsHome, 'skills');
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
        const temporaryPath = `${metaPath}.tmp-${randomUUID()}`;
        let existingMetadata: Record<string, unknown> = {};
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const result = metadataRecordSchema.safeParse(parsed);
            if (result.success) existingMetadata = result.data;
        } catch {
            // Missing or invalid legacy metadata is replaced with a valid marker.
        }

        const meta = {
            ...existingMetadata,
            lastAudit: new Date().toISOString(),
            version: currentPackageVersion
        };
        try {
            fs.writeFileSync(temporaryPath, `${JSON.stringify(meta, null, 2)}\n`, {
                encoding: 'utf8',
                flag: 'wx',
                mode: 0o600
            });
            fs.chmodSync(temporaryPath, 0o600);
            fs.renameSync(temporaryPath, metaPath);
            fs.chmodSync(metaPath, 0o600);
        } finally {
            if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        }
    }
}
