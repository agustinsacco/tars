export interface NavigationItem {
    readonly title: string;
    readonly href: string;
    readonly summary: string;
    readonly keywords?: readonly string[];
}

export interface NavigationSection {
    readonly category: string;
    readonly items: readonly NavigationItem[];
}

export const NAV_SECTIONS = [
    {
        category: 'Get Started',
        items: [
            {
                title: 'Home',
                href: '/',
                summary: 'Tars documentation and project overview.'
            },
            {
                title: 'Introduction',
                href: '/getting-started/what-is-tars',
                summary: 'What Tars does, how it is positioned, and its current boundaries.'
            },
            {
                title: 'Installation',
                href: '/getting-started/installation',
                summary: 'Install Tars and verify the runtime prerequisites.'
            },
            {
                title: 'Quick Start',
                href: '/getting-started/setup',
                summary: 'Configure a provider, Discord, and the local workspace.'
            },
            {
                title: 'Discord',
                href: '/getting-started/discord',
                summary: 'Connect a Discord bot and understand owner authorization.'
            },
            {
                title: 'Customization',
                href: '/getting-started/customization',
                summary: 'Customize the prompt, skills, extensions, and assistant name.'
            }
        ]
    },
    {
        category: 'CLI',
        items: [
            {
                title: 'Process and Chat',
                href: '/cli/process',
                summary: 'Run the supervisor, inspect status, and use terminal chat.'
            },
            {
                title: 'Memory',
                href: '/cli/memory',
                summary: 'Inspect and synchronize durable memory.'
            },
            {
                title: 'Secrets',
                href: '/cli/secrets',
                summary: 'Store provider and channel credentials with the Tars CLI.'
            },
            {
                title: 'Extension Policy Audit',
                href: '/cli/extensions',
                summary: 'Audit and migrate custom MCP extension security policies.',
                keywords: ['MCP', 'envAllowlist', 'update', 'restart', 'migration']
            },
            {
                title: 'Backup and Restore',
                href: '/cli/portability',
                summary: 'Export, import, and refresh a Tars installation safely.'
            }
        ]
    },
    {
        category: 'Capabilities',
        items: [
            {
                title: 'Persistent Memory',
                href: '/capabilities/memory',
                summary: 'Store durable facts and searchable daily notes.'
            },
            {
                title: 'Scheduled Tasks',
                href: '/capabilities/automation',
                summary: 'Create explicit recurring or one-time jobs.'
            },
            {
                title: 'Local and Custom Models',
                href: '/capabilities/local-inference',
                summary: 'Connect supported cloud providers or OpenAI-compatible endpoints.'
            },
            {
                title: 'Skills',
                href: '/capabilities/skills',
                summary: 'Add local instruction packages for repeatable workflows.'
            },
            {
                title: 'MCP Extensions',
                href: '/capabilities/extensions',
                summary: 'Expose local tools through Model Context Protocol servers.'
            },
            {
                title: 'Security Model',
                href: '/capabilities/security',
                summary: 'Implemented controls, trust boundaries, and known limitations.'
            },
            {
                title: 'Execution Model',
                href: '/capabilities/agents',
                summary: 'How the single active agent and supervisor coordinate work.',
                keywords: ['agent', 'multi-agent', 'orchestration']
            },
            {
                title: 'Local Extensibility',
                href: '/capabilities/self-modification',
                summary: 'Safely edit trusted skills and MCP extensions.'
            }
        ]
    },
    {
        category: 'Architecture',
        items: [
            {
                title: 'Supervisor',
                href: '/architecture/supervisor',
                summary: 'Process lifecycle and service coordination.'
            },
            {
                title: 'Heartbeat and Cron',
                href: '/architecture/heartbeat',
                summary: 'Maintenance cadence, scheduled jobs, and idle behavior.'
            },
            {
                title: 'Engine',
                href: '/architecture/tars-engine',
                summary: 'Model requests, tool calls, events, and context handling.'
            },
            {
                title: 'Sessions',
                href: '/architecture/sessions',
                summary: 'Active-session persistence and context compression.'
            },
            {
                title: 'Configuration',
                href: '/architecture/configuration',
                summary: 'Configuration sources, precedence, validation, and paths.'
            },
            {
                title: 'Pi SDK Migration',
                href: '/architecture/pi-agent-migration',
                summary: 'Historical notes about the Pi SDK migration.'
            }
        ]
    },
    {
        category: 'Extensions',
        items: [
            {
                title: 'Tasks',
                href: '/extensions/tars-tasks',
                summary: 'Create and manage durable scheduled tasks.'
            },
            {
                title: 'Memory',
                href: '/extensions/tars-memory',
                summary: 'Store facts and search daily notes.'
            },
            {
                title: 'Search',
                href: '/extensions/tars-search',
                summary: 'Search the web and fetch public HTTP resources safely.'
            }
        ]
    },
    {
        category: 'Operational Guides',
        items: [
            {
                title: 'Personal Assistant',
                href: '/use-cases/personal-assistant',
                summary: 'Use Discord, memory, and explicit tasks for personal workflows.'
            },
            {
                title: 'Host Operations',
                href: '/use-cases/host-manager',
                summary: 'Run supervised host operations with least-privilege access.'
            },
            {
                title: 'Security Reviews',
                href: '/use-cases/security-auditor',
                summary: 'Use Tars as an analysis aid, not an autonomous security boundary.'
            },
            {
                title: 'DevOps Workflows',
                href: '/use-cases/devops-engineer',
                summary: 'Assist with explicit build, deployment, and diagnostics workflows.'
            },
            {
                title: 'Multiple Instances',
                href: '/use-cases/multiple-instances',
                summary: 'Current isolation requirements and lifecycle limitations.'
            }
        ]
    }
] as const satisfies readonly NavigationSection[];

export const NAV_ITEMS: readonly NavigationItem[] = NAV_SECTIONS.flatMap(
    (section): readonly NavigationItem[] => section.items
);

export interface SearchPage extends NavigationItem {
    readonly section: string;
}

export const SEARCH_PAGES: readonly SearchPage[] = NAV_SECTIONS.flatMap(
    (section): readonly SearchPage[] =>
        section.items.map((item): SearchPage => ({
            ...item,
            section: section.category
        }))
);

export function normalizePath(path: string): string {
    const normalized = path.replace(/\/$/, '').replace(/\/index$/, '');
    return normalized || '/';
}
