import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeEndpoint } from '../../utils/endpoint-probe.js';

describe('probeEndpoint', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should return reachable=true with models when /v1/models returns model list', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'qwen35_distilled', object: 'model' },
                    { id: 'llama3.1-70b', object: 'model' }
                ]
            })
        });

        const result = await probeEndpoint('http://localhost:8080');

        expect(result.reachable).toBe(true);
        expect(result.models).toEqual(['qwen35_distilled', 'llama3.1-70b']);
        expect(result.error).toBeUndefined();
    });

    it('should return reachable=true with empty models when /v1/models returns empty list', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ data: [] })
        });

        const result = await probeEndpoint('http://localhost:8080');

        expect(result.reachable).toBe(true);
        expect(result.models).toEqual([]);
    });

    it('should return reachable=true when /v1/models returns non-200 but server is alive', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: false,
            status: 404
        });

        const result = await probeEndpoint('http://localhost:8080');

        expect(result.reachable).toBe(true);
        expect(result.models).toEqual([]);
    });

    it('should fall back to /health when /v1/models throws', async () => {
        let callCount = 0;
        (globalThis.fetch as any).mockImplementation(async (url: string) => {
            callCount++;
            if (url.includes('/models')) {
                throw new Error('Connection reset');
            }
            if (url.includes('/health')) {
                return { ok: true };
            }
            throw new Error('Unknown');
        });

        const result = await probeEndpoint('http://localhost:8080');

        expect(result.reachable).toBe(true);
        expect(result.models).toEqual([]);
        expect(callCount).toBe(2); // /v1/models then /health
    });

    it('should return reachable=false with ECONNREFUSED error', async () => {
        const connError = new Error('fetch failed');
        (connError as any).cause = { code: 'ECONNREFUSED' };

        (globalThis.fetch as any).mockRejectedValue(connError);

        const result = await probeEndpoint('http://localhost:9999');

        expect(result.reachable).toBe(false);
        expect(result.error).toContain('Connection refused');
        expect(result.models).toEqual([]);
    });

    it('should return reachable=false with timeout error', async () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';

        (globalThis.fetch as any).mockRejectedValue(abortError);

        const result = await probeEndpoint('http://slow-server:8080', 1000);

        expect(result.reachable).toBe(false);
        expect(result.error).toContain('timed out');
        expect(result.models).toEqual([]);
    });

    it('should normalize URLs with trailing slashes', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ id: 'model-1' }] })
        });

        await probeEndpoint('http://localhost:8080/');

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://localhost:8080/v1/models',
            expect.any(Object)
        );
    });

    it('should handle URLs that already end with /v1', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ id: 'model-1' }] })
        });

        await probeEndpoint('http://localhost:8080/v1');

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://localhost:8080/v1/models',
            expect.any(Object)
        );
    });

    it('should handle malformed JSON from /v1/models gracefully', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ unexpected: 'format' })
        });

        const result = await probeEndpoint('http://localhost:8080');

        expect(result.reachable).toBe(true);
        expect(result.models).toEqual([]);
    });

    it('should skip models without an id field', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'valid-model' },
                    { name: 'no-id-model' },
                    { id: '' },
                    { id: 'another-valid' }
                ]
            })
        });

        const result = await probeEndpoint('http://localhost:8080');

        expect(result.models).toEqual(['valid-model', 'another-valid']);
    });
});
