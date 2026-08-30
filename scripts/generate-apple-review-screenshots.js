#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "screenshots", "readmate-mobile-current");
const outputRoot = path.join(root, "store-assets", "app-review-2026-07-11", "ios");

const slides = [
  { file: "01-home.png", title: "Your reading, ready anywhere", subtitle: "Save, listen, and resume across devices" },
  { file: "02-sources.png", title: "Add anything in seconds", subtitle: "Links, RSS feeds, documents, and more" },
];

const phoneTargets = [
  { directory: "iphone-6.9-1290x2796", width: 1290, height: 2796 },
  { directory: "iphone-6.5-1284x2778", width: 1284, height: 2778 },
];

async function renderPhone(slide, target, index) {
  const directory = path.join(outputRoot, target.directory, "en-US");
  await fs.mkdir(directory, { recursive: true });
  await sharp(path.join(sourceRoot, "iphone", slide.file))
    .resize(target.width, target.height, { fit: "cover", position: "top" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(directory, `${String(index + 1).padStart(2, "0")}-${path.parse(slide.file).name}.png`));
}

async function renderIPad(slide, index) {
  const width = 2048;
  const height = 2732;
  const screenWidth = 1640;
  const screenHeight = 2360;
  const screen = await sharp(path.join(sourceRoot, "ipad-11", slide.file))
    .resize(screenWidth, screenHeight, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const background = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#f7f2e7"/>
      <circle cx="180" cy="210" r="250" fill="#2f6861" opacity="0.08"/>
      <circle cx="1900" cy="2510" r="360" fill="#6b2637" opacity="0.07"/>
      <text x="1024" y="122" text-anchor="middle" font-family="Inter, SF Pro Display, Arial, sans-serif" font-size="82" font-weight="800" fill="#21231e">${slide.title}</text>
      <text x="1024" y="196" text-anchor="middle" font-family="Inter, SF Pro Text, Arial, sans-serif" font-size="36" font-weight="600" fill="#596058">${slide.subtitle}</text>
      <rect x="170" y="258" width="1708" height="2440" rx="54" fill="#ffffff" stroke="#ded7ca" stroke-width="4"/>
    </svg>
  `);
  const directory = path.join(outputRoot, "ipad-13-portrait-2048x2732", "en-US");
  await fs.mkdir(directory, { recursive: true });
  await sharp(background)
    .composite([{ input: screen, left: 204, top: 294 }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(directory, `${String(index + 1).padStart(2, "0")}-${path.parse(slide.file).name}.png`));
}

async function main() {
  for (let index = 0; index < slides.length; index += 1) {
    for (const target of phoneTargets) await renderPhone(slides[index], target, index);
    await renderIPad(slides[index], index);
  }
  console.log(`Generated Apple review screenshots in ${path.relative(root, outputRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
