#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "screenshots", "readmate-mobile");
const outputRoot = path.join(root, "store-assets", "generated-screenshots");

const slides = [
  {
    title: ["Save and", "Sync"],
    kicker: "Your reading library follows you",
    source: "03-library.png",
    accent: "#2f6df6",
  },
  {
    title: ["Listen", "Naturally"],
    kicker: "Turn long reads into calm audio",
    source: "07-article-detail-learning-sections.png",
    accent: "#0f766e",
  },
  {
    title: ["Study", "Smarter"],
    kicker: "Summaries, flashcards, and quizzes",
    source: "05-learning.png",
    accent: "#7c3aed",
  },
  {
    title: ["Read", "Anywhere"],
    kicker: "Resume progress across devices",
    source: "02-home.png",
    accent: "#db2777",
  },
  {
    title: ["Catch Key", "Points"],
    kicker: "Highlights and notes stay organized",
    source: "06-learning-detail-top.png",
    accent: "#ea580c",
  },
  {
    title: ["Add Any", "Source"],
    kicker: "Articles, PDFs, feeds, and text",
    source: "08-add-sources.png",
    accent: "#2563eb",
  },
  {
    title: ["Find It", "Fast"],
    kicker: "Search and save what matters",
    source: "08-add-sources-search.png",
    accent: "#16a34a",
  },
  {
    title: ["Keep Your", "Flow"],
    kicker: "History, settings, and playback together",
    source: "04-history.png",
    accent: "#111827",
  },
];

const targets = [
  {
    name: "ios/iphone-6.9/1290x2796/en-US",
    width: 1290,
    height: 2796,
    headingSize: 108,
    kickerSize: 38,
    top: 130,
    screenWidth: 742,
    screenY: 760,
    shadow: true,
  },
  {
    name: "ios/iphone-6.5/1284x2778/en-US",
    width: 1284,
    height: 2778,
    headingSize: 108,
    kickerSize: 38,
    top: 128,
    screenWidth: 738,
    screenY: 755,
    shadow: true,
  },
  {
    name: "android/phone-16x9/1080x1920/en-US",
    width: 1080,
    height: 1920,
    headingSize: 76,
    kickerSize: 30,
    top: 86,
    screenWidth: 580,
    screenY: 485,
    shadow: true,
  },
  {
    name: "ios/ipad-13-portrait/2048x2732/en-US",
    width: 2048,
    height: 2732,
    headingSize: 118,
    kickerSize: 42,
    top: 122,
    screenWidth: 930,
    screenY: 605,
    shadow: true,
  },
  {
    name: "ios/ipad-13-landscape/2732x2048/en-US",
    width: 2732,
    height: 2048,
    headingSize: 126,
    kickerSize: 44,
    top: 265,
    screenWidth: 720,
    screenY: 210,
    landscape: true,
    shadow: true,
  },
];

const htmlEscape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function textBlock(lines, x, y, size, color, anchor = "middle", weight = 800) {
  const lineHeight = Math.round(size * 1.08);
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-family="Inter, SF Pro Display, Arial, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="0" fill="${color}">${htmlEscape(line)}</text>`,
    )
    .join("");
}

function baseSvg(slide, target) {
  const { width, height, landscape } = target;
  const centerX = Math.round(width / 2);
  const textX = landscape ? 210 : centerX;
  const anchor = landscape ? "start" : "middle";
  const titleY = target.top + target.headingSize;
  const titleBlock = textBlock(
    slide.title,
    textX,
    titleY,
    target.headingSize,
    "#111827",
    anchor,
    850,
  );
  const kickerY =
    titleY + slide.title.length * Math.round(target.headingSize * 1.08) + Math.round(target.kickerSize * 1.2);
  const kicker = `<text x="${textX}" y="${kickerY}" text-anchor="${anchor}" font-family="Inter, SF Pro Text, Arial, sans-serif" font-size="${target.kickerSize}" font-weight="650" letter-spacing="0" fill="#4b5563">${htmlEscape(slide.kicker)}</text>`;
  const accentX = landscape ? textX : Math.round(centerX - 56);
  const accentY = titleY - Math.round(target.headingSize * 1.24);

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#f7f9fc"/>
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" opacity="0.56"/>
    <circle cx="${Math.round(width * 0.08)}" cy="${Math.round(height * 0.1)}" r="${Math.round(width * 0.1)}" fill="${slide.accent}" opacity="0.08"/>
    <circle cx="${Math.round(width * 0.9)}" cy="${Math.round(height * 0.86)}" r="${Math.round(width * 0.16)}" fill="${slide.accent}" opacity="0.06"/>
    <rect x="${accentX}" y="${accentY}" width="${landscape ? 132 : 112}" height="${landscape ? 15 : 13}" rx="7" fill="${slide.accent}"/>
    ${titleBlock}
    ${kicker}
  </svg>`;
}

function frameSvg(x, y, outerW, outerH, radius, border, shadow, accent) {
  const shadowMarkup = shadow
    ? `<filter id="shadow" x="-30%" y="-20%" width="160%" height="150%">
        <feDropShadow dx="0" dy="28" stdDeviation="26" flood-color="#101827" flood-opacity="0.18"/>
       </filter>`
    : "";
  return `
  <svg width="${outerW + 120}" height="${outerH + 120}" viewBox="0 0 ${outerW + 120} ${outerH + 120}" xmlns="http://www.w3.org/2000/svg">
    <defs>${shadowMarkup}</defs>
    <rect x="60" y="38" width="${outerW}" height="${outerH}" rx="${radius}" fill="#ffffff" ${shadow ? 'filter="url(#shadow)"' : ""}/>
    <rect x="60" y="38" width="${outerW}" height="${outerH}" rx="${radius}" fill="#fdfefe" stroke="#d8dee8" stroke-width="${border}"/>
    <rect x="${60 + border}" y="${38 + border}" width="${outerW - border * 2}" height="${outerH - border * 2}" rx="${Math.max(18, radius - border)}" fill="#ffffff"/>
    <rect x="${60 + Math.round(outerW * 0.39)}" y="${38 + Math.round(border * 0.6)}" width="${Math.round(outerW * 0.22)}" height="${Math.round(border * 0.5)}" rx="${Math.round(border * 0.25)}" fill="${accent}" opacity="0.72"/>
  </svg>`;
}

async function roundedImage(inputPath, width, height, radius) {
  const metadata = await sharp(inputPath).metadata();
  const cropTop = Math.min(130, Math.max(0, (metadata.height ?? 0) - 900));
  const image = await sharp(inputPath)
    .extract({
      left: 0,
      top: cropTop,
      width: metadata.width,
      height: metadata.height - cropTop,
    })
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`,
  );
  return sharp(image).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

