import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

// Single shared Prisma client. In dev, reuse across hot reloads to avoid
// exhausting connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProd ? ["error"] : ["warn", "error"],
  });

if (!env.isProd) globalForPrisma.prisma = prisma;
