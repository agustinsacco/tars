import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LocalRateLimiter } from '../../supervisor/rate-limiter.js';

describe('LocalRateLimiter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should allow requests within limits', () => {
        const limiter = new LocalRateLimiter(2, 100);

        // First request
        expect(limiter.checkWaitTime(50)).toBe(0);
        limiter.recordRequest(50);

        // Second request
        expect(limiter.checkWaitTime(50)).toBe(0);
        limiter.recordRequest(50);
    });

    it('should throttle when RPM is exceeded', () => {
        const limiter = new LocalRateLimiter(2, 1000);

        limiter.recordRequest(10);
        limiter.recordRequest(10);

        // Third request should be throttled because maxRPM is 2
        const waitTime = limiter.checkWaitTime(10);
        expect(waitTime).toBeGreaterThan(0);
        expect(waitTime).toBeLessThanOrEqual(60000);
    });

    it('should throttle when TPM is exceeded', () => {
        const limiter = new LocalRateLimiter(10, 100);

        limiter.recordRequest(80);

        // Second request should be throttled because 80 + 30 > 100
        const waitTime = limiter.checkWaitTime(30);
        expect(waitTime).toBeGreaterThan(0);
        expect(waitTime).toBeLessThanOrEqual(60000);
    });

    it('should allow requests after time has passed', () => {
        const limiter = new LocalRateLimiter(2, 100);

        limiter.recordRequest(50);
        limiter.recordRequest(50);

        // Should throttle
        expect(limiter.checkWaitTime(10)).toBeGreaterThan(0);

        // Advance time by 61 seconds
        vi.advanceTimersByTime(61000);

        // Should allow now
        expect(limiter.checkWaitTime(10)).toBe(0);
    });
});
