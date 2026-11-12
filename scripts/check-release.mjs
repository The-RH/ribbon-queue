import { execFileSync } from "node:child_process";
import fs from "node:fs";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
if (!files.length)
  throw Error(
    "No tracked source files; initialize the clean source repository first.",
  );
const issues = [];
for (const name of files) {
  if (
    /(^|\/)(node_modules|data|\.tools|\.work|\.signing|release)(\/|$)|\.(jks|keystore|sqlite|p12|mobileprovision)$|(^|\/)host-secret\.json$/.test(
      name,
    )
  )
    issues.push(name + ": private/build file");
  if (fs.statSync(name).size > 2e6) continue;
  const content = fs.readFileSync(name, "utf8");
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|gho|ghs)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(
      content,
    )
  )
    issues.push(name + ": possible credential");
  if (
    new RegExp(
      ["queue250-entry", "nov10"].join("-") +
        "|" +
        ["appgprj", "6af31f748db081918f998f879d418ec2"].join("_"),
    ).test(content)
  )
    issues.push(name + ": original shop configuration");
}
if (issues.length) throw Error(issues.join("\n"));
console.log(
  `Release source check passed: ${files.length} tracked files; no known private paths or credential patterns.`,
);
