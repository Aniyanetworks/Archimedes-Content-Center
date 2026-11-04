// An Archimedean spiral: radius grows evenly with the angle.
function spiralPath(turns: number, size: number): string {
  const center = size / 2;
  const step = (center - 1) / (turns * 360);
  const points: string[] = [];
  for (let degrees = 0; degrees <= turns * 360; degrees += 10) {
    const radians = (degrees * Math.PI) / 180;
    const radius = degrees * step;
    points.push(`${(center + radius * Math.cos(radians)).toFixed(2)} ${(center + radius * Math.sin(radians)).toFixed(2)}`);
  }
  return `M${points.join('L')}`;
}

export function Spiral({ className, turns = 3, strokeWidth = 2 }: { className?: string; turns?: number; strokeWidth?: number }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d={spiralPath(turns, 32)} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span
      style={{
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: 'var(--mantine-color-brand-6)',
        color: '#fff',
      }}
    >
      <Spiral turns={2.5} strokeWidth={1.8} className="brand-spiral" />
    </span>
  );
}
