import { NextResponse } from "next/server";
import { getRates } from "@/lib/rates";

// GET /api/rates — currency rates for the ticker (cached 60s upstream).
export async function GET() {
  const rates = await getRates();
  return NextResponse.json({ base: "UZS", rates });
}
