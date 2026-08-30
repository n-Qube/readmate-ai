#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { requiredHeaders } = require("./validate-web-deployment.cjs");

async function run() {
  const origin = process.env.READMATE_FIREBASE_EMULATOR_ORIGIN;
  const publicRoot = process.env.READMATE_FIREBASE_EMULATOR_PUBLIC;
  assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/, "emulator origin must be explicit");
  assert.ok(publicRoot && path.isAbsolute(publicRoot), "emulator public directory must be absolute");

  await assertResponse({ origin, publicRoot, route: "/", status: 200, file: "index.html" });
  await assertResponse({ origin, publicRoot, route: "/library", status: 200, file: "library.html" });
  await assertResponse({ origin, publicRoot, route: "/challenge", status: 200, file: "challenge.html" });
  await assertResponse({ origin, publicRoot, route: "/challenge-demo", status: 200, file: "challenge-demo.html" });
  await assertResponse({ origin, publicRoot, route: "/challenge-feed.xml", status: 200, file: "challenge-feed.xml" });
  await assertRedirect({ origin, route: "/challenge.html", location: "/challenge" });
  await assertRedirect({ origin, route: "/challenge-demo.html", location: "/challenge-demo" });
  await assertRedirect({ origin, route: "/library.html", location: "/library" });
  await assertRedirect({ origin, route: "/library/", location: "/library" });
  await assertResponse({
    origin,
    publicRoot,
    route: "/document/one",
    status: 200,
    file: "_firebase_routes/document.html"
  });
  await assertResponse({ origin, publicRoot, route: "/document", status: 404, file: "404.html" });
  await assertResponse({ origin, publicRoot, route: "/document/", status: 404, file: "404.html" });
  await assertResponse({ origin, publicRoot, route: "/document/a/b", status: 404, file: "404.html" });
  await assertResponse({ origin, publicRoot, route: "/route-that-does-not-exist", status: 404, file: "404.html" });

  console.log(
    "Firebase Hosting emulator contract passed: challenge pages, clean routes, one-segment documents, custom 404s, and required headers."
  );
}

async function assertRedirect({ origin, route, location }) {
  const response = await fetch(`${origin}${route}`, { redirect: "manual" });
  assert.ok([301, 302].includes(response.status), `${route} should redirect to its clean URL`);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, location);
}

async function assertResponse({ origin, publicRoot, route, status, file }) {
  const response = await fetch(`${origin}${route}`, { redirect: "manual" });
  const body = await response.text();
  assert.equal(response.status, status, `${route} should return HTTP ${status}`);
  assert.equal(
    body,
    fs.readFileSync(path.join(publicRoot, file), "utf8"),
    `${route} should serve ${file}`
  );
  for (const [name, value] of Object.entries(requiredHeaders)) {
    assert.equal(response.headers.get(name), value, `${route} should include ${name}`);
  }
  assert.equal(
    response.headers.has("Origin-Trial"),
    false,
    "ordinary local emulation must not require or invent a production Origin-Trial token"
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
