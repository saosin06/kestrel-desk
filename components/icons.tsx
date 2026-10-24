// Small line icons (24px grid, 1.75 stroke), hand-drawn to avoid a dependency.
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icons = {
  story: () => <Svg><path d="M4 5h16M4 10h16M4 15h10M4 20h7" /></Svg>,
  desk: () => <Svg><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>,
  approvals: () => <Svg><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></Svg>,
  cases: () => <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Svg>,
  live: () => <Svg><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></Svg>,
  rules: () => <Svg><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3" /></Svg>,
  payables: () => <Svg><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></Svg>,
  payroll: () => <Svg><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a5.5 5.5 0 0 1 3.5 5.5" /></Svg>,
  ledger: () => <Svg><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M4 21.5V4.5M8 7h8M8 11h6" /></Svg>,
  audit: () => <Svg><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Svg>,
  sources: () => <Svg><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></Svg>,
};

/** Kestrel mark: a stylized falcon-wing chevron. */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M7 19.5 16 9l9 10.5-4.5-2.5L16 22l-4.5-5Z" fill="#fff" />
    </svg>
  );
}
