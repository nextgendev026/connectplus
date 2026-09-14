// Byte-safe wrapper: runs `node node_modules/prisma/build/index.js migrate resolve --applied`
// and writes the FULL result byte-true via node fs to the file given in resolve-out.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = process.env.RESOLVE_OUT;
const CWD = "E:\\dev.nyash\\connectplus";
const cliJs = CWD + "\\node_modules\\prisma\\build\\index.js";
const name = "20260912120000_stripe_pipeline";

const r = spawnSync(process.execPath, [cliJs, "migrate", "resolve", "--applied", name], {
  cwd: CWD,
  encoding: "utf8",
  timeout: 240000,
  env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  maxBuffer: 16 * 1024 * 1024,
});

const outLines = [
  "rc=" + (r.status === null ? "TIMEOUT/KILLED" : r.status),
  "== stdout ==",
  String(r.stdout || ""),
  "== stderr ==",
  String(r.stderr || ""),
  "",
  "== done ==",
];
writeFileSync(OUT, outLines.join("\n"), "utf8");
console.log((r.status === null ? "TIMEOUT" : "rc=" + r.status) + " b=" + (require("node:fs").statSync(OUT).size));
