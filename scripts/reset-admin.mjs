import { startServer } from "../src/server/index.mjs";
// Acquire the same exclusive host lock as the application. No password is logged.
const index = process.argv.indexOf("--data");
if (index >= 0 && !process.argv[index + 1])
  throw Error("--data requires a directory.");
const host = await startServer({
  directory: index >= 0 ? process.argv[index + 1] : undefined,
  port: 0,
  host: "127.0.0.1",
});
try {
  host.store.transaction(() => {
    host.store.run("UPDATE settings SET password_hash=NULL WHERE id=1");
    host.store.run("DELETE FROM sessions");
  });
  console.log(
    "Admin login reset. Restart the host and use the owner-only setup link.",
  );
} finally {
  await host.close();
}
