// Signed-in smoke test against the 0%-traffic candidate. Never prints secrets,
// tokens, or document content; always deletes its document and revokes its session.
const CANDIDATE = process.env.CANDIDATE_URL;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;
const PUBLISHABLE = process.env.CLERK_PUBLISHABLE_KEY;
const EMAIL = process.env.SMOKE_EMAIL;
if (!CANDIDATE || !CLERK_SECRET || !PUBLISHABLE || !EMAIL) throw new Error("missing configuration");

const fapi = "https://" + Buffer.from(PUBLISHABLE.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
const bapi = (path, init = {}) => fetch(`https://api.clerk.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${CLERK_SECRET}`, "Content-Type": "application/json", ...init.headers } });

let clientAuth = "";
let sessionId = "";
let documentId = "";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function fapiPost(path, form) {
  const response = await fetch(`${fapi}/v1${path}${path.includes("?") ? "&" : "?"}_is_native=1`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(clientAuth ? { Authorization: clientAuth } : {}) },
    body: new URLSearchParams(form).toString()
  });
  const header = response.headers.get("authorization");
  if (header) clientAuth = header;
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function token() {
  const { status, body } = await fapiPost(`/client/sessions/${sessionId}/tokens`, {});
  if (status !== 200 || !body.jwt) throw new Error(`session token failed (${status})`);
  return body.jwt;
}

