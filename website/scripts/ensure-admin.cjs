const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email) throw new Error("ADMIN_EMAIL is required");
  if (!password || password.length < 12) {
    throw new Error("ADMIN_PASSWORD is required and must be at least 12 characters");
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { password: hash, role: "admin" },
    create: { email, name: "Editor", password: hash, role: "admin" },
  });

  console.log("admin user ensured");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
