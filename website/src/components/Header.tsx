import { TarsLogo } from './TarsLogo';
import { SearchTrigger, SearchModal } from './SearchModal';
import { Github } from 'lucide-react';

export function Header() {
    return (
        <>
            <SearchModal />
            <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800">
                <div className="flex items-center justify-between h-full px-6 max-w-[1440px] mx-auto">
                    {/* Left: Logo */}
                    <a
                        href="/"
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                        <TarsLogo size={32} />
                        <span className="text-xl font-bold text-zinc-100 tracking-wide font-['Space_Grotesk']">TARS</span>
                        <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700">
                            docs
                        </span>
                    </a>

                    {/* Center: Nav */}
                    <nav className="hidden md:flex items-center gap-6">
                        <a
                            href="/getting-started/installation"
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider"
                        >
                            Get Started
                        </a>
                        <a
                            href="/architecture/supervisor"
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider"
                        >
                            Architecture
                        </a>
                        <a
                            href="/cli/process"
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider"
                        >
                            Reference
                        </a>
                    </nav>

                    {/* Right: Search + GitHub */}
                    <div className="flex items-center gap-3">
                        <SearchTrigger />
                        <a
                            href="https://github.com/agustinsacco/tars"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            <Github className="w-4 h-4" />
                        </a>
                    </div>
                </div>
            </header>
        </>
    );
}
