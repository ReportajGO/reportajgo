// Generate sample headlines with the live generator to eyeball quality.
//   npx tsx src/scripts/test-headlines.mts
import { generateCardHeadline } from "../generate/copy/headline.js";

const SAMPLES = [
  {
    title: "Uzbekistan and Tony Blair discuss development cooperation",
    summary:
      "President Shavkat Mirziyoyev met Tony Blair to discuss Uzbekistan's development concept until 2050 and prospects for cooperation.",
  },
  {
    title: "Earthquake in Afghanistan felt across Uzbekistan",
    summary:
      "A strong earthquake originating in Afghanistan was felt in almost all regions of Uzbekistan on Friday night.",
  },
  {
    title: "Venezuela earthquake death toll rises",
    summary:
      "Officials say the number of people killed in the recent earthquakes in Venezuela has risen to 235, with hundreds injured.",
  },
  {
    title: "Cannavaro comments before Congo DR match",
    summary:
      "Coach Fabio Cannavaro said Uzbekistan always strives to be an attacking team, speaking ahead of the friendly against DR Congo.",
  },
  {
    title: "Uzbekistan plans to restrict social media for children under 16",
    summary:
      "Uzbekistan plans to restrict use of social networks by children under 16, following similar measures abroad.",
  },
  {
    title: "IBM announces microchip breakthrough",
    summary:
      "IBM announced a major breakthrough in the microchip industry that will enable production of chips smaller than 1 nanometer.",
  },
];

for (const s of SAMPLES) {
  try {
    const h = await generateCardHeadline(s, "uz");
    console.log(`• ${h}\n   ↳ from: ${s.title}\n`);
  } catch (err) {
    console.log(`• [FAILED: ${err instanceof Error ? err.message : err}] from: ${s.title}\n`);
  }
}
process.exit(0);