async function renderSlide(slide, target, index) {
  const canvas = sharp(Buffer.from(baseSvg(slide, target))).png();
  const sourcePath = path.join(sourceDir, slide.source);

  const screenW = target.screenWidth;
  const screenH = Math.round(screenW * (2400 / 1080));
  const border = Math.max(16, Math.round(screenW * 0.035));
  const outerW = screenW + border * 2;
  const outerH = screenH + border * 2;
  const radius = Math.round(screenW * 0.09);
  const screenRadius = Math.max(22, radius - border);
  const screenX = target.landscape ? Math.round(target.width * 0.58) : Math.round((target.width - screenW) / 2);
  const screenY = target.screenY;
  const outerX = screenX - border;
  const outerY = screenY - border;

  const frame = Buffer.from(frameSvg(outerX, outerY, outerW, outerH, radius, border, target.shadow, slide.accent));
  const screenshot = await roundedImage(sourcePath, screenW, screenH, screenRadius);

  const composites = [
    { input: frame, left: outerX - 60, top: outerY - 38 },
    { input: screenshot, left: screenX, top: screenY },
  ];

  if (target.landscape) {
    const chipSvg = Buffer.from(`
      <svg width="780" height="310" viewBox="0 0 780 310" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="780" height="310" rx="42" fill="#ffffff" stroke="#e3e8f0" stroke-width="3"/>
        ${["Save", "Listen", "Study", "Sync"].map((label, i) => {
          const x = 52 + i * 176;
          return `<rect x="${x}" y="92" width="132" height="92" rx="28" fill="${i === 0 ? slide.accent : "#eef2f7"}" opacity="${i === 0 ? "0.98" : "1"}"/>
            <text x="${x + 66}" y="150" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="31" font-weight="800" fill="${i === 0 ? "#fff" : "#111827"}">${label}</text>`;
        }).join("")}
        <text x="52" y="244" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="720" fill="#111827">One calm library for every long read.</text>
      </svg>`);
    composites.push({ input: chipSvg, left: 210, top: 1125 });
  }

  const outputDir = path.join(outputRoot, target.name);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${slugify(slide.title.join(" "))}.png`);
  await canvas.composite(composites).png({ compressionLevel: 9 }).toFile(outputPath);
  return outputPath;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function copyListingAssets() {
  const listingDir = path.join(outputRoot, "google-play-listing");
  await fs.mkdir(listingDir, { recursive: true });
  await fs.copyFile(path.join(sourceDir, "play-feature-graphic.png"), path.join(listingDir, "feature-graphic-1024x500.png"));
  await fs.copyFile(path.join(sourceDir, "play-icon-512.png"), path.join(listingDir, "icon-512x512.png"));
}

async function main() {
  await fs.rm(outputRoot, { recursive: true, force: true });
  const outputs = [];
  for (const target of targets) {
    for (let index = 0; index < slides.length; index += 1) {
      outputs.push(await renderSlide(slides[index], target, index));
    }
  }
  await copyListingAssets();
  const manifest = {
    generatedAt: new Date().toISOString(),
    app: "ReadMate AI",
    locale: "en-US",
    sourceDir: path.relative(root, sourceDir),
    outputs: outputs.map((file) => path.relative(root, file)),
    listingAssets: [
      "store-assets/generated-screenshots/google-play-listing/feature-graphic-1024x500.png",
      "store-assets/generated-screenshots/google-play-listing/icon-512x512.png",
    ],
  };
  await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${outputs.length} screenshots in ${path.relative(root, outputRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
