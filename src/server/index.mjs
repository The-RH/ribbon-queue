import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { QueueStore } from "./store.mjs";
import { createApp } from "./app.mjs";
const activeLocks = new Set();
export async function startServer({
  directory = process.env.RIBBON_DATA_DIR || path.resolve("data"),
  port = Number(process.env.PORT || 3210),
  host = process.env.HOST || "0.0.0.0",
  publicUrl = process.env.PUBLIC_URL,
  webDirectory = fileURLToPath(new URL("../../dist/client", import.meta.url)),
  clock = Date.now,
} = {}) {
  directory = path.resolve(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, "server.lock"),
    nonce = randomUUID();
  if (fs.existsSync(lockPath)) {
    let previous;
    try {
      previous = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch {
      throw new Error(
        "Host lock is damaged; close all Ribbon Queue processes before removing server.lock.",
      );
    }
    let running = false;
    try {
      if (Number.isSafeInteger(previous.pid) && previous.pid > 0) {
        process.kill(previous.pid, 0);
        running = true;
      }
    } catch (error) {
      if (error.code !== "ESRCH") running = true;
    }
    if (previous.pid === process.pid && !activeLocks.has(directory))
      running = false;
    if (running)
      throw new Error(
        "This data folder is already in use by another Ribbon Queue host.",
      );
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, nonce }), {
    flag: "wx",
    mode: 0o600,
  });
  activeLocks.add(directory);
  const unlock = () => {
    activeLocks.delete(directory);
    try {
      if (JSON.parse(fs.readFileSync(lockPath, "utf8")).nonce === nonce)
        fs.unlinkSync(lockPath);
    } catch {}
  };
  let app, store, timer;
  const server = http.createServer({ maxHeaderSize: 16384 }, (req, res) => {
    if (app) app(req, res);
    else {
      res.writeHead(503);
      res.end("Host starting");
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 1000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ port, host, backlog: 2048 }, resolve);
    });
    const actualPort = server.address().port;
    const lan =
      Object.values(os.networkInterfaces())
        .flat()
        .find((x) => x && x.family === "IPv4" && !x.internal)?.address ||
      "127.0.0.1";
    store = await QueueStore.open({
      directory,
      clock,
      defaultPublicUrl: publicUrl || `http://${lan}:${actualPort}`,
    });
    if (publicUrl && store.settings().publicUrl !== publicUrl)
      store.updateSettings({ publicUrl });
    app = createApp({ store, port: actualPort, webDirectory });
    store.purgeExpired();
    timer = setInterval(() => {
      try {
        store.purgeExpired();
      } catch (error) {
        console.error("Expiry cleanup failed:", error.message);
      }
    }, 60000);
    timer.unref();
    return {
      server,
      store,
      port: actualPort,
      localUrl: `http://127.0.0.1:${actualPort}`,
      publicUrl: store.settings().publicUrl,
      setupUrl: `http://127.0.0.1:${actualPort}/#/setup?token=${store.bootstrap}`,
      async close() {
        clearInterval(timer);
        await new Promise((resolve) => server.close(resolve));
        store.close();
        unlock();
      },
    };
  } catch (error) {
    clearInterval(timer);
    server.close();
    store?.close();
    unlock();
    throw error;
  }
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const host = await startServer();
    console.log("Ribbon Queue host ready: " + host.localUrl);
    console.log("Participant address: " + host.publicUrl);
    if (host.store.settings().setupRequired)
      console.log(
        "Owner-only first setup link (do not share): " + host.setupUrl,
      );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => host.close().then(() => process.exit(0)));
  } catch (error) {
    console.error("Unable to start Ribbon Queue:", error.message);
    process.exitCode = 1;
  }
}
