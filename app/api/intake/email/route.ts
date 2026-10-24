import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import type { InboxMessage } from "@/lib/erp/types";
import { convex, currentRules, overlay, runSeatAndCommit } from "@/lib/live/desk";
import type { EmailForm } from "@/lib/live/forms";

export async function POST(req: Request) {
  const form = (await req.json()) as EmailForm;
  if (!form.from?.includes("@") || !form.body?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.date ?? "")) {
    return Response.json({ error: "from (an email address), body, and date (YYYY-MM-DD) are required" }, { status: 400 });
  }
  const client = convex();
  const intakeId = `INTAKE-${await client.query(api.intake.nextId, {})}`;
  const email: InboxMessage = { id: `MSG-${intakeId}`, date: form.date, from: form.from.trim(), to: form.to.trim(), subject: form.subject.trim(), body: form.body.trim(), refs: [] };
  const seat = /payroll|hr@/i.test(form.to) ? "payroll_specialist" : "ap_clerk";
  const title = `Email from ${email.from}: ${email.subject || "(no subject)"}`;
  await client.mutation(api.intake.create, { intakeId, kind: "email", at: form.date, title, doc: { email }, findings: [], seat });
  const rules = await currentRules(client);
  after(() =>
    runSeatAndCommit({
      intakeId,
      seat,
      world: overlay({ email }),
      today: form.date,
      rules,
      task: `Today is ${form.date}. A new email arrived at ${email.to}: ${email.id}. Read the inbox, decide whether it affects payments, bank details, or anything you're responsible for, and act on it. If it's routine and needs nothing, say so and do nothing.`,
    }),
  );
  return Response.json({ intakeId, emailId: email.id, seat });
}
