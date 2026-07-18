let activeLocks = 0;
let originalOverflow: string | null = null;

function noOp(): void {}

export function acquireBodyScrollLock(): () => void {
    if (typeof document === 'undefined') return noOp;

    if (activeLocks === 0) {
        originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    activeLocks += 1;

    let released = false;
    return (): void => {
        if (released) return;
        released = true;
        activeLocks -= 1;
        if (activeLocks > 0) return;

        document.body.style.overflow = originalOverflow ?? '';
        originalOverflow = null;
    };
}
