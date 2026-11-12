import test from "node:test";
import assert from "node:assert/strict";
import { fixture, token, requestId, parallelRequests } from "./helpers.mjs";
test("240 requests with a 64-connection pool never exceed product limits; retries and browser ownership", async (t) => {
  const f = await fixture(t),
    e = f.makeEvent({
      products: [1, 2, 3, 4].map((i) => ({ name: "款式 " + i, capacity: 15 })),
    });
  const owners = Array.from({ length: 240 }, () => new f.Client());
  const results = await parallelRequests(owners, (c, i) =>
    c.request("/events/" + e.id + "/claim", {
      token: token(),
      productId: e.products[i % 4].id,
    }),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 60);
  assert(results.every((r) => r.status === 200 || r.status === 409));
  const s = f.store.overview(e.id);
  assert.equal(s.issued, 60);
  assert.equal(s.remaining, 0);
  assert(s.products.every((p) => p.issued === 15));
  assert.deepEqual(
    f.store.tickets(e.id).map((t) => t.no),
    Array.from({ length: 60 }, (_, i) => i + 1),
  );
  const next = f.makeEvent({ title: "下一場" }),
    owner = new f.Client(),
    secret = token();
  const duplicate = await Promise.all(
    Array.from({ length: 4 }, () =>
      owner.request("/events/" + next.id + "/claim", {
        token: secret,
        productId: next.products[0].id,
      }),
    ),
  );
  assert(duplicate.every((r) => r.status === 200 && r.data.ticket.no === 1));
  assert.equal(
    (
      await owner.request("/events/" + next.id + "/claim", {
        token: token(),
        productId: next.products[0].id,
      })
    ).status,
    409,
  );
  const outsider = new f.Client();
  assert.equal(
    (
      await outsider.request("/events/" + next.id + "/ticket", {
        token: secret,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.worker.request("/admin/events/" + next.id + "/inspect", {
        token: secret,
      })
    ).status,
    200,
  );
});
test("one change, full-target failure, stale admission and exactly-once use", async (t) => {
  const f = await fixture(t),
    e = f.makeEvent({
      products: [
        { name: "A", capacity: 3 },
        { name: "B", capacity: 1 },
      ],
    }),
    a = new f.Client(),
    b = new f.Client(),
    ta = token(),
    tb = token();
  await a.request("/events/" + e.id + "/claim", {
    token: ta,
    productId: e.products[0].id,
  });
  await b.request("/events/" + e.id + "/claim", {
    token: tb,
    productId: e.products[1].id,
  });
  assert.equal(
    (
      await a.request("/events/" + e.id + "/choose", {
        token: ta,
        productId: e.products[1].id,
      })
    ).status,
    409,
  );
  assert.equal(
    (await a.request("/events/" + e.id + "/ticket", { token: ta })).data.ticket
      .changes,
    0,
  );
  const old = (
    await f.worker.request("/admin/events/" + e.id + "/inspect", { token: ta })
  ).data.ticket;
  await f.worker.request("/admin/events/" + e.id + "/capacity", {
    productId: e.products[1].id,
    delta: 1,
    requestId: requestId(),
  });
  assert.equal(
    (
      await a.request("/events/" + e.id + "/choose", {
        token: ta,
        productId: e.products[1].id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await a.request("/events/" + e.id + "/choose", {
        token: ta,
        productId: e.products[0].id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/admit", {
        token: ta,
        productId: old.productId,
        changes: old.changes,
      })
    ).status,
    409,
  );
  const current = (
    await f.worker.request("/admin/events/" + e.id + "/inspect", { token: ta })
  ).data.ticket;
  const admissions = await Promise.all(
    Array.from({ length: 10 }, () =>
      f.worker.request("/admin/events/" + e.id + "/admit", {
        token: ta,
        productId: current.productId,
        changes: current.changes,
      }),
    ),
  );
  assert.equal(admissions.filter((r) => r.status === 200).length, 1);
  assert.equal(admissions.filter((r) => r.status === 409).length, 9);
  const count = f.store.overview(e.id).remaining;
  const ticketB = (
    await b.request("/events/" + e.id + "/ticket", { token: tb })
  ).data.ticket;
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/cancel", {
        ticketId: ticketB.id,
      })
    ).status,
    200,
  );
  assert.equal(f.store.overview(e.id).remaining, count);
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/admit", {
        token: tb,
        productId: ticketB.productId,
        changes: 0,
      })
    ).status,
    409,
  );
});
test("capacity increases and decreases are atomic, retry-safe and protect all tickets", async (t) => {
  const f = await fixture(t),
    e = f.makeEvent({
      products: [
        { name: "蝴蝶結", capacity: 8 },
        { name: "A", capacity: 2 },
      ],
    }),
    owner = new f.Client(),
    secret = token();
  await owner.request("/events/" + e.id + "/claim", {
    token: secret,
    productId: e.products[0].id,
  });
  const original = f.store.tickets(e.id);
  const adjustment = {
    productId: e.products[0].id,
    delta: -7,
    requestId: requestId(),
  };
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.worker.request("/admin/events/" + e.id + "/capacity", adjustment),
    ),
  );
  assert(attempts.every((r) => r.status === 200));
  assert.equal(f.store.overview(e.id).products[0].capacity, 1);
  assert.deepEqual(f.store.tickets(e.id), original);
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/capacity", {
        ...adjustment,
        delta: -1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/capacity", {
        ...adjustment,
        delta: -1,
        requestId: requestId(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/capacity", {
        productId: e.products[1].id,
        delta: -2,
        requestId: requestId(),
      })
    ).status,
    200,
  );
  assert.equal(f.store.overview(e.id).products[1].capacity, 0);
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/capacity", {
        productId: e.products[0].id,
        delta: 2,
        requestId: requestId(),
      })
    ).status,
    200,
  );
  const contenders = await Promise.all([
    f.worker.request("/admin/events/" + e.id + "/capacity", {
      productId: e.products[0].id,
      delta: -2,
      requestId: requestId(),
    }),
    ...Array.from({ length: 20 }, () =>
      new f.Client().request("/events/" + e.id + "/claim", {
        token: token(),
        productId: e.products[0].id,
      }),
    ),
  ]);
  assert(contenders.every((r) => r.status === 200 || r.status === 409));
  const final = f.store.overview(e.id);
  assert(final.products[0].capacity >= final.products[0].issued);
  assert(final.remaining >= 0);
  assert.equal(
    (await owner.request("/events/" + e.id + "/ticket", { token: secret }))
      .status,
    200,
  );
});
test("server schedule, early open, extension, expiry purge, and independent events", async (t) => {
  const f = await fixture(t),
    start = f.now + 60000,
    end = start + 60000,
    expires = end + 60000,
    e = f.makeEvent({ start, end, expires }),
    owner = new f.Client(),
    secret = token();
  assert.equal(
    (
      await owner.request("/events/" + e.id + "/claim", {
        token: secret,
        productId: e.products[0].id,
      })
    ).status,
    409,
  );
  await f.worker.request("/admin/events/" + e.id + "/early-open", {});
  assert.equal(
    (
      await owner.request("/events/" + e.id + "/claim", {
        token: secret,
        productId: e.products[0].id,
      })
    ).status,
    200,
  );
  f.setNow(end);
  assert.equal(f.store.overview(e.id).open, false);
  assert.equal(
    (await owner.request("/events/" + e.id + "/ticket", { token: secret }))
      .status,
    200,
  );
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/capacity", {
        productId: e.products[0].id,
        delta: 1,
        requestId: requestId(),
      })
    ).status,
    200,
  );
  assert.equal(f.store.overview(e.id).open, false);
  await f.worker.request(
    "/admin/events/" + e.id,
    { end: end + 60000, expires: expires + 60000 },
    {},
    "PUT",
  );
  assert.equal(f.store.overview(e.id).open, true);
  assert.equal(f.store.tickets(e.id)[0].no, 1);
  f.setNow(expires + 60000);
  assert.equal(
    (await owner.request("/events/" + e.id + "/ticket", { token: secret }))
      .status,
    410,
  );
  assert.equal(f.store.overview(e.id).issued, 0);
  f.store.purgeExpired();
  assert.equal(
    f.store.one("SELECT COUNT(*) n FROM tickets WHERE event_id=?", [e.id]).n,
    0,
  );
  assert.equal(
    (
      await f.worker.request("/admin/events/" + e.id + "/capacity", {
        productId: e.products[0].id,
        delta: 1,
        requestId: requestId(),
      })
    ).status,
    409,
  );
  const next = f.makeEvent({ title: "晚場" }),
    newSecret = token();
  assert.equal(
    (
      await owner.request("/events/" + next.id + "/claim", {
        token: newSecret,
        productId: next.products[0].id,
      })
    ).data.ticket.no,
    1,
  );
  assert.equal(f.store.overview(next.id).capacity, 53);
});
