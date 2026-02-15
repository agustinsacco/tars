import { describe, it, expect } from 'vitest';
import { MessageFormatter } from '../../discord/message-formatter';

describe('MessageFormatter', () => {
    describe('format', () => {
        it('should fix spacing between bold and words', () => {
            const input = 'This is**bold**word.';
            const output = MessageFormatter.format(input);
            expect(output).toBe('This is **bold** word.');
        });

        it('should fix spacing after colon and before bold', () => {
            const input = 'Header:**Bold**';
            const output = MessageFormatter.format(input);
            expect(output).toBe('Header: **Bold**');
        });

        it('should normalize bullets', () => {
            const input = '* Item 1\n* Item 2';
            const output = MessageFormatter.format(input);
            expect(output).toBe('• Item 1\n• Item 2');
        });

        it('should normalize deep headers to bold', () => {
            const input = '#### Deep Header';
            const output = MessageFormatter.format(input);
            expect(output).toBe('**Deep Header**');
        });

        it('should wrap JSON blocks in code blocks', () => {
            const json = '{\n  "name": "Tars",\n  "status": "online"\n}';
            const output = MessageFormatter.format(json);
            expect(output).toContain('```json');
            expect(output).toContain('"name": "Tars"');
        });

        it('should strip markdown tables and convert to list', () => {
            const input = '| Heading 1 | Heading 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |';
            const output = MessageFormatter.format(input);
            expect(output).toContain('• **Cell 1** · Cell 2');
            expect(output).not.toContain('| --- |');
        });
    });

    describe('split', () => {
        it('should split long messages', () => {
            const longText = 'a'.repeat(3000);
            const chunks = MessageFormatter.split(longText, 1000);
            expect(chunks.length).toBe(3);
            expect(chunks[0].length).toBeLessThanOrEqual(1000);
        });

        it('should split at paragraph boundary if possible', () => {
            const text = 'First paragraph.\n\n' + 'a'.repeat(1980) + '\n\nSecond paragraph.';
            const chunks = MessageFormatter.split(text, 2000);
            expect(chunks.length).toBe(2);
            expect(chunks[0]).toBe('First paragraph.\n\n' + 'a'.repeat(1980));
            expect(chunks[1]).toBe('Second paragraph.');
        });
    });
});
