import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { QueueStore } from "../src/server/store.mjs";
import { startServer } from "../src/server/index.mjs";
import { token, requestId, password } from "./helpers.mjs";
function clean(directory) {
  const parent = path.resolve(".work/tests");
  if (!path.resolve(directory).startsWith(parent + path.sep))
    throw Error("Unsafe test cleanup path");
  fs.rmSync(directory, { recursive: true, force: true });
}
test("disk restart preserves settings, password, quotas and the original anonymous ticket", async (t) => {
  const directory = path.resolve(".work/tests", requestId());
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => clean(directory));
  let store = await QueueStore.open({ directory });
  store.setup({
    bootstrap: store.bootstrap,
    name: "Independent Shop",
    password,
    publicUrl: "http://127.0.0.1:3210",
  });
  const n = Date.now(),
    e = store.createEvent({
      title: "Event",
      start: n - 1000,
      end: n + 60000,
      expires: n + 120000,
      products: [{ name: "Ribbon", capacity: 2 }],
    }),
    secret = token(),
    visitor = token();
  const ticket = store.claim(
    e.id,
    { token: secret, productId: e.products[0].id },
    visitor,
  );
  store.adjust(e.id, {
    productId: e.products[0].id,
    delta: 1,
    requestId: requestId(),
  });
  store.close();
  store = await QueueStore.open({ directory });
  assert.equal(store.settings().name, "Independent Shop");
  assert.equal(store.settings().setupRequired, false);
  assert.deepEqual(store.getTicket(e.id, secret, visitor), ticket);
  assert.equal(store.overview(e.id).capacity, 3);
  assert(store.authorized(store.login(password).token));
  const bytes = fs.readFileSync(path.join(directory, "queue.sqlite"));
  assert(!bytes.includes(Buffer.from(password)));
  assert(!bytes.includes(Buffer.from(secret)));
  store.close();
});
test("host starts as a standalone process, refuses a second writer, and restarts cleanly", async (t) => {
  const directory = path.resolve(".work/tests", requestId());
  let host = await startServer({ directory, port: 0, host: "127.0.0.1" });
  t.after(async () => {
    if (host) await host.close();
    clean(directory);
  });
  const page = await fetch(host.localUrl);
  assert.equal(page.status, 200);
  assert((await page.text()).includes("Ribbon Queue"));
  assert.equal(
    (await (await fetch(host.localUrl + "/api/health")).json()).ok,
    true,
  );
  await assert.rejects(
    startServer({ directory, port: 0, host: "127.0.0.1" }),
    /already in use/,
  );
  host.store.setup({
    bootstrap: host.store.bootstrap,
    name: "Stored shop",
    password,
    publicUrl: host.localUrl,
  });
  await host.close();
  host = await startServer({ directory, port: 0, host: "127.0.0.1" });
  assert.equal(host.store.settings().name, "Stored shop");
  assert.equal(host.store.settings().setupRequired, false);
});
test("bootstrap is required only once and password changes revoke staff sessions", async () => {
  const store = await QueueStore.open({ memory: true });
  assert.throws(
    () =>
      store.setup({
        bootstrap: "wrong",
        name: "Shop",
        password,
        publicUrl: "http://127.0.0.1:3210",
      }),
    (e) => e.status === 403,
  );
  store.setup({
    bootstrap: store.bootstrap,
    name: "Shop",
    password,
    publicUrl: "http://127.0.0.1:3210",
  });
  assert.throws(
    () =>
      store.setup({
        bootstrap: store.bootstrap,
        name: "Shop",
        password,
        publicUrl: "http://127.0.0.1:3210",
      }),
    (e) => e.status === 409,
  );
  const first = store.login(password).token;
  assert(store.authorized(first));
  store.updateSettings({ newPassword: "new-local-test-password" });
  assert(!store.authorized(first));
  assert.throws(
    () => store.login(password),
    (e) => e.status === 401,
  );
  assert(store.authorized(store.login("new-local-test-password").token));
  store.close();
});