async function api(method, path, body) {
  const response = await fetch(`${CANDIDATE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const type = response.headers.get("content-type") ?? "";
  const payload = type.includes("json") ? await response.json().catch(() => ({})) : await response.arrayBuffer();
  return { status: response.status, type, payload, headers: response.headers };
}

try {
  const users = await (await bapi(`/users?email_address=${encodeURIComponent(EMAIL)}`)).json();
  const userId = Array.isArray(users) ? users[0]?.id : undefined;
  if (!userId) throw new Error("reviewer user not found");
  const ticket = await (await bapi("/sign_in_tokens", { method: "POST", body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }) })).json();
  if (!ticket.token) throw new Error("sign-in token not issued");
  const signIn = await fapiPost("/client/sign_ins", { strategy: "ticket", ticket: ticket.token });
  sessionId = signIn.body?.response?.created_session_id || signIn.body?.client?.last_active_session_id || "";
  check("reviewer session created from sign-in ticket", Boolean(sessionId), `HTTP ${signIn.status}`);
  if (!sessionId) throw new Error("no session");

  const settings = await api("GET", "/api/settings");
  check("GET /api/settings", settings.status === 200, `provider=${settings.payload?.provider}`);
  const entitlement = await api("GET", "/api/entitlements");
  check("GET /api/entitlements", entitlement.status === 200, `plan=${entitlement.payload?.plan}`);
  check("per-user rate limit header", entitlement.headers.get("ratelimit-limit") === "30");

  const summaryList = await api("GET", "/api/documents?view=summary");
  const items = Array.isArray(summaryList.payload) ? summaryList.payload : [];
  check("GET /api/documents?view=summary omits text", summaryList.status === 200 && items.every((d) => d.blocks.length === 0 && typeof d.blockCount === "number"), `${items.length} documents`);

  const text = "Accra is the capital of Ghana and its largest city. It hosts government ministries, a busy port at nearby Tema, and major universities. Kumasi, the second city, is the historic heart of the Ashanti Kingdom and a centre of trade. Cocoa and gold are among Ghana's most important exports, while the Volta Lake behind the Akosombo Dam supplies much of the country's electricity.";
  const created = await api("POST", "/api/documents", { title: "ReadMate smoke test (safe to delete)", sourceType: "selection", voice: "en-US-Neural2-F", speed: 1, blocks: [{ text }] });
  documentId = created.payload?.id ?? "";
  check("POST /api/documents (write)", created.status === 201 && Boolean(documentId));

  const full = await api("GET", `/api/documents/${documentId}`);
  check("GET /api/documents/:id returns full text", full.status === 200 && full.payload?.blocks?.length === 1);
  const progress = await api("PATCH", `/api/documents/${documentId}/progress?view=summary`, { progress: { blockIndex: 0, characterOffset: 10, sentenceIndex: 0, percent: 20 } });
  check("PATCH progress?view=summary is text-free", progress.status === 200 && progress.payload?.blocks?.length === 0 && progress.payload?.blockCount === 1);

  for (const [provider, voice, expected] of [["google", "en-US-Neural2-F", "audio/mpeg"], ["gemini-lite", "Kore", "audio/wav"]]) {
    const started = Date.now();
    const speech = await api("POST", "/api/tts", { text: "ReadMate candidate smoke test.", provider, voice, speed: 1 });
    const bytes = speech.payload instanceof ArrayBuffer ? speech.payload.byteLength : 0;
    check(`POST /api/tts ${provider}`, speech.status === 200 && speech.type.includes(expected) && bytes > 1000, `${speech.status} ${speech.type} ${bytes}B ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  for (const targetLanguage of ["gaa", "ee", "tw"]) {
    const started = Date.now();
    const speech = await api("POST", "/api/tts", { text: "Accra is the capital of Ghana. It is a busy city by the sea.", provider: "gemini-lite", voice: "Kore", speed: 1, targetLanguage });
    const bytes = speech.payload instanceof ArrayBuffer ? speech.payload.byteLength : 0;
    check(`POST /api/tts ${targetLanguage} (local language) returns audio`, speech.status === 200 && bytes > 1000, `${speech.status} ${speech.type} ${bytes}B spokenBy=${speech.headers.get("x-readmate-tts-provider")} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const premiumVoice = await api("POST", "/api/tts", { text: "Premium check.", provider: "gemini", voice: "Kore", speed: 1 });
  const isPremium = entitlement.payload?.isPremium === true;
  check("Gemini Flash gated by plan", isPremium ? premiumVoice.status === 200 : premiumVoice.status === 403 && premiumVoice.payload?.code === "PREMIUM_REQUIRED", `HTTP ${premiumVoice.status}`);

  let started = Date.now();
  const saved = await api("POST", "/api/content/save-url", { url: "https://www.engadget.com/2268183/new-york-times-cooking-is-coming-to-metas-ai-and-display-glasses/", sourceType: "url", provider: "google", voice: "en-US-Neural2-F", speed: 1 });
  const savedDoc = saved.payload?.document;
  check("save-url keeps the full headline", saved.status === 201 && savedDoc?.title === "New York Times Cooking is coming to Meta's AI and display glasses", `HTTP ${saved.status} title="${savedDoc?.title}"`);
  check("save-url import flashcards are fill-in-the-blank", (savedDoc?.flashcards ?? []).every((c) => c.front.includes("_____")), JSON.stringify((savedDoc?.flashcards ?? [])[0]?.front ?? "").slice(0, 120));
  if (savedDoc?.id) await api("DELETE", `/api/documents/${savedDoc.id}`);
  const cards = await api("POST", `/api/learning/${documentId}/flashcards`, { flashcardCount: 4 });
  check("focused flashcards are AI-generated", cards.status === 200 && cards.payload?.fallback === false && cards.payload?.flashcards?.length >= 1, `fallback=${cards.payload?.fallback} n=${cards.payload?.flashcards?.length} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  started = Date.now();
  const pack = await api("POST", `/api/learning/${documentId}/summary`, { flashcardCount: 6, quizCount: 4 });
  check("full study pack is AI-generated", pack.status === 200 && pack.payload?.fallback === false, `fallback=${pack.payload?.fallback} cards=${pack.payload?.learning?.flashcards?.length} quiz=${pack.payload?.learning?.quiz?.length} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const ask = await api("POST", `/api/learning/${documentId}/ask`, { question: "What supplies much of Ghana's electricity?" });
  check("Ask AI answers from the document", ask.status === 200 && ask.payload?.fallback === false, `fallback=${ask.payload?.fallback}`);
} catch (error) {
  check("smoke test completed", false, error instanceof Error ? error.message : String(error));
} finally {
  if (documentId && sessionId) {
    try {
      const removed = await api("DELETE", `/api/documents/${documentId}`);
      check("cleanup: test document deleted", removed.status === 200 || removed.status === 204, `HTTP ${removed.status}`);
    } catch (error) { check("cleanup: test document deleted", false, String(error)); }
  }
  if (sessionId) {
    const revoked = await bapi(`/sessions/${sessionId}/revoke`, { method: "POST" });
    check("cleanup: session revoked", revoked.status === 200, `HTTP ${revoked.status}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
