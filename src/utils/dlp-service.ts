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
        // Generic High-Entropy Keys (e.g. 32-64 chars hex/base64)
        /\b[a-f0-9]{32,}\b/gi,
        /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,

        // Specific Service Patterns
        /\bsk-[a-zA-Z0-9]{20,}\b/g, // OpenAI / Generic sk-
        /\bghp_[a-zA-Z0-9]{36}\b/g, // GitHub PAT
        /\bAIza[0-9A-Za-z-_]{35}\b/g, // Google API Key
        /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g, // JWT

        // Private Keys
        /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,

        // Potential Environment Variable Assignments in files
        /(?:API_KEY|SECRET|PASSWORD|TOKEN|AUTH|CREDENTIALS)\s*[:=]\s*["']?([^"'\s]{8,})["']?/gi
    ];

    /**
     * Files or paths that should never be read by the agent
     */
    private static readonly BLACKLISTED_PATHS = [
        /\.ssh\//i,
        /\.bash_history/i,
        /\.zsh_history/i,
        /\.env$/i,
        /id_rsa/i,
        /id_ed25519/i,
        /config\.json$/i // Tars internal config
    ];

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
