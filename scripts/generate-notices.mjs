import fs from "node:fs";
import path from "node:path";
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
let output =
  "# Third-party notices\n\nRibbon Queue is MIT licensed. Bundled dependencies retain their respective licenses. This file includes runtime dependency license texts available in the installed packages. Electron also ships Chromium and third-party notices alongside the executable. Android and iOS native dependencies retain their upstream notices.\n\n";
for (const [dir, entry] of Object.entries(lock.packages).sort()) {
  if (!dir || entry.dev || !fs.existsSync(dir + "/package.json")) continue;
  const pkg = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"));
  output += `## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\n\n`;
  const licenses = fs
    .readdirSync(dir)
    .filter(
      (name) =>
        /^(licen[cs]e|copying|notice)(\.|$)/i.test(name) &&
        fs.statSync(path.join(dir, name)).isFile(),
    );
  for (const file of licenses)
    output +=
      "```text\n" +
      fs.readFileSync(path.join(dir, file), "utf8").replace(/```/g, "'''") +
      "\n```\n\n";
  if (!licenses.length)
    output +=
      "See the upstream package at https://www.npmjs.com/package/" +
      pkg.name +
      " for license terms.\n\n";
}
fs.writeFileSync("THIRD_PARTY_NOTICES.md", output);
