/**
 * Discord Message Formatter
 *
 * Transforms Gemini CLI output (GitHub Flavored Markdown)
 * into Discord-compatible formatting.
 *
 * Discord supports:
 * - Bold: **text**
 * - Italic: *text* or _text_
 * - Underline: __text__
 * - Strikethrough: ~~text~~
 * - Code inline: `text`
 * - Code block: ```lang\ncode\n```
 * - Blockquotes: > text
 * - Headers: # (only #, ##, ###)
 *
 * Discord does NOT support:
 * - Markdown tables (we instruct the LLM to avoid these)
 * - #### or deeper headers
 * - Small text (-#)
 */
export class MessageFormatter {
    private static readonly MAX_MESSAGE_LENGTH = 1990;

    /**
     * Format text for Discord
     */
    static format(text: string): string {
        if (!text) return text;

        let formatted = text;

        // Step 1: Fix broken asterisks FIRST (creates patterns that need spacing)
        formatted = this.fixAsterisks(formatted);

        // Step 2: CRITICAL - Fix spacing issues (LLM often merges words)
        formatted = this.fixSpacing(formatted);

        // Step 3: Normalize bullets (* item -> • item)
        formatted = this.normalizeBullets(formatted);

        // Step 4: Normalize headers (#### -> ### or bold)
        formatted = this.normalizeHeaders(formatted);

        // Step 5: Fix blockquotes (ensure they render properly)
        formatted = this.fixBlockquotes(formatted);

        // Step 6: Format JSON blocks in code blocks
        formatted = this.formatJsonBlocks(formatted);

        // Step 7: Strip any remaining tables (fallback if LLM still generates them)
        formatted = this.stripTables(formatted);

        // Step 8: Fix small text markers (-#) that Discord doesn't support
        formatted = this.fixSmallText(formatted);

        // Step 9: Clean up excessive whitespace
        formatted = formatted.replace(/\n{3,}/g, '\n\n');

        return formatted.trim();
    }

    /**
     * Fix critical spacing issues from LLM output
     * These are the most common formatting bugs that break Discord rendering
     */
    private static fixSpacing(text: string): string {
        let result = text;

        // 1. Ensure space AFTER closing bold before next word
        result = result.replace(/\*\*([^*]+)\*\*(?=[a-zA-Z0-9])/g, '**$1** ');

        // 2. Ensure space BEFORE opening bold after a word
        result = result.replace(/([a-zA-Z0-9])\*\*([^*]+)\*\*/g, '$1 **$2**');

        // 3. Ensure space after colon before bold
        result = result.replace(/([^*]):\*\*/g, '$1: **');

        // 4. Ensure space around middle dots
        result = result.replace(/([a-zA-Z0-9])·([a-zA-Z0-9])/g, '$1 · $2');

        // 5. Ensure DOUBLE NEWLINE before section emojis
        // This ensures headers like "📊 Signal Check" always start on a new paragraph
        // REMOVED: ✅, ❌, ⚠️, 💡, 🛡️ (often used in lists/inline)
        // KEPT: 🔍, 📊, 🧠, 📈, ⚖️, 🎯, 📋, 🔄, 📅 (Major section headers)
        const sectionEmojis = '🔍|📊|🧠|📈|⚖️|🎯|📋|🔄|📅';
        // Look for [not newline][spaces?][likely emoji] -> replace with [char]\n\n[emoji]
        result = result.replace(new RegExp(`([^\\n])\\s*(${sectionEmojis})`, 'g'), '$1\n\n$2');

        // 6. Ensure space after emojis before bold
        result = result.replace(new RegExp(`(${sectionEmojis})\\*\\*`, 'g'), '$1 **');

        // 7. Fix "set for**time**" pattern
        result = result.replace(/for\*\*/g, 'for **');

        // 8. Fix bullet points that run together
        // "• Item1• Item2" -> "• Item1\n• Item2"
        // Also ensure bullets appearing in middle of text get a newline
        result = result.replace(/([^\n])\s*• /g, '$1\n• ');

        return result;
    }

