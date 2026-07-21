/**
 * Data Loss Prevention (DLP) Service
 *
 * Provides deterministic and pattern-based redaction of sensitive information
 * from tool outputs and agent communications.
 */
export class DLPService {
    /**
     * Common patterns for secrets and sensitive data
     */
    private static readonly SECRET_PATTERNS = [
        // Generic High-Entropy Keys
        // Tightened base64 pattern (60+ chars)
        /\b[A-Za-z0-9+/]{60,}={0,2}\b/g,

        // Specific Service Patterns
        /\bsk-[a-zA-Z0-9_-]{20,}\b/g, // OpenAI / Generic sk-, including sk-proj-
        /\bgh[pousr]_[a-zA-Z0-9_]{20,}\b/g, // GitHub tokens
        /\bAIza[0-9A-Za-z-_]{35}\b/g, // Google API Key
        /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key
        /\bnpm_[a-zA-Z0-9]{20,}\b/g, // NPM token
        /\bxoxb-[a-zA-Z0-9-]+\b/g, // Slack Bot Token
        /\bxoxp-[a-zA-Z0-9-]+\b/g, // Slack User Token
        /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g, // JWT

        // Private Keys
        /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g,

        // Environment Variable values (lookbehind for key name)
        /(?<=(?:API_KEY|SECRET|PASSWORD|TOKEN|AUTH|CREDENTIALS|PRIVATE_KEY|API_SECRET)\s*[:=]\s*["']?)[^\s"']{8,}/gi
    ];

    /**
     * Files or paths that should NEVER be read by the agent (blocks execution)
     */
    private static readonly BLACKLISTED_PATHS = [
        /\.ssh\//i,
        /\.bash_history/i,
        /\.zsh_history/i,
        /id_rsa/i,
        /id_ed25519/i
    ];

    /**
     * Files that the agent can read, but their content will be aggressively scrubbed
     */
    private static readonly SENSITIVE_PATHS = [
        /\.env$/i,
        /\.env\.\w+$/i,
        /config\.json$/i, // Tars internal config
        /secrets?\.\w+$/i
    ];

    /**
     * Scrubs sensitive patterns from an environment file content
     * Preserves keys while redacting values.
     */
    public static scrubEnvContent(content: string): string {
        if (!content || typeof content !== 'string') return content;

        const sanitized = content.replace(
            /^(\s*[A-Z_][A-Z0-9_]*\s*=\s*)(["']?)(.+?)\2\s*$/gm,
            (_, prefix, quote) => `${prefix}${quote}[REDACTED]${quote}`
        );
        return this.scrub(sanitized);
    }

    /**
     * Scrubs sensitive patterns from a string
     */
    public static scrub(content: string): string {
        if (!content || typeof content !== 'string') return content;

        let sanitized = content;
        for (const pattern of this.SECRET_PATTERNS) {
            sanitized = sanitized.replace(pattern, (match) => {
                // If it's a long match, redact most of it
                if (match.length > 8) {
                    return `[REDACTED_SECRET_${match.substring(0, 4)}...]`;
                }
                return '[REDACTED_SECRET]';
            });
        }
        return sanitized;
    }

    /**
     * Redacts sensitive object keys when content is JSON, then falls back to
     * pattern-based text redaction for ordinary output.
     */
    public static scrubTextOrJson(content: string): string {
        try {
            const parsed: unknown = JSON.parse(content);
            if (typeof parsed === 'object' && parsed !== null) {
                return JSON.stringify(this.scrubDeep(parsed));
            }
        } catch {
            // The value is plain text.
        }
        return this.scrub(content);
    }

    /**
     * Checks if a path is blacklisted
     */
    public static isPathBlacklisted(path: string): boolean {
        return this.BLACKLISTED_PATHS.some((pattern) => pattern.test(path));
    }

    /**
     * Checks if a path is sensitive where output must be aggressively scrubbed
     */
    public static isSensitivePath(path: string): boolean {
        return this.SENSITIVE_PATHS.some((pattern) => pattern.test(path));
    }

    /**
     * Identifies object keys that conventionally hold credentials. Token usage
     * metrics such as `totalInputTokens`, `maxTokens`, and `tokenCount` are
     * deliberately preserved.
     */
    public static isSensitiveKey(key: string): boolean {
        const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
        return (
            normalized.includes('apikey') ||
            normalized.includes('apisecret') ||
            normalized.includes('authorization') ||
            normalized.includes('cookie') ||
            normalized.includes('credential') ||
            normalized.includes('password') ||
            normalized.includes('privatekey') ||
            normalized.includes('secret') ||
            normalized.endsWith('token')
        );
    }

    /**
     * Recursively scrubs secrets from an object or array
     */
    public static scrubDeep(value: unknown): unknown {
        if (value === null || value === undefined) return value;

        if (typeof value === 'string') {
            try {
                const parsed: unknown = JSON.parse(value);
                if (typeof parsed === 'object' && parsed !== null) {
                    return JSON.stringify(this.scrubDeep(parsed));
                }
            } catch {
                // Ordinary strings continue through pattern-based scrubbing.
            }
            return this.scrub(value);
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.scrubDeep(item));
        }

        if (typeof value === 'object') {
            const sanitized: Record<string, unknown> = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                sanitized[key] = this.isSensitiveKey(key)
                    ? '[REDACTED_SECRET]'
                    : this.scrubDeep(nestedValue);
            }
            return sanitized;
        }

        return value;
    }
}
