interface RequestRecord {
    timestamp: number;
    tokens: number;
}

export class LocalRateLimiter {
    private history: RequestRecord[] = [];
    private reservationQueue: Promise<void> = Promise.resolve();
    private readonly windowMs = 60 * 1000; // 1 minute window

    constructor(
        private readonly maxRPM: number,
        private readonly maxTPM: number
    ) {}

    /**
     * Checks if a request with the given estimated tokens can proceed immediately.
     * If not, returns the number of milliseconds to wait.
     * If yes, returns 0.
     */
    public checkWaitTime(estimatedTokens: number): number {
        this.cleanup();

        const currentRequests = this.history.length;
        let currentTokens = 0;
        for (const req of this.history) {
            currentTokens += req.tokens;
        }

        if (currentRequests >= this.maxRPM || currentTokens + estimatedTokens > this.maxTPM) {
            // Find the oldest record that needs to expire to make room
            if (this.history.length === 0) return 0; // Edge case, shouldn't happen if condition above is true

            const oldest = this.history[0];
            const timeSinceOldest = Date.now() - oldest.timestamp;
            const waitTime = Math.max(0, this.windowMs - timeSinceOldest);

            return waitTime;
        }

        return 0;
    }

    /**
     * Records a request. Should be called immediately before making the API call.
     */
    public recordRequest(tokens: number): void {
        this.history.push({
            timestamp: Date.now(),
            tokens: this.normalizeTokens(tokens)
        });
        this.cleanup();
    }

    /**
     * Atomically waits for capacity and reserves it. Concurrent callers are
     * serialized so they cannot all observe the same available quota.
     */
    public acquire(estimatedTokens: number, onWait?: (waitMs: number) => void): Promise<void> {
        const normalizedTokens = this.normalizeTokens(estimatedTokens);
        const reservation = this.reservationQueue.then(async () => {
            while (true) {
                const waitMs = this.checkWaitTime(normalizedTokens);
                if (waitMs <= 0) {
                    this.recordRequest(normalizedTokens);
                    return;
                }
                onWait?.(waitMs);
                await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
            }
        });
        this.reservationQueue = reservation.catch(() => undefined);
        return reservation;
    }

    private normalizeTokens(tokens: number): number {
        if (!Number.isFinite(tokens)) return this.maxTPM;
        return Math.min(this.maxTPM, Math.max(0, Math.ceil(tokens)));
    }

    private cleanup(): void {
        const now = Date.now();
        this.history = this.history.filter((req) => now - req.timestamp < this.windowMs);
    }
}
