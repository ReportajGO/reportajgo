import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Match the policy enforced by the ensure-admin bootstrap (scripts/ensure-admin.cjs).
const MIN_LENGTH = 12;

/**
 * POST /api/account/password — change the signed-in admin's password.
 *
 * Requires the current password (verified against the stored bcrypt hash) plus
 * a new password of at least MIN_LENGTH characters. Errors are returned as
 * stable codes ("tooShort" | "sameAsOld" | "wrongCurrent") so the client can
 * localize them.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { currentPassword?: string; newPassword?: string }
    | null;
  const currentPassword = body?.currentPassword ?? "";
  const newPassword = body?.newPassword ?? "";

  if (newPassword.length < MIN_LENGTH)
    return NextResponse.json({ error: "tooShort" }, { status: 400 });
  if (newPassword === currentPassword)
    return NextResponse.json({ error: "sameAsOld" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) return NextResponse.json({ error: "wrongCurrent" }, { status: 400 });

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hash },
  });

  return NextResponse.json({ ok: true });
}
