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
        /\bsk-[a-zA-Z0-9]{20,}\b/g, // OpenAI / Generic sk-
        /\bghp_[a-zA-Z0-9]{36}\b/g, // GitHub PAT
        /\bgho_[a-zA-Z0-9]{36}\b/g, // GitHub OAuth
        /\bghs_[a-zA-Z0-9]{36}\b/g, // GitHub Server
        /\bghr_[a-zA-Z0-9]{36}\b/g, // GitHub Refresh
        /\bAIza[0-9A-Za-z-_]{35}\b/g, // Google API Key
        /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key
        /\bnpm_[a-zA-Z0-9]{36}\b/g, // NPM token
        /\bxoxb-[a-zA-Z0-9-]+\b/g, // Slack Bot Token
        /\bxoxp-[a-zA-Z0-9-]+\b/g, // Slack User Token
        /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g, // JWT

        // Private Keys
        /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,

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

        let sanitized = content.replace(
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
     * Recursively scrubs secrets from an object or array
     */
    public static scrubDeep(obj: any): any {
        if (!obj) return obj;

        if (typeof obj === 'string') {
            return this.scrub(obj);
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.scrubDeep(item));
        }

        if (typeof obj === 'object') {
            const sanitized: any = {};
            for (const key in obj) {
                // Potential heuristic: skip scrubbing for known non-sensitive keys to improve performance
                sanitized[key] = this.scrubDeep(obj[key]);
            }
            return sanitized;
        }

        return obj;
    }
}
