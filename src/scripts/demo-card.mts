// One-off: crop the press photo out of the preserved original template and
// render it through the reproduced template, to demo a finished post.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderTemplateCard } from "../generate/media/templateCard.js";

const ref = await loadImage(resolve("brand/canva-template-reference.png"));
// Crop the upper press-conference photo (above the badge) as a clean source photo.
const cw = 1020;
const ch = 610;
const c = createCanvas(cw, ch);
c.getContext("2d").drawImage(ref, 30, 28, cw, ch, 0, 0, cw, ch);
const photo = c.toBuffer("image/png");

const headline =
  "Toshkentda sun’iy intellekt va raqamli hukumat sohasida xalqaro trening o‘tkazildi";
const buf = await renderTemplateCard({ background: photo, headline });
const out = resolve(".canva-debug/template-sample.png");
await writeFile(out, buf);
console.log(`✓ ${out} (${(buf.length / 1024).toFixed(1)} kb)`);
