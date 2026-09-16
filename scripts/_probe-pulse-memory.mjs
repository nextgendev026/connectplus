/**
 * Read-only view of the platform-pulse memories and the cron heartbeat table.
 *
 * The pulse is what makes the mind a monitor rather than a dashboard: each run
 * stores its traffic/creator/revenue figures AND the deltas against the previous
 * run. This script prints those rows so the stored numbers and the diff can be
 * inspected directly rather than taken on trust from a summary.
 *
 * READ ONLY.
 *
 * Run: node scripts/_probe-pulse-memory.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const prisma = new PrismaClient();

const pulses = await prisma.neuralMemory.findMany({
  where: { category: "traffic-pulse" },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, content: true, tags: true, confidence: true, metadata: true, createdAt: true, sourceUrl: true, accessCount: true },
});

console.log(`PULSE MEMORIES: ${pulses.length}`);
for (const [i, p] of pulses.entries()) {
  console.log(`\n── pulse ${i + 1} ──`);
  console.log(`id:         ${p.id}`);
  console.log(`createdAt:  ${p.createdAt.toISOString()}`);
  console.log(`sourceUrl:  ${p.sourceUrl}`);
  console.log(`confidence: ${p.confidence}`);
  console.log(`accessCount:${p.accessCount}`);
  console.log(`tags:       ${p.tags}`);
  console.log(`content:\n${p.content}`);
  if (p.metadata) {
    try {
      console.log(`metadata:\n${JSON.stringify(JSON.parse(p.metadata), null, 2)}`);
    } catch {
      console.log(`metadata (raw): ${p.metadata.slice(0, 400)}`);
    }
  }
}

const total = await prisma.neuralMemory.count();
const byCategory = await prisma.neuralMemory.groupBy({ by: ["category"], _count: { id: true } });
console.log(`\nHIVEMEMORY TOTAL: ${total}`);
console.log("by category:", byCategory.map((c) => `${c.category}=${c._count.id}`).join(", "));

await prisma.$disconnect();
