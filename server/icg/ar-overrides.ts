// Local SQLite store of manual "marked paid" overrides for AR invoices.
//
// WHY OVERRIDES: Xero is the source of truth, but bank-receipt matching and the
// clearing-entry workflow lags reality — a vendor can pay today and the AR view
// will still show the invoice as unpaid for days. The dashboard lets a user
// mark an invoice "paid" so it drops out of the follow-up list immediately.
// The next Xero sync will confirm and the override becomes moot; if the payment
// really was miskeyed, an unmark restores the invoice.
//
// STORAGE: own DB file (`ar.db`) so overrides survive independently of the
// HubSpot/dashboard caches. Resolves to a Railway volume if attached, else
// process cwd — same fallback ladder as `hs-cache.ts` / `snapshot-store.ts`.
// If NO writable location works, all functions become no-ops so the app boots
// cleanly and the AR tab still renders (without the ability to mark paid).

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function resolveDataDir(): { dir: string; persistent: boolean } {
  const candidates: Array<{ dir: string; persistent: boolean }> = [];
  if (process.env.DATA_DIR) candidates.push({ dir: process.env.DATA_DIR, persistent: true });
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH)
    candidates.push({ dir: process.env.RAILWAY_VOLUME_MOUNT_PATH, persistent: true });
  candidates.push({ dir: process.cwd(), persistent: false });
  for (const c of candidates) {
    try {
      fs.mkdirSync(c.dir, { recursive: true });
      const probe = path.join(c.dir, ".ar-write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return c;
    } catch {
      /* next */
    }
  }
  return { dir: process.cwd(), persistent: false };
}

export interface InvoiceOverride {
  invoice_id: string;
  tenant_id: string;
  marked_paid_at: number | null; // epoch ms; null = actively unmarked
  marked_by: string | null;
  note: string | null;
  created_at: number;
}

let db: Database.Database | null = null;
let dbPath = "";
let persistent = false;

function init(): Database.Database | null {
  if (db) return db;
  try {
    const r = resolveDataDir();
    dbPath = path.join(r.dir, "ar.db");
    persistent = r.persistent;
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_overrides (
        invoice_id     TEXT PRIMARY KEY,
        tenant_id      TEXT NOT NULL,
        marked_paid_at INTEGER,
        marked_by      TEXT,
        note           TEXT,
        created_at     INTEGER NOT NULL
      );
    `);
    console.log(`[ar-overrides] ready at ${dbPath} (persistent=${persistent})`);
    return db;
  } catch (e) {
    console.error("[ar-overrides] init failed, override store disabled:", (e as any)?.message);
    db = null;
    return null;
  }
}

export function markPaid(
  invoice_id: string,
  tenant_id: string,
  marked_by: string,
  note?: string,
): boolean {
  const d = init();
  if (!d) return false;
  try {
    d.prepare(
      `INSERT INTO invoice_overrides (invoice_id, tenant_id, marked_paid_at, marked_by, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(invoice_id) DO UPDATE SET
         tenant_id      = excluded.tenant_id,
         marked_paid_at = excluded.marked_paid_at,
         marked_by      = excluded.marked_by,
         note           = excluded.note`,
    ).run(invoice_id, tenant_id, Date.now(), marked_by, note ?? null, Date.now());
    return true;
  } catch (e) {
    console.error("[ar-overrides] markPaid failed:", (e as any)?.message);
    return false;
  }
}

export function unmarkPaid(invoice_id: string): boolean {
  const d = init();
  if (!d) return false;
  try {
    d.prepare("DELETE FROM invoice_overrides WHERE invoice_id=?").run(invoice_id);
    return true;
  } catch (e) {
    console.error("[ar-overrides] unmarkPaid failed:", (e as any)?.message);
    return false;
  }
}

export function listOverrides(): Map<string, InvoiceOverride> {
  const out = new Map<string, InvoiceOverride>();
  const d = init();
  if (!d) return out;
  try {
    const rows = d
      .prepare(
        "SELECT invoice_id, tenant_id, marked_paid_at, marked_by, note, created_at FROM invoice_overrides",
      )
      .all() as InvoiceOverride[];
    for (const r of rows) out.set(r.invoice_id, r);
  } catch (e) {
    console.error("[ar-overrides] listOverrides failed:", (e as any)?.message);
  }
  return out;
}

export function arOverridesInfo() {
  init();
  return { dbPath, persistent, enabled: !!db };
}
