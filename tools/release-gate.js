#!/usr/bin/env node
"use strict";
// Local engineering gate. Exits 0 only when every LOCAL check below passes.
// It reads the local repository only: no network, no GitHub API, no CI, no Vercel.
// What it does NOT prove (see NOT_PROVEN at the end): that nothing was pushed or
// deployed, that GitHub Actions or Vercel never ran, that live sources work, that
// the repository holds no secret of any kind, or regulatory compliance.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BASELINE = process.env.GATE_BASELINE || "a59d3974997392dbdc6e95817215009880df09d2";
const results = [];
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
function check(id, title, fn) {
  try {
    const evidence = fn();
    results.push({ id, title, pass: true, evidence });
  } catch (error) {
    results.push({ id, title, pass: false, evidence: error.message });
  }
}
const must = (condition, message) => { if (!condition) throw new Error(message); };

check("G1", "All Node tests pass", () => {
  const run = spawnSync(process.execPath, ["--test"], { cwd: ROOT, encoding: "utf8" });
  const get = key => Number((run.stdout.match(new RegExp("^# " + key + " (\\d+)", "m")) || [])[1]);
  must(run.status === 0 && get("fail") === 0 && get("tests") > 0 && get("cancelled") === 0, "node --test: " + run.stdout.slice(-400));
  return get("tests") + " tests, " + get("pass") + " pass, 0 fail, 0 cancelled";
});

check("G2", "All Python tests pass", () => {
  const run = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], { cwd: ROOT, encoding: "utf8" });
  fs.rmSync(path.join(ROOT, "scripts", "__pycache__"), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "tests", "__pycache__"), { recursive: true, force: true });
  must(run.status === 0 && /\nOK\s*$/.test(run.stderr), run.stderr.slice(-400));
  return (run.stderr.match(/Ran (\d+) tests?/) || [])[0] + ", OK";
});

check("G3", "Local remote-tracking ref equals the baseline; HEAD builds on it", () => {
  // Compares the LOCALLY recorded ref (as of the last fetch) with the baseline.
  // It does not contact GitHub, does not see other branches or forks, and cannot
  // prove that no push happened.
  const remote = git("rev-parse", "origin/feature/elevation-explorer");
  must(remote === BASELINE, "local ref origin/feature/elevation-explorer is " + remote);
  must(git("merge-base", "--is-ancestor", BASELINE, "HEAD") === "", "HEAD does not descend from baseline");
  return "local ref origin/feature/elevation-explorer = " + remote.slice(0, 7) + " (as last fetched; GitHub not queried); HEAD " + git("rev-parse", "--short", "HEAD") + " descends from it";
});

check("G4", "Listed CI/deploy configuration files unchanged in the commits", () => {
  // Diffs only these paths between baseline and HEAD. It does not prove that no
  // deployment, Actions run or Vercel build happened, nor inspect Vercel settings.
  const paths = [".github", "vercel.json", ".vercelignore", "package.json"];
  const changed = git("diff", "--name-only", BASELINE, "HEAD", "--", ...paths);
  must(changed === "", "changed: " + changed);
  return paths.join(", ") + ": no differences between baseline and HEAD";
});

check("G5", "Historical CHIRPS data unchanged", () => {
  must(git("diff", "--name-only", BASELINE, "HEAD", "--", "data/chirps_daily.json") === "", "data/chirps_daily.json changed");
  return "data/chirps_daily.json identical to baseline";
});

check("G6", "Disputed city coordinates unchanged (riyadh, makkah, najran, sakaka)", () => {
  const baseline = git("show", BASELINE + ":index.html");
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config/cities.json"), "utf8"));
  const out = [];
  for (const id of ["riyadh", "makkah", "najran", "sakaka"]) {
    const m = baseline.match(new RegExp(id + ':\\{name:"[^"]+",lat:([\\d.]+),lon:([\\d.]+)\\}'));
    must(m, "baseline coordinate not found for " + id);
    const city = registry.cities.find(c => c.id === id);
    must(city && city.lat === Number(m[1]) && city.lon === Number(m[2]), id + " differs from baseline");
    out.push(id + " " + city.lat + "," + city.lon);
  }
  return out.join("; ");
});

check("G7", "Limited pattern scan for common secret formats", () => {
  // Five regular expressions over tracked text files. Not a comprehensive secret
  // scanner: other key formats, encoded values or untracked files are not covered.
  const files = git("ls-files").split("\n").filter(f => !/\.(png|jpg|ico|geojson)$/.test(f));
  const patterns = [/AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9]{20,}/, /\bghp_[A-Za-z0-9]{30,}/,
    /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i];
  const hits = [];
  for (const file of files) {
    if (file === "tools/release-gate.js") continue;
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    patterns.forEach(p => { if (p.test(text)) hits.push(file + " ~ " + p); });
  }
  must(hits.length === 0, hits.join("; "));
  return files.length + " tracked text files, 5 patterns (AWS key id, PEM private key, sk-, ghp_, quoted api_key/secret/password/token assignment): 0 matches";
});

