import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { sendMail } from "./mailer";

export const ACCOUNTS = "accounts@innercirclegroup.com.au";
export const RAUL = "raul.garcia@innercirclegroup.com.au";
const FROM = `Inner Circle Group Accounts <${ACCOUNTS}>`;
const SERVICE_ORIGIN = "https://propertytool.innercirclegroup.com.au";

// Explicit route list: never forward arbitrary paths, cookies, client tokens or URLs.
export const MEMBERSHIP_ROUTES = [
  ["get", "/api/membership-balance-email/candidates"],
  ["post", "/api/membership-balance-email/preview"],
  ["post", "/api/membership-balance-email/send"],
  ["get", "/api/membership-payment-followup/candidates"],
  ["post", "/api/membership-payment-followup/preview"],
  ["post", "/api/membership-payment-followup/send"],
  ["post", "/api/membership-payment-followup/mark-paid"],
  ["post", "/api/membership-payment-followup/undo-paid"],
  ["post", "/api/membership-payment-followup/manual-add"],
  ["get", "/api/membership-xero/status"],
] as const;

export function validServiceToken(header: string | undefined): boolean {
  const expected = process.env.MEMBERSHIP_EMAIL_API_TOKEN;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

export const relaySchema = z.object({
  to: z.string().email(),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().min(1).max(998).refine(s => !/[\r\n]/.test(s)),
  html: z.string().min(1).max(500_000),
});

export function membershipRecipients(to: string, cc: string[]): string[] {
  return Array.from(new Set([...cc, RAUL].map(s => s.trim().toLowerCase())))
    .filter(s => s !== to.trim().toLowerCase());
}

export function registerMembershipRoutes(app: Express, requireAuth: RequestHandler) {
  for (const [method, path] of MEMBERSHIP_ROUTES) {
    app[method](path, requireAuth, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const token = process.env.MEMBERSHIP_EMAIL_API_TOKEN;
      if (!token) return res.status(503).json({
        error: "Membership connection is not configured. Set MEMBERSHIP_EMAIL_API_TOKEN to the same secret on the dashboard and Property Tool services.",
      });
      try {
        // During the coordinated cutover the old Property Tool still uses
        // Resend. Never let the new worklist send until Gmail delivery is live.
        if (path.endsWith("/send")) {
          const readiness = await fetch(`${SERVICE_ORIGIN}/api/xero/status`, {
            headers: { Authorization: `Bearer ${token}` },
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          });
          const state = readiness.ok ? await readiness.json() : null;
          if (state?.membershipDelivery !== "accounts-gmail") {
            return res.status(503).json({
              error: "Accounts Gmail cutover is not ready. No email was sent; finish deploying the Property Tool companion change.",
            });
          }
        }
        const target = path === "/api/membership-xero/status" ? "/api/xero/status" : path;
        const upstream = await fetch(`${SERVICE_ORIGIN}${target}`, {
          method: method.toUpperCase(),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-ICG-Caller": "dashboard" },
          ...(method === "post" ? { body: JSON.stringify(req.body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
        });
        if (upstream.status === 401 || upstream.status === 403) return res.status(503).json({
          error: "Membership service authentication failed. Check the shared MEMBERSHIP_EMAIL_API_TOKEN.",
        });
        const data = await upstream.json();
        // Enforce the same visible policy as the Gmail relay; never hide Raul from approval.
        if (upstream.ok && path.endsWith("/preview")) {
          data.from = FROM;
          data.replyTo = ACCOUNTS;
          data.cc = membershipRecipients(data.to, data.cc || []);
        }
        return res.status(upstream.status).json(data);
      } catch {
        return res.status(502).json({ error: path.endsWith("/send")
          ? "Send result could not be confirmed. Check accounts Sent and refresh the worklist before retrying."
          : "The membership service could not be reached. Please retry." });
      }
    });
  }

  // Server-to-server only. The Property Tool remains the sole send-history writer
  // and duplicate guard; delivery uses the dashboard's existing accounts OAuth.
  app.post("/api/internal/membership-mail", async (req, res) => {
    if (!validServiceToken(req.headers.authorization)) return res.status(401).json({ error: "Unauthorized" });
    const parsed = relaySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid membership email" });
    try {
      const message = parsed.data;
      const result = await sendMail({
        ...message, cc: membershipRecipients(message.to, message.cc), replyTo: ACCOUNTS,
      });
      return res.json({ success: true, id: result.id, threadId: result.threadId });
    } catch {
      return res.status(502).json({ success: false, error: "Accounts Gmail delivery failed or could not be confirmed. Check accounts Sent before retrying." });
    }
  });
}
