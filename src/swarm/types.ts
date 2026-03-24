/**
 * A2A Protocol types for Tars Swarm
 * Minimal subset of the Agent-to-Agent (A2A) protocol data model.
 * @see https://a2a-protocol.org/latest/specification/
 */

// ─── JSON-RPC 2.0 ────────────────────────────────────────────

export interface JSONRPCRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: JSONRPCError;
}

export interface JSONRPCError {
    code: number;
    message: string;
    data?: unknown;
}

// Standard JSON-RPC error codes
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INTERNAL_ERROR = -32603;

// A2A-specific error codes
export const A2A_TASK_NOT_FOUND = -32001;
export const A2A_CONTENT_TYPE_NOT_SUPPORTED = -32002;
export const A2A_UNSUPPORTED_OPERATION = -32003;

// ─── A2A Data Model ───────────────────────────────────────────

export type TaskState =
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'canceled'
    | 'failed'
    | 'rejected';

export interface TaskStatus {
    state: TaskState;
    message?: Message;
    timestamp?: string;
}

export interface Part {
    text?: string;
    data?: string;
    mimeType?: string;
}

export interface Message {
    role: 'user' | 'agent';
    parts: Part[];
    metadata?: Record<string, unknown>;
}

export interface Artifact {
    name?: string;
    description?: string;
    parts: Part[];
    index?: number;
}

export interface Task {
    id: string;
    contextId?: string;
    status: TaskStatus;
    artifacts?: Artifact[];
    history?: Message[];
    metadata?: Record<string, unknown>;
}

// ─── A2A Request Params ───────────────────────────────────────

export interface SendMessageParams {
    message: Message;
    configuration?: {
        acceptedOutputModes?: string[];
        blocking?: boolean;
    };
    metadata?: Record<string, unknown>;
}

export interface TaskQueryParams {
    id: string;
    historyLength?: number;
}

export interface TaskCancelParams {
    id: string;
}

// ─── Agent Card ───────────────────────────────────────────────

export interface AgentCardSkill {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
}

export interface AgentCardCapabilities {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
}

export interface AgentCardInterface {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
}

export interface AgentCard {
    name: string;
    description: string;
    supportedInterfaces: AgentCardInterface[];
    provider?: {
        organization: string;
        url?: string;
    };
    version: string;
    capabilities: AgentCardCapabilities;
    securitySchemes: Record<string, unknown>;
    security: Array<Record<string, string[]>>;
    defaultInputModes: string[];
    defaultOutputModes: string[];
    skills: AgentCardSkill[];
}