    /**
     * Fix broken asterisks patterns
     * Only fixes obviously broken patterns, avoids aggressive matching
     */
    private static fixAsterisks(text: string): string {
        let result = text;

        // Fix 4+ asterisks down to 2 (****text**** -> **text**)
        result = result.replace(/\*{4,}(.+?)\*{4,}/g, '**$1**');

        // Fix trailing-only ** at end of line (text** -> **text**)
        // Only applies when line starts with a letter/number (no leading **)
        // AND has exactly trailing ** (indicative of broken bold)
        result = result.replace(/^([^*\n][^*]*)(\*\*)$/gm, (match, content, trail) => {
            // Check if content already has opening ** - skip if so
            if (content.includes('**')) return match;
            return `**${content.trim()}**`;
        });

        // Fix: Close unclosed bold tags at start of line (**Text -> **Text**)
        result = result.replace(/^(\*\*[^*]+?)(?<!\*\*)(\s*[:.,!?-]?)$/gm, (match, content, punct) => {
            // If already closed, don't touch
            if (content.trim().endsWith('**')) return match;
            return `${content.trim()}${punct}**`;
        });

        // Also handle cases specifically ending with punctuation on the line
        result = result.replace(/^(\*\*[^*]+)(?=\s*([:.,!?-]))/gm, (match, content, punct) => {
            if (match.endsWith('**')) return match;
            // Regex lookahead logic is tricky here, simplifiying:
            // The previous regex fixes the EOL case.
            // This regex handles mid-line punctuation if we want to support it?
            // Actually, the previous regex handles `punctuation at the end of the line OR content`.
            // If we have `**Header: content`, the first regex won't catch it unless it matches newline?
            // Let's rely on the first regex which is robust for EOL.
            // For mid-line, if there's no closing `**`, it's hard to guess where it ends.
            // So we'll skip this second aggressive block to avoid regressions.
            return match;
        });

        return result;
    }

