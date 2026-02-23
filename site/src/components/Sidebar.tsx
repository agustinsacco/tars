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
            { title: 'Home', href: '/' },
            { title: 'Introduction', href: '/getting-started/what-is-tars' },
            { title: 'Installation', href: '/getting-started/installation' },
            { title: 'Quick Start', href: '/getting-started/setup' },
            { title: 'Discord Integration', href: '/getting-started/discord' }
        ]
    },
    {
        category: 'Use Cases',
        items: [
            { title: 'Personal Assistant', href: '/use-cases/personal-assistant' },
            { title: 'Host Manager', href: '/use-cases/host-manager' },
            { title: 'Security Auditor', href: '/use-cases/security-analyzer' },
            { title: 'DevOps Engineer', href: '/use-cases/devops-engineer' },
            { title: 'Multi-Instance', href: '/use-cases/multiple-instances' }
        ]
    },
    {
        category: 'Capabilities',
        items: [
            { title: 'Persistent Memory', href: '/capabilities/memory' },
            { title: 'Scheduled Tasks', href: '/capabilities/automation' },
            { title: 'MCP Extensions', href: '/capabilities/extensions' },
            { title: 'Self-Modification', href: '/capabilities/self-modification' }
        ]
    },
    {
        category: 'Architecture',
        items: [
            { title: 'Supervisor Engine', href: '/architecture/supervisor' },
            { title: 'Heartbeat Protocol', href: '/architecture/heartbeat' },
            { title: 'Core Intelligence', href: '/architecture/gemini-cli' },
            { title: 'Configuration', href: '/architecture/configuration' }
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
                        ${isActive
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
