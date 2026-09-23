import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerMembershipRoutes, membershipRecipients, validServiceToken, RAUL, ACCOUNTS } from "./membership";

test("membership bridge: auth, preview parity, Gmail delivery and failure safety", async () => {
  process.env.MEMBERSHIP_EMAIL_API_TOKEN = "test-service-token";
  process.env.GMAIL_ACCOUNTS_CLIENT_ID = "test-id";
  process.env.GMAIL_ACCOUNTS_CLIENT_SECRET = "test-secret";
  process.env.GMAIL_ACCOUNTS_REFRESH_TOKEN = "test-refresh";
  assert.equal(validServiceToken(undefined), false);
  assert.equal(validServiceToken("Bearer wrong"), false);
  assert.equal(validServiceToken("Bearer test-service-token"), true);
  assert.deepEqual(membershipRecipients("client@example.com", [RAUL.toUpperCase(), "advisor@example.com", RAUL]),
    [RAUL, "advisor@example.com"]);

  const app = express();
  app.use(express.json());
  registerMembershipRoutes(app, (req, res, next) =>
    req.headers["x-icg-token"] === "test-session" ? next() : void res.status(401).json({ error: "Unauthorized" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let serviceStatus = 200;
  let gmailReady = true;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2.googleapis.com")) {
      return Response.json({ access_token: "test-access", expires_in: 3600 });
    }
    if (String(url).includes("gmail.googleapis.com")) return Response.json({ id: "gmail-message", threadId: "gmail-thread" });
    if (String(url).endsWith("/api/xero/status")) return Response.json({ membershipDelivery: gmailReady ? "accounts-gmail" : undefined });
    return Response.json({
      to: "client@example.com", cc: ["advisor@example.com"],
      subject: "Membership balance", html: "<p>Preview</p>",
    }, { status: serviceStatus });
  };
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    realFetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal((await request("/api/membership-balance-email/candidates")).status, 401);
    assert.equal(calls.length, 0);
    const preview = await request("/api/membership-balance-email/preview", {}, { "x-icg-token": "test-session" });
    const payload = await preview.json();
    assert.equal(payload.from, `Inner Circle Group Accounts <${ACCOUNTS}>`);
    assert.equal(payload.replyTo, ACCOUNTS);
    assert.deepEqual(payload.cc, ["advisor@example.com", RAUL]);
    assert.equal(preview.headers.get("cache-control"), "no-store");
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer test-service-token");
    assert.equal((calls[0].init?.headers as Record<string, string>)["x-icg-token"], undefined);
    assert.equal(calls.some(c => c.url.includes("gmail.googleapis.com")), false, "preview must not send");

    const message = { to: "client@example.com", cc: ["advisor@example.com"], subject: "Membership balance", html: "<p>Reviewed email</p>" };
    assert.equal((await request("/api/internal/membership-mail", message, { "x-icg-token": "test-session" })).status, 401);
    assert.equal((await request("/api/internal/membership-mail", { ...message, cc: ["bad\r\nBcc: hidden@example.com"] },
      { Authorization: "Bearer test-service-token" })).status, 400);
    const sent = await request("/api/internal/membership-mail", message, { Authorization: "Bearer test-service-token" });
    assert.equal((await sent.json()).id, "gmail-message");
    const delivery = calls.find(c => c.url.includes("gmail.googleapis.com"))!;
    assert.equal(delivery.url, "https://gmail.googleapis.com/gmail/v1/users/accounts%40innercirclegroup.com.au/messages/send");
    const mime = Buffer.from(JSON.parse(String(delivery.init?.body)).raw, "base64url").toString("utf8");
    assert.ok(mime.includes(`From: Inner Circle Group Accounts <${ACCOUNTS}>`));
    assert.ok(mime.includes(`Reply-To: ${ACCOUNTS}`));
    assert.ok(mime.includes(`Cc: advisor@example.com, ${RAUL}`));
    assert.ok(mime.includes("<p>Reviewed email</p>"));

    gmailReady = false;
    const priorSends = calls.filter(c => c.url.endsWith("/membership-balance-email/send")).length;
    assert.equal((await request("/api/membership-balance-email/send", {}, { "x-icg-token": "test-session" })).status, 503);
    assert.equal(calls.filter(c => c.url.endsWith("/membership-balance-email/send")).length, priorSends);
    gmailReady = true;
    serviceStatus = 409;
    assert.equal((await request("/api/membership-balance-email/send", {}, { "x-icg-token": "test-session" })).status, 409);
    serviceStatus = 401;
    assert.equal((await request("/api/membership-balance-email/candidates", undefined, { "x-icg-token": "test-session" })).status, 503);
    delete process.env.MEMBERSHIP_EMAIL_API_TOKEN;
    assert.equal((await request("/api/membership-payment-followup/candidates", undefined, { "x-icg-token": "test-session" })).status, 503);
  } finally {
    globalThis.fetch = realFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
