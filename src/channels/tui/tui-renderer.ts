import chalk from 'chalk';
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui';

/**
 * Terminal rendering utilities and themes for the Tars TUI chat interface.
 */
export class TuiRenderer {
    /**
     * Render the ASCII logo in cyan.
     */
    static renderLogo(): string {
        const logo = [
            ' ████████╗ █████╗ ██████╗ ███████╗',
            ' ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝',
            '    ██║   ███████║██████╔╝███████╗',
            '    ██║   ██╔══██║██╔══██╗╚════██║',
            '    ██║   ██║  ██║██║  ██║███████║',
            '    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝'
        ];
        return logo.map((line) => chalk.cyan(line)).join('\n');
    }

    /**
     * Render the session metadata header.
     */
    static renderHeader(opts: {
        version: string;
        provider: string;
        model: string;
        contextWindow: number;
        assistantName: string;
    }): string {
        const lines = [
            chalk.dim(
                `  v${opts.version} · ${opts.provider}/${opts.model} · ${(opts.contextWindow / 1000).toFixed(0)}k context`
            ),
            '',
            chalk.dim('  Type a message to begin. /help for commands, /exit to quit.'),
            chalk.dim('  ' + '─'.repeat(56))
        ];
        return lines.join('\n');
    }

    /**
     * Tars custom SelectListTheme.
     */
    static readonly selectListTheme: SelectListTheme = {
        selectedPrefix: (text: string) => chalk.cyan(text),
        selectedText: (text: string) => chalk.cyan.bold(text),
        description: (text: string) => chalk.dim(text),
        scrollInfo: (text: string) => chalk.dim(text),
        noMatch: (text: string) => chalk.dim(text)
    };

    /**
     * Tars custom MarkdownTheme.
     */
    static readonly markdownTheme: MarkdownTheme = {
        heading: (text: string) => chalk.bold.cyan(text),
        link: (text: string) => chalk.blue.underline(text),
        linkUrl: (text: string) => chalk.dim(text),
        code: (text: string) => chalk.yellow(text),
        codeBlock: (text: string) => chalk.yellow(text),
        codeBlockBorder: (text: string) => chalk.dim(text),
        quote: (text: string) => chalk.italic.dim(text),
        quoteBorder: (text: string) => chalk.dim(text),
        hr: (_text: string) => chalk.dim('─'.repeat(40)),
        listBullet: (text: string) => chalk.cyan(text),
        bold: (text: string) => chalk.bold(text),
        italic: (text: string) => chalk.italic(text),
        strikethrough: (text: string) => chalk.strikethrough(text),
        underline: (text: string) => chalk.underline(text)
    };

    /**
     * Tars custom EditorTheme.
     */
    static readonly editorTheme: EditorTheme = {
        borderColor: (text: string) => chalk.dim(text),
        selectList: TuiRenderer.selectListTheme
    };

    /**
     * Render the token stats in the footer.
     */
    static renderFooter(tokens: number, contextLimit: number, cost: number): string {
        const percentage = ((tokens / contextLimit) * 100).toFixed(1);
        const costStr = (cost * 100).toFixed(1);
        return chalk.dim(
            `  ${tokens.toLocaleString()} / ${contextLimit.toLocaleString()} (${percentage}%) | ${costStr}%`
        );
    }

    /**
     * Format basic Markdown syntax (bold, inline code) for non-TUI fallback output.
     */
    static formatMarkdown(text: string): string {
        if (!text) return '';
        return text
            .replace(/\*\*(.*?)\*\*/g, (_, p1) => chalk.bold(p1))
            .replace(/`(.*?)`/g, (_, p1) => chalk.yellow(p1));
    }

    /**
     * Count the number of terminal lines required to display the text, accounting for wrapping.
     */
    static countLines(text: string, columns: number = 80): number {
        if (!text) return 0;
        const lines = text.split('\n');
        let count = 0;
        for (const line of lines) {
            const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
            count += Math.max(1, Math.ceil(stripped.length / columns));
        }
        return count;
    }

    /**
     * Clear the specified number of lines from the terminal.
     */
    static clearLines(stream: NodeJS.WritableStream, linesCount: number): void {
        if (linesCount <= 0) return;
        for (let i = 0; i < linesCount; i++) {
            stream.write('\x1b[A\x1b[K');
        }
    }
}
export default TuiRenderer;
