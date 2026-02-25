import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchResult {
    title: string;
    href: string;
    section: string;
}

const ALL_PAGES: SearchResult[] = [
    { title: 'Home', href: '/', section: 'Get Started' },
    { title: 'Introduction', href: '/getting-started/what-is-tars', section: 'Get Started' },
    { title: 'Installation', href: '/getting-started/installation', section: 'Get Started' },
    { title: 'Quick Start', href: '/getting-started/setup', section: 'Get Started' },
    { title: 'Discord Integration', href: '/getting-started/discord', section: 'Get Started' },
    { title: 'Supervisor Engine', href: '/architecture/supervisor', section: 'Architecture' },
    { title: 'Heartbeat Protocol', href: '/architecture/heartbeat', section: 'Architecture' },
    { title: 'Core Intelligence', href: '/architecture/gemini-cli', section: 'Architecture' },
    { title: 'Configuration', href: '/architecture/configuration', section: 'Architecture' },
    { title: 'Multi-Agent', href: '/capabilities/agents', section: 'Capabilities' },
    { title: 'Persistent Memory', href: '/capabilities/memory', section: 'Capabilities' },
    { title: 'Scheduled Tasks', href: '/capabilities/automation', section: 'Capabilities' },
    { title: 'Skills System', href: '/capabilities/skills', section: 'Capabilities' },
    { title: 'MCP Extensions', href: '/capabilities/extensions', section: 'Capabilities' },
    {
        title: 'Self-Modification',
        href: '/capabilities/self-modification',
        section: 'Capabilities'
    },
    { title: 'tars-tasks Extension', href: '/extensions/tars-tasks', section: 'Extensions' },
    { title: 'tars-memory Extension', href: '/extensions/tars-memory', section: 'Extensions' },
    { title: 'Personal Assistant', href: '/use-cases/personal-assistant', section: 'Use Cases' },
    { title: 'Host Manager', href: '/use-cases/host-manager', section: 'Use Cases' },
    { title: 'Security Auditor', href: '/use-cases/security-auditor', section: 'Use Cases' },
    { title: 'DevOps Engineer', href: '/use-cases/devops-engineer', section: 'Use Cases' },
    { title: 'Multi-Instance', href: '/use-cases/multiple-instances', section: 'Use Cases' }
];

export function SearchModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(true);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
                setQuery('');
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const filtered = query.trim()
        ? ALL_PAGES.filter(
              (p) =>
                  p.title.toLowerCase().includes(query.toLowerCase()) ||
                  p.section.toLowerCase().includes(query.toLowerCase())
          )
        : ALL_PAGES;

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
            onClick={() => {
                setIsOpen(false);
                setQuery('');
            }}
        >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <div
                className="relative w-full max-w-xl bg-[#0e0e10] border border-zinc-800 rounded-lg shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
                    <Search className="w-4 h-4 text-zinc-500 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search docs..."
                        className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
                    />
                    <kbd className="text-[10px] text-zinc-600 bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700">
                        ESC
                    </kbd>
                </div>

                {/* Results */}
                <div className="max-h-80 overflow-y-auto p-2">
                    {filtered.length === 0 ? (
                        <p className="text-sm text-zinc-500 text-center py-8">No results found</p>
                    ) : (
                        filtered.map((result, i) => (
                            <a
                                key={i}
                                href={result.href}
                                className="flex items-center justify-between px-3 py-2 rounded text-sm text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 transition-colors"
                            >
                                <span>{result.title}</span>
                                <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                                    {result.section}
                                </span>
                            </a>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export function SearchTrigger() {
    return (
        <button
            onClick={() =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
            }
            className="flex items-center justify-between w-full md:w-64 px-2 md:px-3 py-1.5 text-xs text-zinc-500 bg-zinc-950 md:bg-zinc-900/50 border border-zinc-800 rounded-md hover:border-zinc-700 hover:text-zinc-400 transition-colors cursor-pointer"
        >
            <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xs:inline">Search</span>
            </div>
            <kbd className="hidden md:inline text-[10px] bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700">
                ⌘K
            </kbd>
        </button>
    );
}
