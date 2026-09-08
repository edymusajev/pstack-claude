import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
}

export function checkout(cwd) {
  const root = fs.realpathSync(git(cwd, "rev-parse", "--show-toplevel").trim());
  const dir = git(root, "rev-parse", "--absolute-git-dir").trim();
  return { root, dir, lease: path.join(dir, "pstack-writer"), checkpoint: path.join(dir, "pstack-checkpoint.json") };
}

export function fingerprint(cwd) {
  const hash = createHash("sha256").update(git(cwd, "rev-parse", "HEAD"));
  hash.update(git(cwd, "diff", "--cached", "HEAD", "--binary", "--no-ext-diff"));
  hash.update(git(cwd, "diff", "--binary", "--no-ext-diff"));
  for (const file of git(cwd, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).sort()) {
    const full = path.join(cwd, file);
    hash.update(file).update("\0");
    hash.update(fs.lstatSync(full).isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full));
  }
  return hash.digest("hex");
}

export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJSON(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function inside(file, root) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function canonical(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent = path.dirname(file);
  return parent === file ? file : path.join(canonical(parent), path.basename(file));
}
