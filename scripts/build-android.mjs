import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root = path.resolve(".");
const env = { ...process.env };
if (!env.JAVA_HOME && fs.existsSync(".tools/java")) {
  const name = fs
    .readdirSync(".tools/java")
    .find((n) =>
      fs.existsSync(
        path.join(
          ".tools/java",
          n,
          "bin",
          process.platform === "win32" ? "java.exe" : "java",
        ),
      ),
    );
  if (name) env.JAVA_HOME = path.resolve(".tools/java", name);
}
if (!env.ANDROID_HOME && fs.existsSync(".tools/android/platforms"))
  env.ANDROID_HOME = path.resolve(".tools/android");
if (env.JAVA_HOME)
  env.PATH =
    path.join(env.JAVA_HOME, "bin") +
    path.delimiter +
    (env.PATH || env.Path || "");
if (!env.JAVA_HOME || !env.ANDROID_HOME)
  throw Error(
    "Install JDK 21 and Android SDK 36; set JAVA_HOME and ANDROID_HOME. See docs/BUILD.md.",
  );
env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
env.GRADLE_USER_HOME =
  env.GRADLE_USER_HOME || path.join(root, ".tools", "gradle-cache");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
run(process.execPath, ["scripts/generate-sw.mjs"]);
run(process.execPath, [
  "node_modules/@capacitor/cli/bin/capacitor",
  "sync",
  "android",
]);
const release = process.argv.includes("--release");
if (release && !env.RIBBON_KEYSTORE_PATH) {
  fs.mkdirSync(".signing", { recursive: true });
  const configFile = ".signing/local-signing.json";
  let config;
  if (fs.existsSync(configFile))
    config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  else {
    config = { password: crypto.randomBytes(32).toString("hex") };
    fs.writeFileSync(configFile, JSON.stringify(config), {
      mode: 0o600,
      flag: "wx",
    });
  }
  env.RIBBON_KEYSTORE_PATH = path.join(root, ".signing", "android-release.jks");
  env.RIBBON_KEYSTORE_PASSWORD = config.password;
  env.RIBBON_KEYSTORE_ALIAS = "ribbonqueue";
  if (!fs.existsSync(env.RIBBON_KEYSTORE_PATH))
    run(
      path.join(
        env.JAVA_HOME,
        "bin",
        process.platform === "win32" ? "keytool.exe" : "keytool",
      ),
      [
        "-genkeypair",
        "-noprompt",
        "-keystore",
        env.RIBBON_KEYSTORE_PATH,
        "-storepass:env",
        "RIBBON_KEYSTORE_PASSWORD",
        "-keypass:env",
        "RIBBON_KEYSTORE_PASSWORD",
        "-alias",
        "ribbonqueue",
        "-keyalg",
        "RSA",
        "-keysize",
        "3072",
        "-validity",
        "10000",
        "-dname",
        "CN=Ribbon Queue, O=Ribbon Queue, C=TW",
      ],
    );
}
const target = release ? "assembleRelease" : "assembleDebug";
run(
  process.platform === "win32" ? "cmd.exe" : "sh",
  process.platform === "win32"
    ? ["/d", "/s", "/c", "gradlew.bat --no-daemon " + target]
    : ["gradlew", "--no-daemon", target],
  { cwd: path.join(root, "android") },
);
const variant = release ? "release" : "debug",
  name = "Ribbon-Queue-1.0.0-android" + (release ? "" : "-debug") + ".apk";
fs.mkdirSync("release", { recursive: true });
fs.copyFileSync(
  `android/app/build/outputs/apk/${variant}/app-${variant}.apk`,
  path.join("release", name),
);
console.log(
  "Android APK: release/" +
    name +
    (release ? " (release-signed)." : " (debug test build)."),
);
