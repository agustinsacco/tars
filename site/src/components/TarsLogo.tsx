interface TarsLogoProps {
    readonly size?: number;
    readonly priority?: boolean;
    readonly className?: string;
}

/**
 * The Tars mark. Small renders use the 192px asset so the header and footer do
 * not pull the full 768px source; the hero uses the original.
 */
export function TarsLogo({ size = 32, priority = false, className }: TarsLogoProps) {
    const src = size > 160 ? '/logo.png' : '/logo-192.png';
    return (
        <img
            src={src}
            alt=""
            aria-hidden="true"
            width={size}
            height={size}
            decoding="async"
            loading={priority ? 'eager' : 'lazy'}
            className={className}
            style={{
                objectFit: 'contain',
                width: size,
                height: size,
                maxWidth: 'none'
            }}
        />
    );
}
