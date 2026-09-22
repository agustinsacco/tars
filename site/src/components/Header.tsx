import { useEffect, useState, type ReactElement } from 'react';
import { TarsLogo } from './TarsLogo';
import { SearchTrigger, SearchModal } from './SearchModal';
import { Menu, X } from 'lucide-react';
import { GitHubIcon } from './GitHubIcon';
import { dispatchMobileMenu, MOBILE_MENU_EVENT, readMobileMenuState } from '../lib/events';

interface HeaderProps {
    /** Show the mobile sidebar toggle. Off on pages without a docs sidebar. */
    readonly showMenuButton?: boolean;
}

const NAV_LINKS = [
    { label: 'Docs', href: '/getting-started/what-is-tars' },
    { label: 'Capabilities', href: '/capabilities/memory' },
    { label: 'Architecture', href: '/architecture/supervisor' },
    { label: 'Guides', href: '/use-cases/personal-assistant' }
] as const;

export function Header({ showMenuButton = true }: HeaderProps): ReactElement {
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
            <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-zinc-900 bg-[#050505]/90 backdrop-blur-md">
                <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 md:px-6">
                    <div className="flex items-center gap-3">
                        {showMenuButton && (
                            <button
                                onClick={toggleMenu}
                                className="-ml-1 cursor-pointer p-1 text-zinc-400 transition-colors hover:text-zinc-200 lg:hidden"
                                aria-label="Toggle Menu"
                                aria-expanded={isMenuOpen}
                                aria-controls="docs-sidebar"
                            >
                                {isMenuOpen ? (
                                    <X className="h-5 w-5" />
                                ) : (
                                    <Menu className="h-5 w-5" />
                                )}
                            </button>
                        )}

                        <a
                            href="/"
                            aria-label="Tars home"
                            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
                        >
                            <TarsLogo size={28} priority />
                            <span className="font-display text-lg font-bold tracking-wide text-zinc-100">
                                TARS
                            </span>
                        </a>
                    </div>

                    <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
                        {NAV_LINKS.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="text-[11px] uppercase tracking-widest text-text-secondary transition-colors hover:text-zinc-100"
                            >
                                {link.label}
                            </a>
                        ))}
                    </nav>

                    <div className="flex items-center gap-2 md:gap-3">
                        <div className="w-auto md:w-56">
                            <SearchTrigger />
                        </div>
                        <a
                            href="https://github.com/agustinsacco/tars"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Tars on GitHub"
                            className="rounded p-1.5 text-text-secondary transition-colors hover:text-zinc-100"
                        >
                            <GitHubIcon className="h-4 w-4" />
                        </a>
                    </div>
                </div>
            </header>
        </>
    );
}
