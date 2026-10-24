import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type DeskSnapshot, loadDesk } from "@/lib/desk/seed";
import { convex } from "@/lib/live/desk";

/** Reloads the saved agent run (the state the demo starts from). No API calls. */
export async function POST() {
  const file = join(process.cwd(), "data/desk/agents-seed42.json");
  if (!existsSync(file)) return Response.json({ error: "no saved agent run; run `npm run sim` first" }, { status: 404 });
  const snap = JSON.parse(readFileSync(file, "utf8")) as DeskSnapshot;
  await loadDesk(convex(), snap);
  return Response.json({ ok: true, source: snap.source });
}
