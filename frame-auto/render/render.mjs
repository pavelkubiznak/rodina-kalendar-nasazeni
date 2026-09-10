// node render/render.mjs data.json frame.jpg
// npm i -D playwright   (v CI staci: npx playwright install --with-deps chromium)
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { plakat } from "./template.mjs";
import { vejitSe } from "./vejit.mjs";

const [, , dataPath = "render/priklad-data.json", out = "frame.jpg"] = process.argv;
const data = JSON.parse(readFileSync(dataPath, "utf8"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
await page.setContent(plakat(data), { waitUntil: "load" });
await page.waitForTimeout(300);
const v = await vejitSe(page);
if (v.vynechano.length) console.log("nevejde se, vynechano:", v.vynechano.join(" | "));
if (Math.max(v.levy, v.pravy) > v.limit) console.warn(`POZOR: plakat pretika (levy ${v.levy}, pravy ${v.pravy}, limit ${v.limit} px)`);
const buf = await page.screenshot({ type: "jpeg", quality: 95 });
writeFileSync(out, buf);
await browser.close();
console.log("napsano", out, buf.length, "B");