    /**
     * Normalize bullet points for Discord
     */
    private static normalizeBullets(text: string): string {
        return (
            text
                // Convert "* item" to "• item" (but not inside code blocks)
                .replace(/^(\s*)\* /gm, '$1• ')
                // Convert "- item" that's not a separator line or subtext
                .replace(/^(\s*)- (?![-#]+)/gm, '$1• ')
        );
    }

    /**
     * Normalize markdown headers to Discord-friendly format
     * Discord supports #, ##, ### natively now.
     */
    private static normalizeHeaders(text: string): string {
        return (
            text
                // Ensure space after hashes
                .replace(/^(#{1,3})(?=[^#\s])/gm, '$1 ')
                // Convert #### and deeper to bold
                .replace(/^#{4,}\s+(.+)$/gm, '**$1**')
        );
    }

    /**
     * Fix blockquote formatting
     */
    private static fixBlockquotes(text: string): string {
        const lines = text.split('\n');
        const result: string[] = [];
        let inBlockquote = false;

        for (const line of lines) {
            if (line.startsWith('> ')) {
                inBlockquote = true;
                result.push(line);
            } else if (line.startsWith('>') && line.length === 1) {
                // Empty blockquote line - skip it
                continue;
            } else if (inBlockquote && line.trim() === '') {
                inBlockquote = false;
                result.push(line);
            } else {
                inBlockquote = false;
                result.push(line);
            }
        }

        return result.join('\n');
    }

    /**
     * Detect and wrap JSON-like content in code blocks
     */
    private static formatJsonBlocks(text: string): string {
        if (text.includes('```json') || text.includes('```\n{')) {
            return text;
        }

        const jsonPattern = /(?:^|\n)([\[{][\s\S]*?[\]}])(?=\n|$)/g;

        return text.replace(jsonPattern, (match, json) => {
            try {
                const trimmed = json.trim();
                if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 20) {
                    const parsed = JSON.parse(trimmed);
                    const pretty = JSON.stringify(parsed, null, 2);
                    return '\n```json\n' + pretty + '\n```';
                }
            } catch {
                // Not valid JSON
            }
            return match;
        });
    }

    /**
     * Strip markdown tables - they don't render well on mobile Discord
     * This is a fallback; the LLM should be instructed not to generate tables
     */
    private static stripTables(text: string): string {
        // Detect table patterns and convert to simple list
        const lines = text.split('\n');
        const result: string[] = [];
        let inTable = false;
        let tableRows: string[][] = [];

        for (const line of lines) {
            // Check if this is a table separator line (|---|---|)
            if (line.match(/^\|?\s*[-:]+[-:\s|]*\|?\s*$/)) {
                inTable = true;
                continue;
            }

            // Check if this is a table row
            if (line.includes('|') && (line.startsWith('|') || line.match(/\w+\s*\|/))) {
                inTable = true;
                const cells = line
                    .split('|')
                    .map((c) => c.trim())
                    .filter((c) => c.length > 0);
                if (cells.length > 0) {
                    tableRows.push(cells);
                }
                continue;
            }

            // End of table - convert to list
            if (inTable && tableRows.length > 0) {
                // First row is usually header
                const header = tableRows[0];
                const dataRows = tableRows.slice(1);

                for (const row of dataRows) {
                    const parts: string[] = [];
                    for (let i = 0; i < row.length && i < header.length; i++) {
                        if (i === 0) {
                            parts.push(`**${row[i]}**`);
                        } else {
                            parts.push(row[i]);
                        }
                    }
                    result.push(`• ${parts.join(' · ')}`);
                }

                tableRows = [];
                inTable = false;
            }

            result.push(line);
        }

        // Handle any remaining table at end of text
        if (tableRows.length > 0) {
            const header = tableRows[0];
            const dataRows = tableRows.slice(1);

            for (const row of dataRows) {
                const parts: string[] = [];
                for (let i = 0; i < row.length && i < header.length; i++) {
                    if (i === 0) {
                        parts.push(`**${row[i]}**`);
                    } else {
                        parts.push(row[i]);
                    }
                }
                result.push(`• ${parts.join(' · ')}`);
            }
        }

        return result.join('\n');
    }

    /**
     * Fix small text markers (-#) that Discord doesn't support
     */
    private static fixSmallText(text: string): string {
        // Convert -# prefix to regular text or remove it
        return text.replace(/^-#\s*/gm, '');
    }

    /**
     * Split long messages into Discord-safe chunks intelligently
     * Respects semantic boundaries: headers, code blocks, paragraphs
     */
    static split(text: string, maxLength: number = this.MAX_MESSAGE_LENGTH): string[] {
        if (text.length <= maxLength) return [text];

        const chunks: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }

            // Find the best semantic split point
            const splitIndex = this.findSemanticSplitPoint(remaining, maxLength);

            chunks.push(remaining.substring(0, splitIndex).trim());
            remaining = remaining.substring(splitIndex).trim();
        }

        return chunks;
    }

    /**
     * Find the optimal split point respecting semantic boundaries
     * Priority: Header > Code block boundary > Paragraph > Sentence > Hard cut
     */
    private static findSemanticSplitPoint(text: string, maxLength: number): number {
        // 1. Try to split BEFORE a markdown header (## or ###)
        const headerPattern = /\n(##+ )/g;
        let match: RegExpExecArray | null;
        let lastHeaderBefore = -1;

        while ((match = headerPattern.exec(text)) !== null) {
            const pos = match.index;
            if (pos > maxLength) break;
            if (pos > maxLength / 2) {
                lastHeaderBefore = pos;
                break;
            }
        }

        if (lastHeaderBefore > maxLength / 2) {
            return lastHeaderBefore;
        }

        // 2. Try to split AFTER a complete code block
        const codeBlockEndPattern = /```\n/g;
        let lastCodeEnd = -1;

        while ((match = codeBlockEndPattern.exec(text)) !== null) {
            const pos = match.index + match[0].length;
            if (pos > maxLength) break;
            if (pos > maxLength / 2) {
                lastCodeEnd = pos;
                break;
            }
        }

        if (lastCodeEnd > maxLength / 2) {
            return lastCodeEnd;
        }

        // 3. Try to split at paragraph boundary (double newline)
        let splitIndex = text.lastIndexOf('\n\n', maxLength);
        if (splitIndex > maxLength / 2) {
            return splitIndex + 2;
        }

        // 4. Try to split at single newline
        splitIndex = text.lastIndexOf('\n', maxLength);
        if (splitIndex > maxLength / 3) {
            return splitIndex + 1;
        }

        // 5. Try to split at sentence boundary (. followed by space)
        splitIndex = text.lastIndexOf('. ', maxLength);
        if (splitIndex > maxLength / 3) {
            return splitIndex + 2;
        }

        // 6. Last resort: hard cut at maxLength
        return maxLength;
    }

    /**
     * Format and split in one operation
     * Ensures summary line (first line with actionable emoji) stays at the top
     */
    static formatAndSplit(text: string): string[] {
        const formatted = this.format(text);

        // If text fits in one message, no special handling needed
        if (formatted.length <= this.MAX_MESSAGE_LENGTH) {
            return [formatted];
        }

        // Extract summary line (first line starting with key emoji)
        const { summary, rest } = this.extractSummaryLine(formatted);

        // Split the remaining content
        const chunks = this.split(rest);

        // If we found a summary, prepend it to the first chunk
        if (summary && chunks.length > 0) {
            // Check if adding summary would exceed limit
            const firstChunkWithSummary = `${summary}\n\n${chunks[0]}`;
            if (firstChunkWithSummary.length <= this.MAX_MESSAGE_LENGTH) {
                chunks[0] = firstChunkWithSummary;
            } else {
                // Summary + first chunk too long, send summary as its own message
                chunks.unshift(summary);
            }
        }

        return chunks;
    }

    /**
     * Extract the summary line from the beginning of formatted text
     * Summary lines start with key actionable emojis: 🎯 ⚖️ 📊 ⚠️ ✅ ❓
     */
    private static extractSummaryLine(text: string): { summary: string | null; rest: string } {
        const lines = text.split('\n');
        const summaryEmojis = ['🎯', '⚖️', '📊', '⚠️', '✅', '❓', '❌'];

        // Check first few lines for summary pattern
        for (let i = 0; i < Math.min(3, lines.length); i++) {
            const line = lines[i].trim();

            // Check if line starts with a summary emoji
            if (summaryEmojis.some((emoji) => line.startsWith(emoji))) {
                // Found summary line - extract it and return rest
                const summary = line;
                const restLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
                const rest = restLines.join('\n').trim();
                return { summary, rest };
            }

            // Also check for bold emoji pattern: **🎯 or similar
            if (line.match(/^\*\*[🎯⚖️📊⚠️✅❓❌]/)) {
                const summary = line;
                const restLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
                const rest = restLines.join('\n').trim();
                return { summary, rest };
            }
        }

        return { summary: null, rest: text };
    }

    /**
     * Parse markdown into sections based on headers (##)
     */
    static parseSections(text: string): { title: string; content: string }[] {
        const sections: { title: string; content: string }[] = [];
        const lines = text.split('\n');

        let currentTitle = 'Summary';
        let currentContent: string[] = [];

        for (const line of lines) {
            const headerMatch = line.match(/^##\s+(.+)$/);
            if (headerMatch) {
                if (currentContent.length > 0 || currentTitle !== 'Summary') {
                    sections.push({
                        title: currentTitle,
                        content: currentContent.join('\n').trim()
                    });
                }
                currentTitle = headerMatch[1];
                currentContent = [];
            } else {
                currentContent.push(line);
            }
        }

        if (currentContent.length > 0 || sections.length === 0) {
            sections.push({
                title: currentTitle,
                content: currentContent.join('\n').trim()
            });
        }

        return sections;
    }

    /**
     * Format a data object as a clean Discord-friendly list
     */
    static formatDataAsEmbed(title: string, data: Record<string, unknown>): string {
        const lines = [`**${title}**`];

        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'object') {
                lines.push(`• **${key}:** \`${JSON.stringify(value)}\``);
            } else {
                lines.push(`• **${key}:** ${value}`);
            }
        }

        return lines.join('\n');
    }
}
