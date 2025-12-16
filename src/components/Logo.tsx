export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Document background */}
      <rect
        x="6"
        y="4"
        width="24"
        height="32"
        rx="3"
        fill="hsl(var(--primary))"
      />
      
      {/* Document lines */}
      <rect x="10" y="10" width="12" height="2" rx="1" fill="hsl(var(--primary-foreground))" opacity="0.7" />
      <rect x="10" y="15" width="16" height="2" rx="1" fill="hsl(var(--primary-foreground))" opacity="0.7" />
      <rect x="10" y="20" width="10" height="2" rx="1" fill="hsl(var(--primary-foreground))" opacity="0.7" />
      <rect x="10" y="25" width="14" height="2" rx="1" fill="hsl(var(--primary-foreground))" opacity="0.7" />
      
      {/* Arrow circle background */}
      <circle cx="28" cy="28" r="10" fill="hsl(var(--background))" />
      <circle cx="28" cy="28" r="8" fill="hsl(var(--foreground))" />
      
      {/* Arrow */}
      <path
        d="M24 32L32 24M32 24H26M32 24V30"
        stroke="hsl(var(--background))"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
