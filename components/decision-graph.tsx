"use client";

// The decision as a graph: seat → records it read → rule → finding → requests → people who decide.
// Plain SVG on a fixed grid (no layout dependency); scales to the panel via viewBox.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dispositionLabel, dispositionTone, kindLabel, recordHref, requestLabel, roleLabel, statusLabel, statusTone, type Tone, usd } from "@/lib/ui/format";

type Evidence = { path: string[]; ruleRef?: string };
type Req = { reqId: string; kind: string; requiredApprovers: string[]; approvals: { by: string; decision: "approve" | "reject" }[]; amountUSDCents?: number; status: string };
type Props = {
  c: { kind: string; openedBy: string; author?: string; disposition: string; impactUSDCents: number | null; evidence?: unknown; ruleIds?: string[] };
  requests: Req[];
  messages: { from: string; to: string }[];
  tools: string[];
};

const TONE_FG: Record<Tone, string> = { crit: "var(--crit)", warn: "var(--warn)", good: "var(--good)", info: "var(--info)", neutral: "var(--border-strong)" };

const KINDS: [RegExp, string][] = [
  [/^VI-/, "Supplier invoice"], [/^line \d/, "Invoice line"], [/^P\d{2}$/, "Part"], [/^PO-/, "Purchase order"],
  [/^R-\d/, "Dock receipt"], [/^PS-/, "Packing slip"], [/^COO-/, "Certificate of origin"], [/^CE-/, "Customs entry"],
  [/^MPN /, "Manufacturer part no."], [/^KESTREL-UAS/, "Compliance policy"], [/^RUN-/, "Payroll run"], [/^E-\d/, "Employee"],
  [/^PP-/, "Pay period"], [/^HRIS/, "HRIS"], [/^MSG-/, "Email"], [/^timesheet/, "Timesheet"], [/^bank account/, "Bank account"],
  [/^invoice no\./, "Invoice number"], [/^(entered|expected) \d/, "HTS code"], [/^vendor master/, "Vendor master"],
  [/^supplier /, "Supplier"], [/^no certificate/, "Missing document"], [/^registered states/, "Registrations"], [/^period /, "Pay period"],
];
const classify = (p: string) => KINDS.find(([re]) => re.test(p))?.[1] ?? "Record";
// Records that carry the offending fact itself (restricted origin, shared bank account, wrong HTS code).
const CULPRIT = /\(origin (CN|RU|IR|KP)\)|= E-\d|^entered \d/;
const cleanRule = (r: string) => r.replace(/\s*\(https?:[^)]*\)/g, "");

/** Up to two lines of ~n chars, word-wrapped, ellipsis on overflow. */
function wrap(s: string, n: number): string[] {
  // Long ids have no spaces: break them after the last "-" or "_" that fits.
  const words = s.split(" ").flatMap((w) => {
    const out: string[] = [];
    while (w.length > n) {
      const cut = Math.max(w.lastIndexOf("-", n - 1), w.lastIndexOf("_", n - 1));
      const at = cut > 0 ? cut + 1 : n;
      out.push(w.slice(0, at));
      w = w.slice(at);
    }
    return [...out, w];
  });
  const lines: string[] = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + " " + w).length <= n) lines[lines.length - 1] = cur + " " + w;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = lines[1] + " " + w; break; }
  }
  return lines.map((l) => (l.length > n ? l.slice(0, n - 1) + "…" : l));
}

// Column grid (viewBox units).
const COL = { agent: { x: 0, w: 200 }, data: { x: 254, w: 232 }, finding: { x: 544, w: 218 }, req: { x: 820, w: 218 }, people: { x: 1096, w: 164 } };
const W = 1260, TOP = 34, NH = 60, RH = 68, GAP = 14;
const MONO = "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace";

type N = { id: string; x: number; y: number; w: number; h: number; label: string; lines: string[]; stroke: string; href?: string | null; title: string; delay: number; strong?: boolean };
type E = { d: string; color: string; dashed?: boolean; width?: number; opacity?: number; delay: number };

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

