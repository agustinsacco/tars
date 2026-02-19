import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchResult {
    title: string;
    href: string;
    section: string;
}

const ALL_PAGES: SearchResult[] = [
    { title: 'Introduction', href: '/', section: 'Get Started' },
    { title: 'Installation', href: '/getting-started/installation', section: 'Get Started' },
    { title: 'Setup Wizard', href: '/getting-started/setup', section: 'Get Started' },
    { title: 'Discord Integration', href: '/getting-started/discord', section: 'Get Started' },
    { title: 'Supervisor', href: '/architecture/supervisor', section: 'Architecture' },
    { title: 'Gemini CLI Wrapper', href: '/architecture/gemini-cli', section: 'Architecture' },
    { title: 'Session Management', href: '/architecture/sessions', section: 'Architecture' },
    { title: 'Configuration', href: '/architecture/configuration', section: 'Architecture' },
    { title: 'Heartbeat Service', href: '/systems/heartbeat', section: 'Systems' },
    { title: 'Task Scheduling', href: '/systems/tasks', section: 'Systems' },
    { title: 'Memory & Knowledge', href: '/systems/memory', section: 'Systems' },
    { title: 'MCP Extensions', href: '/extensions/overview', section: 'Extensions' },
    { title: 'tars-tasks Extension', href: '/extensions/tars-tasks', section: 'Extensions' },
    { title: 'Skills System', href: '/extensions/skills', section: 'Extensions' },
    { title: 'Self-Modification', href: '/extensions/self-modification', section: 'Extensions' },
    { title: 'Process Management', href: '/cli/process', section: 'CLI Reference' },
    { title: 'Secrets Management', href: '/cli/secrets', section: 'CLI Reference' },
    { title: 'Memory CLI', href: '/cli/memory', section: 'CLI Reference' },
    { title: 'Brain Portability', href: '/cli/portability', section: 'CLI Reference' }
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
            className="flex items-center justify-between w-64 px-3 py-1.5 text-xs text-zinc-500 bg-zinc-900/50 border border-zinc-800 rounded-md hover:border-zinc-700 hover:text-zinc-400 transition-colors cursor-pointer"
        >
            <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                <span>Search</span>
            </div>
            <kbd className="text-[10px] bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700">
                ⌘K
            </kbd>
        </button>
    );
}
