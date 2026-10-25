"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";
import { APPROVER_ROLES, useActingAs } from "@/app/providers";
import { api } from "@/convex/_generated/api";
import { date, roleLabel } from "@/lib/ui/format";
import { Icons, Logo } from "./icons";

type NavItem = { href: string; label: string; icon: keyof typeof Icons; badge?: "approvals" | "cases" };
// Ordered as a judge's tour: the story, the work, the proof, then the records behind it.
// /desk still exists but is off the nav (the story page covers it).
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "", items: [{ href: "/", label: "Story", icon: "story" }, { href: "/cases", label: "Cases", icon: "cases", badge: "cases" }, { href: "/approvals", label: "Approvals", icon: "approvals", badge: "approvals" }, { href: "/intake", label: "Try it live", icon: "live" }] },
  { group: "Proof", items: [{ href: "/rules", label: "Learned rules", icon: "rules" }, { href: "/scorecard", label: "Scorecard", icon: "score" }] },
  { group: "Records", items: [{ href: "/payables", label: "Payables", icon: "payables" }, { href: "/payroll", label: "Payroll", icon: "payroll" }, { href: "/ledger", label: "General ledger", icon: "ledger" }, { href: "/audit", label: "Audit log", icon: "audit" }, { href: "/sources", label: "Data sources", icon: "sources" }] },
];

type Counts = { pendingApprovals?: number; openCases?: number } | undefined;

function NavList({ path, counts }: { path: string | null; counts: Counts }) {
  const active = (href: string) => path !== null && (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      {NAV.map((g, gi) => (
        <div key={gi} className="mb-4">
          {g.group && <div className="px-3 pb-1.5 text-[11.5px] font-medium text-muted">{g.group}</div>}
          {g.items.map((it) => {
            const n = it.badge === "approvals" ? counts?.pendingApprovals : it.badge === "cases" ? counts?.openCases : undefined;
            const Icon = Icons[it.icon];
            const on = active(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`mb-1 flex items-center gap-3 rounded-[10px] px-3 py-[9px] text-[14px] no-underline hover:no-underline ${on ? "bg-[var(--accent)] font-medium text-white shadow-[0_6px_18px_rgba(99,89,233,0.35)]" : "text-ink-2 hover:bg-[var(--neutral-bg)] hover:text-ink"}`}
              >
                <span className={on ? "text-white" : "text-muted"}><Icon /></span>
                <span className="flex-1">{it.label}</span>
                {n ? <span className={`num rounded-full px-1.5 text-[11.5px] ${on ? "bg-white/20 text-white" : "bg-[var(--neutral-bg)] text-ink-2"}`}>{n}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function ResetButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      title="Reload the saved agent run (the state the demo starts from)"
      onClick={async () => {
        if (!window.confirm("Reset the desk to the saved agent run? Live intakes and decisions made since will be cleared.")) return;
        setBusy(true);
        try {
          await fetch("/api/reset", { method: "POST" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}

function ActiveNav({ counts }: { counts: Counts }) {
  return <NavList path={usePathname()} counts={counts} />;
}

export function Shell({ children }: { children: ReactNode }) {
  const overview = useQuery(api.desk.overview);
  const { role, setRole } = useActingAs();
  const period = overview?.simDate?.slice(0, 7);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col rounded-r-[20px] bg-panel">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <Logo />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Kestrel</div>
            <div className="text-[12px] text-muted">Disbursements desk</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-1">
          <Suspense fallback={<NavList path={null} counts={overview} />}>
            <ActiveNav counts={overview} />
          </Suspense>
        </nav>
        <div className="m-3 rounded-[14px] bg-[var(--warn-bg)] px-3 py-2.5 text-[12px] leading-snug text-[var(--warn)]">
          <div className="font-semibold">Simulated company</div>
          Kestrel Aerial is fictional. Tax tables, tariffs and FX rates are real and cited.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 bg-[rgba(20,19,50,0.82)] px-8 backdrop-blur">
          <div className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <span className="font-medium text-ink">Kestrel Aerial, Inc.</span>
            <span className="text-line-strong">·</span>
            <span>FY2026</span>
            <span className="text-line-strong">·</span>
            <span>{period ? `${date(period)} open` : "—"}</span>
            <span className="text-line-strong">·</span>
            <span>As of {date(overview?.simDate)}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ResetButton />
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Acting as
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as (typeof APPROVER_ROLES)[number])}>
                {APPROVER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