export function DecisionGraph({ c, requests, messages, tools }: Props) {
  const router = useRouter();
  const [run, setRun] = useState(0);
  const evidence = (Array.isArray(c.evidence) ? c.evidence : []) as Evidence[];

  // ---- data column: the path(s) through the company graph, then the rule(s) applied
  const data: { text: string; rule?: boolean; learned?: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    for (const p of e.path) if (!seen.has(p)) { seen.add(p); data.push({ text: p }); }
    if (e.ruleRef) {
      const r = cleanRule(e.ruleRef);
      const hit = data.find((d) => cleanRule(d.text) === r);
      if (hit) hit.rule = true;
      else if (!seen.has(r)) { seen.add(r); data.push({ text: r, rule: true }); }
    }
  }

  // Learned internal rules (from Kestrel's history, approved by Dana) that shaped the handling
  for (const id of c.ruleIds ?? []) if (!seen.has(id)) { seen.add(id); data.push({ text: id, rule: true, learned: true }); }

  // ---- people: approvers on the requests, plus anyone the seat messaged
  const people: string[] = [];
  for (const r of requests) for (const a of r.requiredApprovers) if (!people.includes(a)) people.push(a);
  const notified = messages.filter((m) => m.from === c.openedBy).map((m) => m.to);
  for (const p of notified) if (!people.includes(p)) people.push(p);

  // ---- tools: unique, in call order, with counts
  const toolCounts = new Map<string, number>();
  for (const t of tools) toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
  const toolRows = [...toolCounts].slice(0, 8);
  const moreTools = toolCounts.size - toolRows.length;

  // ---- vertical sizes, each column centred on the tallest
  const agentH = 78 + (toolRows.length ? 26 + toolRows.length * 21 + (moreTools ? 21 : 0) : 0);
  const dataH = data.length * NH + Math.max(0, data.length - 1) * GAP;
  const findH = 92;
  const reqH = requests.length * RH + Math.max(0, requests.length - 1) * GAP;
  const pplH = people.length * NH + Math.max(0, people.length - 1) * GAP;
  const bodyH = Math.max(agentH, dataH, findH, reqH, pplH);
  const H = TOP + bodyH + 8;
  const top = (h: number) => TOP + (bodyH - h) / 2;

  const nodes: N[] = [];
  const edges: E[] = [];
  const isAgent = c.author === "agent";
  const seat = roleLabel(c.openedBy).replace(" (agent)", "");

  // Agent
  const ay = top(agentH);
  const agent: N = { id: "agent", x: COL.agent.x, y: ay, w: COL.agent.w, h: 78, label: isAgent ? "Claude agent" : "Rules engine", lines: [seat, "Can request, not approve"], stroke: "var(--accent)", title: `${seat}: read-only, can only file requests`, delay: 0, strong: true };
  nodes.push(agent);

  // Data chain
  let t = 250;
  const dataNodes = data.map((d, i) => {
    const y = top(dataH) + i * (NH + GAP);
    const n: N = {
      id: `d${i}`, x: COL.data.x, y, w: COL.data.w, h: NH,
      label: d.learned ? "Learned internal rule" : d.rule ? "Rule applied" : classify(d.text), lines: wrap(d.text, d.learned || /^[A-Z]+-\d/.test(d.text) ? 24 : 30),
      stroke: d.learned ? "var(--good)" : d.rule ? "var(--link)" : CULPRIT.test(d.text) ? "var(--crit)" : /^no certificate|no record|no match/.test(d.text) ? "var(--warn)" : "var(--border-strong)",
      href: d.learned ? "/rules" : /^[A-Z]+-\d/.test(d.text) ? recordHref(d.text) : null, title: d.text, delay: t + i * 90,
    };
    return n;
  });
  nodes.push(...dataNodes);
  dataNodes.forEach((n, i) => {
    if (data[i].rule) return;
    edges.push({ d: curve(agent.x + agent.w, agent.y + 39, n.x, n.y + n.h / 2), color: "var(--link)", opacity: 0.32, width: 1.25, delay: 120 + i * 90 });
  });
  dataNodes.slice(1).forEach((n, i) => {
    const p = dataNodes[i];
    edges.push({ d: `M${p.x + 22},${p.y + p.h} L${n.x + 22},${n.y}`, color: "var(--border-strong)", width: 1.5, delay: n.delay - 40 });
  });
  t += data.length * 90 + 120;

  // Finding
  const tone = dispositionTone(c.disposition);
  const fy = top(findH);
  const finding: N = {
    id: "finding", x: COL.finding.x, y: fy, w: COL.finding.w, h: findH, label: "Finding",
    lines: [...wrap(kindLabel(c.kind), 27).slice(0, 1), c.impactUSDCents ? usd(c.impactUSDCents, { symbol: true }) : "No dollar impact", dispositionLabel(c.disposition)],
    stroke: TONE_FG[tone], title: kindLabel(c.kind), delay: t + 260, strong: true,
  };
  nodes.push(finding);
  const sources = dataNodes.filter((_, i) => data[i].rule);
  for (const s of sources.length ? sources : dataNodes.slice(-1)) {
    edges.push({ d: curve(s.x + s.w, s.y + s.h / 2, finding.x, finding.y + finding.h / 2), color: TONE_FG[tone === "neutral" ? "info" : tone], width: 2, delay: t });
  }
  t += 520;

  // Requests
  const reqNodes = requests.map((r, i) => {
    const y = top(reqH) + i * (RH + GAP);
    const st = statusTone(r.status);
    const n: N = {
      id: r.reqId, x: COL.req.x, y, w: COL.req.w, h: RH, label: `Request · ${r.reqId}`,
      lines: [requestLabel(r.kind), `${r.amountUSDCents ? usd(r.amountUSDCents, { symbol: true }) + " · " : ""}${statusLabel(r.status)}`],
      stroke: TONE_FG[st], title: `${requestLabel(r.kind)} — ${statusLabel(r.status)}`, delay: t + 200 + i * 110,
    };
    edges.push({ d: curve(finding.x + finding.w, finding.y + finding.h / 2, n.x, n.y + n.h / 2), color: "var(--border-strong)", width: 1.5, delay: t + i * 110 });
    return n;
  });
  nodes.push(...reqNodes);
  t += 200 + requests.length * 110 + 160;

  // People and their decisions
  const pplNodes = people.map((p, i) => {
    const y = top(pplH) + i * (NH + GAP);
    const decisions = requests.flatMap((r) => r.approvals.filter((a) => a.by === p).map((a) => a.decision));
    const waiting = requests.some((r) => r.status === "pending" && r.requiredApprovers.includes(p) && !r.approvals.some((a) => a.by === p));
    const state = decisions.includes("reject") ? "Rejected" : decisions.length ? "Approved" : waiting ? "Decision pending" : requests.some((r) => r.requiredApprovers.includes(p)) ? "—" : "Notified";
    const fg = state === "Rejected" ? "var(--crit)" : state === "Approved" ? "var(--good)" : state === "Decision pending" ? "var(--warn)" : "var(--border-strong)";
    const [name, role] = roleLabel(p).split(" · ");
    return { node: { id: `p-${p}`, x: COL.people.x, y, w: COL.people.w, h: NH, label: role ?? "Person", lines: [name, state], stroke: fg, title: `${roleLabel(p)}: ${state}`, delay: t + 220 + i * 110 } as N, role: p };
  });
  pplNodes.forEach(({ node, role }, i) => {
    let linked = false;
    reqNodes.forEach((rn, j) => {
      const r = requests[j];
      if (!r.requiredApprovers.includes(role)) return;
      linked = true;
      const a = r.approvals.find((x) => x.by === role);
      const color = a ? (a.decision === "approve" ? "var(--good)" : "var(--crit)") : "var(--warn)";
      edges.push({ d: curve(rn.x + rn.w, rn.y + rn.h / 2, node.x, node.y + node.h / 2), color, dashed: !a, width: 1.5, delay: t + i * 110 });
    });
    if (!linked) edges.push({ d: curve(finding.x + finding.w, finding.y + finding.h - 14, node.x, node.y + node.h / 2), color: "var(--muted)", dashed: true, width: 1.25, opacity: 0.7, delay: t + i * 110 });
  });
  nodes.push(...pplNodes.map((p) => p.node));

  const headers: [keyof typeof COL, string][] = [["agent", "Seat"], ["data", "Records it read"], ["finding", "What it found"], ["req", "What it asked for"], ["people", "Who decides"]];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-[12.5px] text-muted">
        <span>Every node is a real record in Kestrel&apos;s books. Click one to open it.</span>
        <button className="btn h-8 px-3 text-[12.5px]" onClick={() => setRun((n) => n + 1)}>↻ Replay</button>
      </div>
      <svg key={run} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Decision graph: seat, records read, rule applied, finding, requests and approvers" style={{ display: "block" }}>
        {headers.map(([k, label]) => (
          <text key={k} x={COL[k].x + 2} y={14} style={{ fill: "var(--muted)", fontSize: 11.5, fontWeight: 500, letterSpacing: "0.04em" }}>{label.toUpperCase()}</text>
        ))}
        {edges.map((e, i) => (
          <path
            key={i}
            d={e.d}
            fill="none"
            pathLength={e.dashed ? undefined : 1}
            className={e.dashed ? "dg-fade" : "dg-edge"}
            style={{ stroke: e.color, strokeWidth: e.width ?? 1.5, strokeOpacity: e.opacity ?? 1, animationDelay: `${e.delay}ms`, ...(e.dashed ? { strokeDasharray: "5 4" } : {}) }}
          />
        ))}
        {/* Seat's tool calls, listed under the agent node */}
        {toolRows.length > 0 && (
          <g className="dg-node" style={{ animationDelay: "80ms" }}>
            <text x={agent.x + 4} y={agent.y + agent.h + 22} style={{ fill: "var(--muted)", fontSize: 11 }}>Tools it called that day</text>
            {toolRows.map(([name, n], i) => (
              <text key={name} x={agent.x + 4} y={agent.y + agent.h + 44 + i * 21} style={{ fontFamily: MONO, fontSize: 11.5, fill: "var(--ink-2)" }}>
                <tspan style={{ fill: "var(--link)" }}>ƒ </tspan>{name}{n > 1 ? <tspan style={{ fill: "var(--muted)" }}>{` ×${n}`}</tspan> : null}
              </text>
            ))}
            {moreTools > 0 && <text x={agent.x + 4} y={agent.y + agent.h + 44 + toolRows.length * 21} style={{ fill: "var(--muted)", fontSize: 11 }}>+{moreTools} more</text>}
          </g>
        )}
        {nodes.map((n) => (
          <g
            key={n.id}
            className="dg-node"
            style={{ animationDelay: `${n.delay}ms`, cursor: n.href ? "pointer" : "default" }}
            onClick={n.href ? () => router.push(n.href!) : undefined}
          >
            <title>{n.title}</title>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} style={{ fill: n.strong ? "var(--panel)" : "var(--subtle)", stroke: n.stroke, strokeWidth: n.strong ? 2 : 1.25 }} />
            {n.id === "agent" && <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} style={{ fill: "var(--accent-soft)" }} />}
            <text x={n.x + 12} y={n.y + 19} style={{ fill: n.strong ? n.stroke : "var(--muted)", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }}>{n.label.toUpperCase()}</text>
            {n.lines.map((l, i) => (
              <text
                key={i}
                x={n.x + 12}
                y={n.y + 38 + i * 17}
                style={{ fill: i === 0 ? (n.href ? "var(--link)" : "var(--ink)") : "var(--ink-2)", fontSize: i === 0 && n.strong ? 14.5 : 13, fontWeight: i === 0 && n.strong ? 600 : 400, fontFamily: n.href && i === 0 ? MONO : undefined }}
              >
                {l}
              </text>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
