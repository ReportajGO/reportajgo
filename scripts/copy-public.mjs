// Copies the dashboard's static UI into dist after tsc (tsc only emits .js).
import { cp } from "node:fs/promises";

await cp("src/dashboard/public", "dist/dashboard/public", { recursive: true });
console.log("copied dashboard public assets -> dist/dashboard/public");
