/** Distinguishes a deferred turn (no inference started) from a failed inference. */
export class ExecutionBusyError extends Error {
    constructor() {
        super('Supervisor is busy');
        this.name = 'ExecutionBusyError';
    }
}
