#!/usr/bin/env node
"use strict";
// Final local release gate. Exits 0 only when every engineering criterion passes.
// External gates (licensing, CI, live sources, owner decisions) are reported as
// OPEN and are never counted as passed. Local only: no network, no push, no CI.
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

check("G3", "Nothing pushed: remote branch still at the baseline", () => {
  const remote = git("rev-parse", "origin/feature/elevation-explorer");
  must(remote === BASELINE, "origin/feature/elevation-explorer is " + remote);
  must(git("merge-base", "--is-ancestor", BASELINE, "HEAD") === "", "HEAD does not descend from baseline");
  return "origin/feature/elevation-explorer = " + remote.slice(0, 7) + "; HEAD " + git("rev-parse", "--short", "HEAD") + " builds on it";
});

check("G4", "Deployment and CI configuration unchanged", () => {
  const changed = git("diff", "--name-only", BASELINE, "HEAD", "--", ".github", "vercel.json", ".vercelignore", "package.json");
  must(changed === "", "changed: " + changed);
  return ".github/, vercel.json, .vercelignore, package.json identical to baseline";
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

check("G7", "No secrets or credentials in the repository", () => {
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
  return files.length + " tracked text files scanned, 0 matches";
});

check("G8", "No viewer-time-zone parsing of provider local times", () => {
  const files = git("ls-files", "*.html", "src/*.js", "src/**/*.js").split("\n").filter(Boolean);
  const naive = /new Date\((?:row|item|data|day|f|r)\.(?:valid_time|valid_date|time|date)\)/;
  const hits = files.filter(f => naive.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  must(hits.length === 0, hits.join(", "));
  return files.length + " files scanned";
});

check("G9", "Working tree clean (every change is committed locally)", () => {
  const status = git("status", "--porcelain");
  must(status === "", status);
  return "clean";
});

check("G10", "Documentation present and current", () => {
  const required = ["docs/FINAL_CLOSURE_REPORT.md", "docs/CLOSURE_CHECKLIST.md", "docs/DATA_QUALITY_AUDIT.md", "docs/DATA_SOURCES.md", "docs/GEO_REGISTRY.md", "docs/IMPLEMENTATION_STATUS.md"];
  required.forEach(f => must(fs.existsSync(path.join(ROOT, f)), "missing " + f));
  const sources = fs.readFileSync(path.join(ROOT, "docs/DATA_SOURCES.md"), "utf8");
  const providers = JSON.parse(fs.readFileSync(path.join(ROOT, "config/providers.json"), "utf8")).providers;
  const undocumented = providers.filter(p => !sources.includes(p.id));
  must(undocumented.length === 0, "providers not in DATA_SOURCES.md: " + undocumented.map(p => p.id).join(", "));
  const checklist = fs.readFileSync(path.join(ROOT, "docs/CLOSURE_CHECKLIST.md"), "utf8");
  must(!/\| ⏳ /.test(checklist), "checklist has items still marked in progress");
  return required.length + " documents; " + providers.length + " providers documented; no in-progress checklist items";
});

const EXTERNAL = [
  "NCM written opinion / licence before public launch (docs/MASTER_PRODUCT_PLAN.md §11)",
  "GitHub CI on the pushed branch (forbidden in this phase)",
  "Live checks of Open-Meteo, CHIRPS, OSM tiles and GIBS tile pixels (blocked from this environment)",
  "Owner decision: source for the 4 disputed city coordinates (CHIRPS re-extraction depends on it)",
  "Replace the OSRM demo server before any public launch; confirm Open-Meteo non-commercial use"
];

const passed = results.every(r => r.pass);
const lines = ["Release gate — " + new Date().toISOString() + " — HEAD " + git("rev-parse", "HEAD"), ""];
results.forEach(r => lines.push((r.pass ? "PASS " : "FAIL ") + r.id + "  " + r.title + "\n       " + r.evidence));
lines.push("", "OPEN external gates (not counted as passed):");
EXTERNAL.forEach(item => lines.push("  - " + item));
lines.push("", "ENGINEERING GATE: " + (passed ? "PASSED" : "FAILED"));
console.log(lines.join("\n"));
process.exit(passed ? 0 : 1);
