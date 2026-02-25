import { useState, useEffect } from 'react';
import { TarsLogo } from './TarsLogo';
import { SearchTrigger, SearchModal } from './SearchModal';
import { Github, Menu, X } from 'lucide-react';

export function Header() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const toggleMenu = () => {
        const newState = !isMenuOpen;
        setIsMenuOpen(newState);
        window.dispatchEvent(
            new CustomEvent('tars:mobile-menu-toggle', { detail: { open: newState } })
        );
    };

    useEffect(() => {
        const handleToggle = (e: any) => {
            if (e.detail && typeof e.detail.open === 'boolean') {
                setIsMenuOpen(e.detail.open);
            }
        };
        window.addEventListener('tars:mobile-menu-toggle', handleToggle);
        return () => window.removeEventListener('tars:mobile-menu-toggle', handleToggle);
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
                            className="p-1 -ml-1 text-zinc-400 hover:text-zinc-200 lg:hidden transition-colors"
                            aria-label="Toggle Menu"
                        >
                            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>

                        <a
                            href="/"
                            className="flex items-center gap-2 md:gap-3 hover:opacity-80 transition-opacity"
                        >
                            <TarsLogo size={28} />
                            <span className="text-lg md:text-xl font-bold text-zinc-100 tracking-wide font-['Space_Grotesk']">
                                TARS
                            </span>
                            <span className="hidden xs:inline text-[9px] text-zinc-500 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800">
                                docs
                            </span>
                        </a>
                    </div>

                    {/* Center: Nav (Desktop) */}
                    <nav className="hidden lg:flex items-center gap-6">
                        <a
                            href="/getting-started/installation"
                            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest"
                        >
                            Get Started
                        </a>
                        <a
                            href="/architecture/supervisor"
                            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest"
                        >
                            Architecture
                        </a>
                        <a
                            href="/extensions/tars-tasks"
                            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest"
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
                            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            <Github className="w-4 h-4" />
                        </a>
                    </div>
                </div>
            </header>
        </>
    );
}
