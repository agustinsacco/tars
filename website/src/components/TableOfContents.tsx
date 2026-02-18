import { useEffect, useState } from 'react';

interface Heading {
    depth: number;
    slug: string;
    text: string;
}

interface TableOfContentsProps {
    headings: Heading[];
}

export function TableOfContents({ headings }: TableOfContentsProps) {
    const [activeId, setActiveId] = useState('');

    const filteredHeadings = headings.filter((h) => h.depth >= 2 && h.depth <= 3);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id);
                    }
                }
            },
            { rootMargin: '-80px 0px -75% 0px', threshold: 0 }
        );

        filteredHeadings.forEach((h) => {
            const el = document.getElementById(h.slug);
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, [filteredHeadings]);

    if (filteredHeadings.length === 0) return null;

    return (
        <aside className="w-56 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-4 hidden xl:block">
            <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
                On this page
            </h3>
            <ul className="space-y-1 border-l border-zinc-800">
                {filteredHeadings.map((heading) => {
                    const isActive = activeId === heading.slug;
                    return (
                        <li key={heading.slug}>
                            <a
                                href={`#${heading.slug}`}
                                className={`
                  block text-xs py-1 transition-colors border-l-2 -ml-px
                  ${heading.depth === 3 ? 'pl-5' : 'pl-3'}
                  ${
                      isActive
                          ? 'text-blue-400 border-blue-400'
                          : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-600'
                  }
                `}
                            >
                                {heading.text}
                            </a>
                        </li>
                    );
                })}
            </ul>
        </aside>
    );
}
