export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="ln-blade" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ff2b3a" />
          <stop offset="100%" stopColor="#7a0007" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#0c0c0c" stroke="#ff2b3a" strokeWidth="1.5" />
      <path
        d="M14 44 L32 14 L50 44 Z"
        fill="url(#ln-blade)"
        stroke="#ff2b3a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 44 L50 44" stroke="#0c0c0c" strokeWidth="2.5" />
      <circle cx="22" cy="38" r="2" fill="#0c0c0c" />
      <circle cx="42" cy="38" r="2" fill="#0c0c0c" />
      <path d="M28 32 L36 32" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
