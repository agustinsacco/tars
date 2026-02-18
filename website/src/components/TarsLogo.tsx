export function TarsLogo({ size = 32 }: { size?: number }) {
    const w = size;
    const h = size;
    const barWidth = w * 0.12;
    const gap = w * 0.06;
    const barHeight = h * 0.75;
    const totalBarsWidth = 4 * barWidth + 3 * gap;
    const startX = (w - totalBarsWidth) / 2;
    const startY = (h - barHeight) / 2;

    return (
        <svg
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            {[0, 1, 2, 3].map((i) => (
                <rect
                    key={i}
                    x={startX + i * (barWidth + gap)}
                    y={startY}
                    width={barWidth}
                    height={barHeight}
                    rx={1}
                    fill="#e4e4e7"
                />
            ))}
            <circle
                cx={w * 0.72}
                cy={h * 0.22}
                r={w * 0.06}
                fill="none"
                stroke="#60a5fa"
                strokeWidth={1.5}
            />
        </svg>
    );
}
