import { createSupabaseServerClient } from "@/lib/supabase/server";

// audit_operator_action is Qra's 7-year legal record: every generated-doc
// approval, status change and CHA hand-off is written here. A lost row must NEVER
// be silent. Fire-and-forget inserts swallowed a failed write, so this helper
// AWAITS the insert, retries ONCE on error, and on a second failure logs loudly
// (no PII — only shipment id + action type) and returns false. Callers keep going
// even if the audit write fails; the loud console.error is the fix, not a halt.
type AuditRow = {
  operator_id: string | null;
  shipment_id: string;
  action_type: string;
  old_value: unknown;
  new_value: unknown;
};

export async function writeAudit(
  admin: ReturnType<typeof createSupabaseServerClient>,
  row: AuditRow
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.from("audit_operator_action").insert(row);
    if (!error) return true;
  }
  console.error("audit_write_failed", { shipmentId: row.shipment_id, actionType: row.action_type });
  return false;
}
