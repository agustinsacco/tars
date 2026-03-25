/**
 * Agent Card builder for the Tars Swarm A2A endpoint.
 * Generates an A2A-compliant agent card describing this Tars instance.
 */

import os from 'os';
import { Config } from '../config/config.js';
import type { AgentCard, AgentCardSkill } from './types.js';

/**
 * Default skills that every Tars instance advertises.
 */
const DEFAULT_SKILLS: AgentCardSkill[] = [
    {
        id: 'general',
        name: 'General Purpose Assistant',
        description:
            'Answer questions, analyze information, draft text, and perform general reasoning tasks.',
        tags: ['general', 'reasoning', 'analysis', 'writing']
    },
    {
        id: 'coding',
        name: 'Code Generation & Review',
        description:
            'Write, review, debug, and refactor code across multiple programming languages.',
        tags: ['typescript', 'python', 'javascript', 'git', 'code-review']
    },
    {
        id: 'devops',
        name: 'DevOps & System Administration',
        description:
            'Execute shell commands, manage deployments, monitor systems, and handle infrastructure tasks.',
        tags: ['shell', 'deployment', 'docker', 'monitoring', 'ssh']
    }
];

/**
 * Builds an A2A-compliant Agent Card for this Tars instance.
 *
 * @param config The Tars Config instance
 * @param overrideUrl Optional URL override (e.g., for tunnel/public URL)
 * @returns A fully populated AgentCard object
 */
export function buildAgentCard(config: Config, overrideUrl?: string): AgentCard {
    const hostname = os.hostname();
    const port = config.swarm.port;
    const baseUrl = overrideUrl || `http://${hostname}:${port}`;

    // Merge default skills with any user-configured skills
    const skills: AgentCardSkill[] = [...DEFAULT_SKILLS];

    if (config.swarm.skills.length > 0) {
        // User-configured skills override defaults with same id
        const userSkills: AgentCardSkill[] = config.swarm.skills.map((skill) => ({
            id: skill,
            name: skill.charAt(0).toUpperCase() + skill.slice(1),
            description: `Specialized in ${skill}`,
            tags: [skill]
        }));

        // Add user skills that don't overlap with defaults
        const defaultIds = new Set(DEFAULT_SKILLS.map((s) => s.id));
        for (const us of userSkills) {
            if (!defaultIds.has(us.id)) {
                skills.push(us);
            }
        }
    }

    const description =
        config.swarm.description ||
        `${config.assistantName} — Autonomous AI assistant running on ${hostname}`;

    return {
        name: config.assistantName.toLowerCase(),
        description,
        supportedInterfaces: [
            {
                url: `${baseUrl}/a2a`,
                protocolBinding: 'JSONRPC',
                protocolVersion: '1.0'
            }
        ],
        provider: {
            organization: 'Tars Swarm'
        },
        version: '1.0.0',
        capabilities: {
            streaming: false, // Phase 1: synchronous only
            pushNotifications: false,
            stateTransitionHistory: false
        },
        securitySchemes: {
            apiKey: {
                apiKeySecurityScheme: {
                    in: 'header',
                    name: 'X-API-Key'
                }
            }
        },
        security: [{ apiKey: [] }],
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills
    };
}
