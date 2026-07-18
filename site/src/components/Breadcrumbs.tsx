import { ChevronRight } from 'lucide-react';
import type { ReactElement } from 'react';

interface BreadcrumbItem {
    readonly label: string;
    readonly href?: string;
    readonly current?: boolean;
}

interface BreadcrumbsProps {
    readonly items: readonly BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps): ReactElement {
    return (
        <nav
            aria-label="Breadcrumb"
            className="mb-6 flex items-center gap-1 text-xs text-text-secondary"
        >
            {items.map((item, i) => (
                <span
                    key={`${item.label}-${item.href ?? 'label'}`}
                    className="flex items-center gap-1"
                >
                    {i > 0 && <ChevronRight className="h-3 w-3 text-text-muted" />}
                    {item.href ? (
                        <a href={item.href} className="transition-colors hover:text-zinc-300">
                            {item.label}
                        </a>
                    ) : (
                        <span
                            aria-current={item.current ? 'page' : undefined}
                            className={item.current ? 'text-zinc-300' : 'text-zinc-400'}
                        >
                            {item.label}
                        </span>
                    )}
                </span>
            ))}
        </nav>
    );
}