check("G8", "Pattern check: no new Date(<row>.<time field>) on provider local times", () => {
  // Scope: tracked *.html and src/**/*.js. Pattern: new Date(X.F) where X is one of
  // row|item|data|day|f|r and F is valid_time|valid_date|time|date. A targeted
  // regression check for the bug fixed in 83f16b8, not an audit of all date handling.
  const files = git("ls-files", "*.html", "src/*.js", "src/**/*.js").split("\n").filter(Boolean);
  const naive = /new Date\((?:row|item|data|day|f|r)\.(?:valid_time|valid_date|time|date)\)/;
  const hits = files.filter(f => naive.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  must(hits.length === 0, hits.join(", "));
  return files.length + " files (tracked *.html, src/**/*.js), 1 pattern: 0 matches";
});

check("G9", "Working tree clean (every change is committed locally)", () => {
  const status = git("status", "--porcelain");
  must(status === "", status);
  return "clean";
});

check("G10", "Required documents exist; every provider id is named in DATA_SOURCES.md; no in-progress checklist rows", () => {
  // Checks presence and cross-references only. It does not verify that the prose
  // of the documents is up to date or correct.
  const required = ["docs/FINAL_CLOSURE_REPORT.md", "docs/CLOSURE_CHECKLIST.md", "docs/DATA_QUALITY_AUDIT.md", "docs/DATA_SOURCES.md", "docs/GEO_REGISTRY.md", "docs/IMPLEMENTATION_STATUS.md"];
  required.forEach(f => must(fs.existsSync(path.join(ROOT, f)), "missing " + f));
  const sources = fs.readFileSync(path.join(ROOT, "docs/DATA_SOURCES.md"), "utf8");
  const providers = JSON.parse(fs.readFileSync(path.join(ROOT, "config/providers.json"), "utf8")).providers;
  const undocumented = providers.filter(p => !sources.includes(p.id));
  must(undocumented.length === 0, "providers not in DATA_SOURCES.md: " + undocumented.map(p => p.id).join(", "));
  const checklist = fs.readFileSync(path.join(ROOT, "docs/CLOSURE_CHECKLIST.md"), "utf8");
  must(!/\| ⏳ /.test(checklist), "checklist has items still marked in progress");
  return required.length + " documents present; " + providers.length + "/" + providers.length + " provider ids named in DATA_SOURCES.md; 0 in-progress checklist rows (content freshness not checked)";
});

const EXTERNAL = [
  "NCM written opinion on classification and regulatory requirements (docs/MASTER_PRODUCT_PLAN.md §11)",
  "Live verification of Open-Meteo and CHIRPS (not reachable from the development environment)",
  "Owner decision: the 4 city coordinates that differ from Natural Earth (riyadh, makkah, najran, sakaka)",
  "Owner decision: the 7-day margin on the CHIRPS final release cycle",
  "Owner decision: activating the research-stage services",
  "Replace the OSRM demo server before any public launch",
  "GitHub CI on the final version (not run in this phase)"
];

const NOT_PROVEN = [
  "that nothing was pushed (G3 reads a local ref only; GitHub is not queried)",
  "that no deployment, GitHub Actions run or Vercel build happened (G4 diffs listed files only)",
  "that live external sources work or return correct data",
  "that the repository contains no secret of any kind (G7 is a limited pattern scan)",
  "that all date/time handling is correct (G8 is one regression pattern)",
  "that document content is current (G10 checks presence and ids)",
  "regulatory compliance or readiness for public release"
];

const passed = results.every(r => r.pass);
const lines = ["Release gate — " + new Date().toISOString() + " — HEAD " + git("rev-parse", "HEAD"), ""];
results.forEach(r => lines.push((r.pass ? "PASS " : "FAIL ") + r.id + "  " + r.title + "\n       " + r.evidence));
lines.push("", "OPEN external gates (not counted as passed):");
EXTERNAL.forEach(item => lines.push("  - " + item));
lines.push("", "This gate does NOT prove:");
NOT_PROVEN.forEach(item => lines.push("  - " + item));
lines.push("", "LOCAL ENGINEERING GATE: " + (passed ? "PASSED" : "FAILED"));
console.log(lines.join("\n"));
process.exit(passed ? 0 : 1);
