export function TarsLogo({ size = 32 }: { size?: number }) {
    return (
        <img
            src="/logo.png"
            alt="Tars"
            width={size}
            height={size}
            style={{
                objectFit: 'contain',
                width: size,
                height: size,
                maxWidth: 'none' // Prevent prose styling from affecting it
            }}
        />
    );
}
