import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentProcessor, type RemoteAttachment } from '../../utils/attachment-processor.js';

const BASE_ATTACHMENT: RemoteAttachment = {
    id: 'attachment-id',
    name: 'report.txt',
    url: 'https://cdn.discordapp.com/attachments/channel/message/report.txt',
    size: 5,
    contentType: 'text/plain'
};

describe('AttachmentProcessor', () => {
    let homeDir: string;
    let processor: AttachmentProcessor;

    beforeEach(() => {
        homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-attachment-test-'));
        processor = new AttachmentProcessor({ homeDir });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        fs.rmSync(homeDir, { recursive: true, force: true });
    });

    it('rejects non-Discord hosts before issuing a request', async () => {
        // ARRANGE
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        // ACT / ASSERT
        await expect(
            processor.download({ ...BASE_ATTACHMENT, url: 'https://example.com/report.txt' })
        ).rejects.toThrow('approved Discord CDN');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects attachments whose declared size exceeds the limit', async () => {
        // ARRANGE
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        // ACT / ASSERT
        await expect(
            processor.download({ ...BASE_ATTACHMENT, size: 25 * 1024 * 1024 + 1 })
        ).rejects.toThrow('exceeds');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sanitizes filenames and writes downloaded content with private permissions', async () => {
        // ARRANGE
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('hello', {
                    status: 200,
                    headers: { 'content-length': '5' }
                })
            )
        );

        // ACT
        const destination = await processor.download({
            ...BASE_ATTACHMENT,
            name: '../../report with spaces.txt'
        });

        // ASSERT
        expect(path.basename(destination)).toBe('attachment-id-report_with_spaces.txt');
        expect(fs.readFileSync(destination, 'utf-8')).toBe('hello');
        expect(fs.statSync(destination).mode & 0o777).toBe(0o600);
    });
});
