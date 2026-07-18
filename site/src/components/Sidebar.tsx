import { useEffect, useState, type ReactElement } from 'react';
import { acquireBodyScrollLock } from '../lib/body-scroll';
import { dispatchMobileMenu, MOBILE_MENU_EVENT, readMobileMenuState } from '../lib/events';
import { NAV_SECTIONS, normalizePath } from '../lib/navigation';

interface SidebarProps {
    currentPath: string;
}

export function Sidebar({ currentPath }: SidebarProps): ReactElement {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleToggle = (event: Event): void => {
            const open = readMobileMenuState(event);
            if (open !== null) setIsOpen(open);
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            setIsOpen(false);
            dispatchMobileMenu(false);
        };
        window.addEventListener(MOBILE_MENU_EVENT, handleToggle);
        window.addEventListener('keydown', handleKeyDown);
        return (): void => {
            window.removeEventListener(MOBILE_MENU_EVENT, handleToggle);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    useEffect((): (() => void) | undefined => {
        if (!isOpen) return undefined;
        return acquireBodyScrollLock();
    }, [isOpen]);

    const current = normalizePath(currentPath);

    const closeMenu = (): void => {
        setIsOpen(false);
        dispatchMobileMenu(false);
    };

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden mt-14"
                    onClick={closeMenu}
                />
            )}

            <aside
                id="docs-sidebar"
                className={`
          fixed lg:sticky top-14 h-[calc(100vh-3.5rem)] z-40
          w-64 shrink-0 bg-[#050505] lg:bg-transparent
          border-r border-zinc-900 lg:border-zinc-800
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible lg:translate-x-0'}
          overflow-y-auto py-6 px-4
        `}
            >
                <nav aria-label="Documentation" className="space-y-6">
                    {NAV_SECTIONS.map((section) => (
                        <div key={section.category}>
                            <h3 className="text-[11px] font-bold text-text-secondary uppercase tracking-widest mb-2 px-2">
                                {section.category}
                            </h3>
                            <ul className="space-y-0.5">
                                {section.items.map((item) => {
                                    const isActive = normalizePath(item.href) === current;
                                    return (
                                        <li key={item.href}>
                                            <a
                                                href={item.href}
                                                onClick={closeMenu}
                                                aria-current={isActive ? 'page' : undefined}
                                                className={`
                            block px-2 py-1.5 text-[13px] rounded-sm transition-colors cursor-pointer
                            ${
                                isActive
                                    ? 'text-blue-400 bg-blue-500/5 border-l-2 border-blue-400 pl-[calc(0.5rem-2px)]'
                                    : 'text-text-secondary hover:text-zinc-200 hover:bg-zinc-800/30 border-l-2 border-transparent pl-[calc(0.5rem-2px)]'
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
        </>
    );
}
