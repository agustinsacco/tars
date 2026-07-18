import { useEffect, useState, type ReactElement } from 'react';
import { TarsLogo } from './TarsLogo';
import { SearchTrigger, SearchModal } from './SearchModal';
import { Code2, Menu, X } from 'lucide-react';
import { dispatchMobileMenu, MOBILE_MENU_EVENT, readMobileMenuState } from '../lib/events';

export function Header(): ReactElement {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const toggleMenu = (): void => {
        const newState = !isMenuOpen;
        setIsMenuOpen(newState);
        dispatchMobileMenu(newState);
    };

    useEffect(() => {
        const handleToggle = (event: Event): void => {
            const open = readMobileMenuState(event);
            if (open !== null) setIsMenuOpen(open);
        };
        window.addEventListener(MOBILE_MENU_EVENT, handleToggle);
        return (): void => window.removeEventListener(MOBILE_MENU_EVENT, handleToggle);
    }, []);

    return (
        <>
            <SearchModal />
            <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#050505]/95 backdrop-blur-md border-b border-zinc-900">
                <div className="flex items-center justify-between h-full px-4 md:px-6 max-w-[1440px] mx-auto">
                    {/* Left: Hamburger + Logo */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleMenu}
                            className="p-1 -ml-1 text-zinc-400 hover:text-zinc-200 lg:hidden transition-colors cursor-pointer"
                            aria-label="Toggle Menu"
                            aria-expanded={isMenuOpen}
                            aria-controls="docs-sidebar"
                        >
                            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>

                        <a
                            href="/"
                            aria-label="TARS documentation home"
                            className="flex items-center gap-2 md:gap-3 hover:opacity-80 transition-opacity"
                        >
                            <TarsLogo size={28} />
                            <span className="font-display text-lg font-bold tracking-wide text-zinc-100 md:text-xl">
                                TARS
                            </span>
                            <span className="hidden xs:inline rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 text-[9px] text-text-secondary">
                                docs
                            </span>
                        </a>
                    </div>

                    {/* Center: Nav (Desktop) */}
                    <nav aria-label="Primary" className="hidden lg:flex items-center gap-6">
                        <a
                            href="/getting-started/installation"
                            className="text-[11px] text-text-secondary hover:text-zinc-300 transition-colors uppercase tracking-widest"
                        >
                            Get Started
                        </a>
                        <a
                            href="/architecture/supervisor"
                            className="text-[11px] text-text-secondary hover:text-zinc-300 transition-colors uppercase tracking-widest"
                        >
                            Architecture
                        </a>
                        <a
                            href="/extensions/tars-tasks"
                            className="text-[11px] text-text-secondary hover:text-zinc-300 transition-colors uppercase tracking-widest"
                        >
                            Extensions
                        </a>
                    </nav>

                    {/* Right: Search + GitHub */}
                    <div className="flex items-center gap-2 md:gap-3">
                        <div className="w-auto md:w-64">
                            <SearchTrigger />
                        </div>
                        <a
                            href="https://github.com/agustinsacco/tars"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="TARS repository on GitHub"
                            className="p-1 text-text-secondary hover:text-zinc-300 transition-colors"
                        >
                            <Code2 className="w-4 h-4" />
                        </a>
                    </div>
                </div>
            </header>
        </>
    );
}
