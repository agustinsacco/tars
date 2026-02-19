interface NavItem {
    title: string;
    href: string;
}

interface NavSection {
    category: string;
    items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
    {
        category: 'Get Started',
        items: [
            { title: 'Introduction', href: '/' },
            { title: 'Installation', href: '/getting-started/installation' },
            { title: 'Setup Wizard', href: '/getting-started/setup' },
            { title: 'Discord Integration', href: '/getting-started/discord' }
        ]
    },
    {
        category: 'Architecture',
        items: [
            { title: 'Supervisor', href: '/architecture/supervisor' },
            { title: 'Gemini CLI Wrapper', href: '/architecture/gemini-cli' },
            { title: 'Session Management', href: '/architecture/sessions' },
            { title: 'Configuration', href: '/architecture/configuration' }
        ]
    },
    {
        category: 'Autonomous Systems',
        items: [
            { title: 'Heartbeat Service', href: '/systems/heartbeat' },
            { title: 'Task Scheduling', href: '/systems/tasks' },
            { title: 'Memory & Knowledge', href: '/systems/memory' }
        ]
    },
    {
        category: 'Extensibility',
        items: [
            { title: 'MCP Extensions', href: '/extensions/overview' },
            { title: 'tars-tasks Extension', href: '/extensions/tars-tasks' },
            { title: 'Skills System', href: '/extensions/skills' },
            { title: 'Self-Modification', href: '/extensions/self-modification' }
        ]
    },
    {
        category: 'CLI Reference',
        items: [
            { title: 'Process Management', href: '/cli/process' },
            { title: 'Secrets Management', href: '/cli/secrets' },
            { title: 'Memory CLI', href: '/cli/memory' },
            { title: 'Brain Portability', href: '/cli/portability' }
        ]
    }
];

interface SidebarProps {
    currentPath: string;
}

export function Sidebar({ currentPath }: SidebarProps) {
    const normalize = (p: string) => {
        let clean = p.replace(/\/$/, '').replace(/\/index$/, '');
        return clean || '/';
    };

    const current = normalize(currentPath);

    return (
        <aside className="w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-zinc-800 py-6 px-4 hidden lg:block">
            <nav className="space-y-6">
                {NAV_SECTIONS.map((section) => (
                    <div key={section.category}>
                        <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2 px-2">
                            {section.category}
                        </h3>
                        <ul className="space-y-0.5">
                            {section.items.map((item) => {
                                const isActive = normalize(item.href) === current;
                                return (
                                    <li key={item.href}>
                                        <a
                                            href={item.href}
                                            className={`
                        block px-2 py-1.5 text-[13px] rounded-sm transition-colors
                        ${
                            isActive
                                ? 'text-blue-400 bg-blue-500/5 border-l-2 border-blue-400 pl-[calc(0.5rem-2px)]'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 border-l-2 border-transparent pl-[calc(0.5rem-2px)]'
                        }
                      `}
                                        >
                                            {item.title}
                                        </a>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>
        </aside>
    );
}
