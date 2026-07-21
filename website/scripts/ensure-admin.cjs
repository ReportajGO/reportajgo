const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const MIN_LENGTH = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  // Recovery switch: re-apply ADMIN_PASSWORD to an EXISTING admin. Off by
  // default so a routine restart never clobbers a password the admin changed
  // in-app (Settings → Security).
  const force = process.env.ADMIN_PASSWORD_FORCE === "1";

  if (!email) throw new Error("ADMIN_EMAIL is required");

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const data = { role: "admin" };
    if (force) {
      if (!password || password.length < MIN_LENGTH) {
        throw new Error(
          "ADMIN_PASSWORD (>=12 chars) is required when ADMIN_PASSWORD_FORCE=1",
        );
      }
      data.password = await bcrypt.hash(password, 12);
    }
    await prisma.user.update({ where: { email }, data });
    console.log(
      force
        ? "admin password reset from ADMIN_PASSWORD"
        : "admin user ensured (existing password kept)",
    );
    return;
  }

  // First-time bootstrap — a valid password is required to create the account.
  if (!password || password.length < MIN_LENGTH) {
    throw new Error(
      "ADMIN_PASSWORD is required and must be at least 12 characters",
    );
  }
  const hash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, name: "Editor", password: hash, role: "admin" },
  });
  console.log("admin user created");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
