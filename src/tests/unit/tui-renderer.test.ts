import { describe, it, expect } from 'vitest';
import { TuiRenderer } from '../../channels/tui/tui-renderer.js';

describe('TuiRenderer', () => {
    describe('renderLogo', () => {
        it('should return ASCII art containing TARS letters', () => {
            const logo = TuiRenderer.renderLogo();
            // The raw ASCII has the TARS block characters
            expect(logo).toContain('████████');
            expect(logo).toContain('╗');
            expect(logo).toContain('╚');
        });

        it('should contain multiple lines', () => {
            const logo = TuiRenderer.renderLogo();
            const lines = logo.split('\n');
            expect(lines.length).toBe(6);
        });
    });

    describe('renderHeader', () => {
        it('should include version, provider, model, and context window', () => {
            const header = TuiRenderer.renderHeader({
                version: '1.35.0',
                provider: 'google',
                model: 'gemini-2.5-flash',
                contextWindow: 128000,
                assistantName: 'Tars'
            });

            // Strip ANSI for content testing
            const stripped = header.replace(/\x1b\[[0-9;]*m/g, '');
            expect(stripped).toContain('1.35.0');
            expect(stripped).toContain('google');
            expect(stripped).toContain('gemini-2.5-flash');
            expect(stripped).toContain('128k');
            expect(stripped).toContain('/exit');
            expect(stripped).toContain('/help');
        });
    });

    describe('renderFooter', () => {
        it('should render token stats in the expected format', () => {
            const footer = TuiRenderer.renderFooter(62128, 128000, 0.625);
            const stripped = footer.replace(/\x1b\[[0-9;]*m/g, '');
            expect(stripped).toContain('62,128');
            expect(stripped).toContain('128,000');
            expect(stripped).toContain('48.5%');
            expect(stripped).toContain('62.5%');
        });

        it('should handle small token counts', () => {
            const footer = TuiRenderer.renderFooter(789, 128000, 0.6);
            const stripped = footer.replace(/\x1b\[[0-9;]*m/g, '');
            expect(stripped).toContain('789');
            expect(stripped).toContain('0.6%');
        });
    });

    describe('formatMarkdown', () => {
        it('should handle plain text unchanged', () => {
            const result = TuiRenderer.formatMarkdown('hello world');
            const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
            expect(stripped).toBe('hello world');
        });

        it('should format bold text', () => {
            const result = TuiRenderer.formatMarkdown('**bold text**');
            // Result should not contain the raw ** markers
            expect(result).not.toContain('**');
            // The text content should be preserved (strip ANSI for comparison)
            const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
            expect(stripped).toBe('bold text');
        });

        it('should format inline code', () => {
            const result = TuiRenderer.formatMarkdown('use `npm install`');
            expect(result).not.toContain('`');
        });

        it('should handle mixed formatting', () => {
            const result = TuiRenderer.formatMarkdown('This is **bold** and `code`');
            const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
            expect(stripped).toContain('bold');
            expect(stripped).toContain('code');
        });
    });

    describe('countLines', () => {
        it('should count single line correctly', () => {
            expect(TuiRenderer.countLines('hello', 80)).toBe(1);
        });

        it('should count multiple lines', () => {
            expect(TuiRenderer.countLines('line1\nline2\nline3', 80)).toBe(3);
        });

        it('should account for line wrapping', () => {
            const longLine = 'a'.repeat(160); // 160 chars in 80-width terminal = 2 lines
            expect(TuiRenderer.countLines(longLine, 80)).toBe(2);
        });

        it('should handle empty string', () => {
            expect(TuiRenderer.countLines('', 80)).toBe(0);
        });
    });
});
