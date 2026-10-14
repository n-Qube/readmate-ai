// RM-02 / RM-03 end-to-end smoke against a 0%-traffic candidate, using real
// Supabase Storage. Cleans up every document and object it creates.
const CANDIDATE = process.env.CANDIDATE_URL;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;
const PUBLISHABLE = process.env.CLERK_PUBLISHABLE_KEY;
const EMAIL = process.env.SMOKE_EMAIL;
if (!CANDIDATE || !CLERK_SECRET || !PUBLISHABLE || !EMAIL) throw new Error("missing configuration");

const fapi = "https://" + Buffer.from(PUBLISHABLE.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
const bapi = (path, init = {}) => fetch(`https://api.clerk.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${CLERK_SECRET}`, "Content-Type": "application/json", ...init.headers } });
let clientAuth = "";
let sessionId = "";
const created = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function fapiPost(path, form) {
  const response = await fetch(`${fapi}/v1${path}${path.includes("?") ? "&" : "?"}_is_native=1`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(clientAuth ? { Authorization: clientAuth } : {}) }, body: new URLSearchParams(form).toString() });
  const header = response.headers.get("authorization");
  if (header) clientAuth = header;
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function token() {
  const { body } = await fapiPost(`/client/sessions/${sessionId}/tokens`, {});
  return body.jwt;
}
async function api(method, path, body) {
  const response = await fetch(`${CANDIDATE}${path}`, { method, headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/** A small, valid, text-bearing PDF with a correct xref table. */
function textPdf(lines, padBytes = 0) {
  const content = `BT /F1 14 Tf 72 720 Td 18 TL ${lines.map((line) => `(${line.replace(/[()\\]/g, "")}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  if (padBytes) pdf += `%${"x".repeat(padBytes)}\n`;
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function signAndUpload(bytes, declaredSize) {
  const signed = await api("POST", "/api/uploads/pdf/sign", { filename: "readmate-smoke.pdf", mimeType: "application/pdf", byteSize: declaredSize });
  if (signed.status !== 201) throw new Error(`sign failed ${signed.status} ${JSON.stringify(signed.body)}`);
  const put = await fetch(signed.body.signedUrl, { method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" }, body: bytes });
  return { upload: signed.body, putStatus: put.status };
}

const convertBody = { provider: "google", voice: "en-US-Neural2-F", speed: 1 };
try {
  const users = await (await bapi(`/users?email_address=${encodeURIComponent(EMAIL)}`)).json();
  const ticket = await (await bapi("/sign_in_tokens", { method: "POST", body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 300 }) })).json();
  const signIn = await fapiPost("/client/sign_ins", { strategy: "ticket", ticket: ticket.token });
  sessionId = signIn.body?.response?.created_session_id || signIn.body?.client?.last_active_session_id || "";
  check("session created", Boolean(sessionId));

  // RM-02: concurrent conversions of one real upload
  const pdf = textPdf(["ReadMate smoke test document.", "Accra is the capital of Ghana and a busy city by the sea.", "This file checks that a PDF converts exactly once."]);
  const { upload, putStatus } = await signAndUpload(pdf, pdf.byteLength);
  check("PDF uploaded to storage via signed URL", putStatus === 200, `HTTP ${putStatus}, ${pdf.byteLength} bytes`);
  const conversions = await Promise.all([1, 2, 3].map(() => api("POST", `/api/uploads/${upload.id}/pdf/document`, convertBody)));
  const ids = [...new Set(conversions.map((c) => c.body.id).filter(Boolean))];
  ids.forEach((id) => created.push(id));
  check("3 concurrent conversions -> one document", ids.length === 1, `statuses=${conversions.map((c) => c.status).join(",")} ids=${ids.length}`);
  check("exactly one 201, the rest 200 or busy 503", conversions.filter((c) => c.status === 201).length === 1 && conversions.every((c) => [200, 201, 503].includes(c.status)), `statuses=${conversions.map((c) => c.status).join(",")}`);
  const retry = await api("POST", `/api/uploads/${upload.id}/pdf/document`, { ...convertBody, title: "Renamed" });
  check("sequential retry returns the canonical document", retry.status === 200 && retry.body.id === ids[0] && retry.body.title !== "Renamed", `HTTP ${retry.status}`);
  check("extracted text is present", (conversions.find((c) => c.status === 201)?.body.blocks ?? []).some((b) => /Accra/.test(b.text)));

  // RM-03: declared small, uploaded larger
  const big = textPdf(["Oversized smoke object."], 20_000);
  const oversized = await signAndUpload(big, 1024);
  check("oversized object stored (bucket accepts it)", oversized.putStatus === 200, `HTTP ${oversized.putStatus}, ${big.byteLength} bytes declared 1024`);
  const rejected = await api("POST", `/api/uploads/${oversized.upload.id}/pdf/document`, convertBody);
  check("oversized conversion rejected with 413", rejected.status === 413, `HTTP ${rejected.status} ${rejected.body.error ?? ""}`);
  const after = await api("GET", `/api/uploads/${oversized.upload.id}/download-url`);
  check("oversized upload record released", after.status === 404, `download-url HTTP ${after.status}`);

  // RM-03: signed but never uploaded
  const pending = await api("POST", "/api/uploads/pdf/sign", { filename: "never.pdf", mimeType: "application/pdf", byteSize: 2048 });
  const early = await api("POST", `/api/uploads/${pending.body.id}/pdf/document`, convertBody);
  check("conversion before upload finishes -> 409", early.status === 409, `HTTP ${early.status}`);
} catch (error) {
  check("smoke completed", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const id of created) {
    const removed = await api("DELETE", `/api/documents/${id}`);
    check(`cleanup: document ${id.slice(0, 8)} deleted (with its upload)`, removed.status === 204 || removed.status === 200, `HTTP ${removed.status}`);
  }
  if (sessionId) {
    const revoked = await bapi(`/sessions/${sessionId}/revoke`, { method: "POST" });
    check("cleanup: session revoked", revoked.status === 200);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
