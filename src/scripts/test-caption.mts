// Eyeball the Telegram channel caption.
//   npx tsx src/scripts/test-caption.mts
import { buildTelegramCaption } from "../publish/telegram.js";

const caption = buildTelegramCaption({
  platform: "TELEGRAM",
  body:
    "Raqamli texnologiyalar vazirligi hamda BMTning ESCAP komissiyasi huzuridagi APCICT markazi hamkorligida salohiyatni oshirish dasturi tashkil etildi.\n\n" +
    "⚙️ Asosiy tafsilotlar:\n" +
    "Ishtirokchilar — shahar va tuman hokimliklarining raqamlashtirish bo‘yicha maslahatchilari.\n" +
    "O‘quv yo‘nalishlari — davlat xizmatlariga sun’iy intellekt yechimlarini joriy etish.\n" +
    "Amaliy natija — zamonaviy texnologiyalardan foydalanish salohiyati mustahkamlandi.\n\n" +
    "Dastur mahalliy boshqaruv organlari vakillari uchun foydali bo‘ldi.",
  hashtags: ["OzbekistonYangiliklari", "AI", "RaqamliHukumat"],
  media: [{ type: "IMAGE", url: "https://example.com/card.png" }],
  article: {
    title: "Toshkentda sun’iy intellekt va raqamli hukumat sohasida xalqaro trening o‘tkazildi",
    excerpt: "",
    language: "uz",
  },
  articleUrl: "https://reportajgo.uz/uz/article/toshkentda-suniy-intellekt-trening",
});

console.log("─".repeat(60));
console.log(caption);
console.log("─".repeat(60));
const visible = caption.replace(/<[^>]+>/g, "").length;
console.log(`visible length: ${visible} (cap 1024)`);
process.exit(0);
