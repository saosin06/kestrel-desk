"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Approvers a person at the desk can act as ("Play the controller"). */
export const APPROVER_ROLES = ["controller", "engineering", "hr", "procurement_mgr", "receiving"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

const ActingAs = createContext<{ role: ApproverRole; setRole: (r: ApproverRole) => void }>({ role: "controller", setRole: () => {} });
export const useActingAs = () => useContext(ActingAs);

export function Providers({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<ApproverRole>("controller");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kestrel.actingAs");
      if (saved && (APPROVER_ROLES as readonly string[]).includes(saved)) setRoleState(saved as ApproverRole);
    } catch {}
  }, []);
  const value = useMemo(
    () => ({
      role,
      setRole: (r: ApproverRole) => {
        setRoleState(r);
        try {
          localStorage.setItem("kestrel.actingAs", r);
        } catch {}
      },
    }),
    [role],
  );
  return (
    <ConvexProvider client={convex}>
      <ActingAs.Provider value={value}>{children}</ActingAs.Provider>
    </ConvexProvider>
  );
}
