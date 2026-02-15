/**
 * Core types for the Tars system
 */

export interface Task {
    id: string;
    title: string;
    prompt: string;
    schedule: string; // Cron or ISO date
    nextRun: string; // ISO date
    lastRun?: string; // ISO date
    enabled: boolean;
    mode: 'notify' | 'silent';
    source: 'user' | 'system';
    failedCount: number;
    createdAt: string; // ISO date
    updatedAt: string; // ISO date
}

export interface SessionMetadata {
    id: string;
    startTime: string;
    lastActive: string;
    tokenCount: number;
    interactionCount: number;
}

export interface GeminiEvent {
    type: 'tool_call' | 'tool_response' | 'text' | 'image' | 'error' | 'done';
    content?: string;
    toolName?: string;
    toolArgs?: any;
    imagePath?: string;
    error?: string;
    usageStats?: UsageStats;
}

export interface UsageStats {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
}

export type GeminiOutputHandler = (event: GeminiEvent) => void;
