/**
 * Feed the Neural Mind: seed the hive knowledge base (topics, entities, intent
 * maps and lessons) on an existing database without re-running the full seed.
 *
 * Additive + idempotent — seeded memories are tagged and replaced on re-run.
 *
 * Run: npm run db:feed-mind  (or npx ts-node scripts/feed-the-mind.ts)
 */
import { PrismaClient } from "@prisma/client";
import { seedNeuralMind } from "../prisma/seed-neural.ts";

const prisma = new PrismaClient();

async function main() {
  console.log("🧠 Feeding the Neural Mind...");
  const count = await seedNeuralMind(prisma);
  console.log(`✅ Seeded ${count} knowledge memories (topics, entities, intent maps, lessons).`);
  console.log("   Ask the Neural Mind anything — it now has East African context baked in.");
}

main()
  .catch((e) => {
    console.error("Feed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });