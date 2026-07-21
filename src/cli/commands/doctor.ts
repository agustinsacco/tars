import { Config } from '../../config/config.js';
import { TarsDoctor } from '../../maintenance/doctor.js';

export async function doctor(options: { readonly json?: boolean }): Promise<boolean> {
    const report = await new TarsDoctor(Config.getInstance()).run();
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return report.status !== 'critical';
    }

    console.log(`\nTars doctor: ${report.status.toUpperCase()}\n`);
    if (report.findings.length === 0) console.log('No findings.');
    for (const finding of report.findings) {
        console.log(`[${finding.severity.toUpperCase()}] ${finding.title}`);
        console.log(`  ${finding.summary}`);
        if (finding.repairId) console.log(`  Repair: ${finding.repairId}`);
    }
    return report.status !== 'critical';
}
