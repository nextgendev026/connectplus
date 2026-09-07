/**
 * Promote existing ADMIN accounts to SUPER_ADMIN.
 *
 * One-time upgrade helper: seeds create the super admin for fresh databases
 * (see prisma/seed.ts), but databases seeded before that change still hold the
 * admin account with role "ADMIN". Run `npm run db:promote-admin` after
 * deploying to upgrade every existing ADMIN (including connect@plus.com) to
 * SUPER_ADMIN so the new Settings & Integrations console unlocks fully.
 *
 * Idempotent — safe to run multiple times.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.updateMany({
    where: { role: "ADMIN" },
    data: { role: "SUPER_ADMIN" },
  });

  const superAdmins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { email: true, name: true },
  });

  console.log(`✅ Promoted ${result.count} account(s) to SUPER_ADMIN.`);
  console.log(`   Super admins now on the platform (${superAdmins.length}):`);
  for (const admin of superAdmins) {
    console.log(`   • ${admin.name ?? "—"} <${admin.email}>`);
  }
  console.log("\nSign out and back in (or clear cookies) to pick up the new role in your session.");
}

main()
  .catch((e) => {
    console.error("Promotion failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });