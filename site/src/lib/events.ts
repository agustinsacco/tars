export const MOBILE_MENU_EVENT = 'tars:mobile-menu-toggle';
export const SEARCH_OPEN_EVENT = 'tars:search-open';

export function dispatchMobileMenu(open: boolean): void {
    window.dispatchEvent(new CustomEvent(MOBILE_MENU_EVENT, { detail: { open } }));
}

export function readMobileMenuState(event: Event): boolean | null {
    if (!(event instanceof CustomEvent)) return null;

    const detail: unknown = event.detail;
    if (typeof detail !== 'object' || detail === null || !('open' in detail)) return null;

    return typeof detail.open === 'boolean' ? detail.open : null;
}
