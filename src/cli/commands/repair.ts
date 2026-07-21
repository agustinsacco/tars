import { z } from 'zod';

import { Config } from '../../config/config.js';
import { RepairRegistry } from '../../maintenance/repair-registry.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const RepairActionSchema = z.enum(['plan', 'apply']);

export async function repair(
    actionInput: unknown,
    repairIds: readonly string[],
    options: { readonly json?: boolean; readonly yes?: boolean }
): Promise<boolean> {
    const action = RepairActionSchema.parse(actionInput);
    const config = Config.getInstance();
    const registry = new RepairRegistry(config);
    const plan = await registry.plan(repairIds);

    if (action === 'plan') {
        printResult({ repairs: plan }, options.json);
        return true;
    }
    if (!options.yes) {
        console.error('Refusing to mutate state without --yes. Run `tars repair plan` first.');
        return false;
    }
    const results = await withTarsHomeMutationLease(config.homeDir, 'apply safe repairs', () =>
        registry.apply(plan)
    );
    printResult({ results }, options.json);
    return results.every(({ status }) => status !== 'failed');
}

function printResult(value: unknown, json: boolean | undefined): void {
    if (json) {
        console.log(JSON.stringify(value, null, 2));
        return;
    }
    console.log(JSON.stringify(value, null, 2));
}
