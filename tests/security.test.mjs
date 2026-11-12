import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture, token, password } from "./helpers.mjs";
test("authentication, CSRF/CORS, host validation, body limits and login guessing", async (t) => {
  const f = await fixture(t),
    guest = new f.Client(),
    e = f.makeEvent();
  assert.equal((await guest.request("/admin")).status, 401);
  assert.equal(
    (await guest.request("/admin/events/" + e.id + "/early-open", {})).status,
    401,
  );
  assert.equal(
    (
      await guest.request(
        "/login",
        { password },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await guest.request("/login", { password }, { "X-Ribbon-Client": "" }))
      .status,
    403,
  );
  const badHost = await new Promise((resolve, reject) => {
    const request = http.request(
      f.origin + "/api/public",
      { headers: { Host: "evil.example" } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(badHost, 403);
  assert.equal(
    (
      await guest.request("/events/" + e.id + "/claim", {
        token: token(),
        productId: e.products[0].id,
        padding: "x".repeat(20000),
      })
    ).status,
    413,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await guest.request("/login", { password: "bad" })).status,
      401,
    );
  assert.equal((await guest.request("/login", { password })).status, 429);
  const other = new f.Client();
  assert.equal((await other.request("/login", { password })).status, 200);
  const r = await fetch(f.origin + "/");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert(
    r.headers.get("content-security-policy").includes("script-src-attr 'none'"),
  );
  assert(
    !r.headers
      .get("content-security-policy")
      .includes("script-src 'unsafe-inline'"),
  );
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await f.worker.request("/logout", {})).status, 200);
  assert.equal((await f.worker.request("/admin")).status, 401);
});
test("public responses and exports do not reveal participant identifiers or credentials", async (t) => {
  const f = await fixture(t),
    e = f.makeEvent(),
    client = new f.Client(),
    secret = token();
  await client.request("/events/" + e.id + "/claim", {
    token: secret,
    productId: e.products[0].id,
  });
  const status = await client.request("/events/" + e.id);
  const admin = await f.worker.request("/admin/events/" + e.id + "/tickets");
  const exported = await f.worker.request("/admin/export");
  const rendered = JSON.stringify([status.data, admin.data, exported.data]);
  assert(!rendered.includes(secret));
  assert(!rendered.includes(client.visitor));
  assert(!rendered.includes("claim_hash"));
  assert(!rendered.includes("browser_hash"));
  assert(!rendered.includes("password_hash"));
  assert(!rendered.includes(f.store.secret));
  assert(!rendered.includes(password));
  assert.equal(
    (await client.request("/events/" + e.id + "/ticket", { token: "short" }))
      .status,
    400,
  );
});
test("uploads require staff auth and only expose bounded image files", async (t) => {
  const f = await fixture(t),
    guest = new f.Client();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4x8AAAAASUVORK5CYII=";
  assert.equal(
    (await guest.request("/admin/upload", { data: png })).status,
    401,
  );
  assert.equal(
    (
      await f.worker.request("/admin/upload", {
        data: Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"),
      })
    ).status,
    400,
  );
  const result = await f.worker.request("/admin/upload", { data: png });
  assert.equal(result.status, 200);
  assert.match(result.data.image, /^\/uploads\/[a-f0-9]{64}\.png$/);
  const image = await fetch(f.origin + result.data.image);
  assert.equal(image.status, 200);
  assert.deepEqual(
    Buffer.from(await image.arrayBuffer()),
    Buffer.from(png, "base64"),
  );
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    (
      await f.worker.request("/admin/upload", {
        data: Buffer.concat([
          Buffer.from(png, "base64"),
          Buffer.alloc(5 * 1024 * 1024),
        ]).toString("base64"),
      })
    ).status,
    413,
  );
});
