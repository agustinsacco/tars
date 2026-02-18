import { ChevronRight } from 'lucide-react';

interface BreadcrumbsProps {
    items: { label: string; href?: string }[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
    return (
        <nav className="flex items-center gap-1 text-xs text-zinc-500 mb-6">
            {items.map((item, i) => (
                <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-zinc-600" />}
                    {item.href ? (
                        <a href={item.href} className="hover:text-zinc-300 transition-colors">
                            {item.label}
                        </a>
                    ) : (
                        <span className="text-zinc-400">{item.label}</span>
                    )}
                </span>
            ))}
        </nav>
    );
}
