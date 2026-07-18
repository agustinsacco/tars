import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactElement
} from 'react';
import { Search, X } from 'lucide-react';
import { acquireBodyScrollLock } from '../lib/body-scroll';
import { SEARCH_OPEN_EVENT } from '../lib/events';
import { SEARCH_PAGES, type SearchPage } from '../lib/navigation';

export function SearchModal(): ReactElement | null {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const isOpenRef = useRef(false);

    const open = (): void => {
        if (isOpenRef.current) return;
        isOpenRef.current = true;
        previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setIsOpen(true);
    };

    const close = (): void => {
        if (!isOpenRef.current) return;
        isOpenRef.current = false;
        setIsOpen(false);
        setQuery('');
        window.requestAnimationFrame((): void => previousFocusRef.current?.focus());
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                open();
            }
            if (event.key === 'Escape' && isOpenRef.current) {
                close();
            }
        };
        const handleOpen = (): void => open();

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener(SEARCH_OPEN_EVENT, handleOpen);
        return (): void => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener(SEARCH_OPEN_EVENT, handleOpen);
        };
    }, []);

    useEffect((): (() => void) | undefined => {
        if (!isOpen) return undefined;
        inputRef.current?.focus();
        return acquireBodyScrollLock();
    }, [isOpen]);

    const filtered = useMemo((): readonly SearchPage[] => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return SEARCH_PAGES;

        return SEARCH_PAGES.filter((page): boolean => {
            const searchable = [page.title, page.section, page.summary, ...(page.keywords ?? [])]
                .join(' ')
                .toLowerCase();
            return searchable.includes(normalizedQuery);
        });
    }, [query]);

    const containFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Tab' || !dialogRef.current) return;
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled])'
        );
        if (focusable.length === 0) return;

        const first = focusable.item(0);
        const last = focusable.item(focusable.length - 1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
            onMouseDown={close}
        >
            <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="search-dialog-title"
                onKeyDown={containFocus}
                className="relative w-full max-w-xl bg-[#0e0e10] border border-zinc-800 rounded-lg shadow-2xl overflow-hidden"
                onMouseDown={(event): void => event.stopPropagation()}
            >
                {/* Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
                    <Search className="w-4 h-4 text-text-secondary shrink-0" />
                    <span id="search-dialog-title" className="sr-only">
                        Search documentation
                    </span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search docs..."
                        aria-label="Search documentation"
                        aria-controls="search-results"
                        className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-text-muted outline-none"
                    />
                    <button
                        type="button"
                        onClick={close}
                        aria-label="Close search"
                        className="rounded p-1 text-text-secondary hover:text-zinc-200"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Results */}
                <p className="sr-only" aria-live="polite">
                    {filtered.length} documentation result{filtered.length === 1 ? '' : 's'}
                </p>
                <div id="search-results" className="max-h-80 overflow-y-auto p-2">
                    {filtered.length === 0 ? (
                        <p className="py-8 text-center text-sm text-text-secondary">
                            No results found
                        </p>
                    ) : (
                        filtered.map((result) => (
                            <a
                                key={result.href}
                                href={result.href}
                                className="flex items-center justify-between px-3 py-2 rounded text-sm text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 transition-colors"
                            >
                                <span>{result.title}</span>
                                <span className="text-[10px] text-text-muted uppercase tracking-wider">
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

export function SearchTrigger(): ReactElement {
    return (
        <button
            type="button"
            onClick={(): void => {
                window.dispatchEvent(new Event(SEARCH_OPEN_EVENT));
            }}
            aria-label="Search documentation"
            className="flex items-center justify-between w-full md:w-64 px-2 md:px-3 py-1.5 text-xs text-text-secondary bg-zinc-950 md:bg-zinc-900/50 border border-zinc-800 rounded-md hover:border-zinc-700 hover:text-zinc-400 transition-colors cursor-pointer"
        >
            <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xs:inline">Search</span>
            </div>
            <kbd className="hidden md:inline text-[10px] bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700">
                ⌘/Ctrl K
            </kbd>
        </button>
    );
}
