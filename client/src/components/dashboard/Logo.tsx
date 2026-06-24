// ICG inline SVG logo — concentric ring ("inner circle") with a rising bar mark.
// Geometric, single accent + currentColor, works 24px–200px.
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="Inner Circle Group"
      role="img"
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" opacity="0.55" />
      <circle cx="16" cy="16" r="3" className="fill-primary" />
    </svg>
  );
}
