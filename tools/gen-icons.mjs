// tools/gen-icons.mjs
import fs from "node:fs/promises";
import sharp from "sharp";

const SRC = "public/favicon.svg";              // your SVG
const OUT = "public";
const BG  = "#111827";                         // background behind iOS icon (avoid transparency)
const PADDING = 0.12;                          // 12% safe padding so small sizes look good

const pngJobs = [
  { file: "favicon-16x16.png",  size: 16  },
  { file: "favicon-32x32.png",  size: 32  },
  { file: "apple-touch-icon.png", size: 180 },     // iOS home screen
  { file: "android-chrome-192x192.png", size: 192 },
  { file: "android-chrome-512x512.png", size: 512 },
  { file: "maskable-icon-512.png", size: 512, maskable: true },
];

const icoSizes = [16, 32, 48];

const svg = await fs.readFile(SRC);

// Utility to render the SVG with padding into a square PNG
async function renderPadded(size, { maskable = false } = {}) {
  const inner = Math.round(size * (1 - 2 * PADDING)); // icon content area
  // Render SVG at a high density so it’s crisp when scaled
  const rendered = await sharp(svg, { density: 512 })
    .resize(inner, inner, { fit: "contain" })
    .png()
    .toBuffer();

  // Composite onto background square (iOS prefers non-transparent)
  // For "maskable", keep transparent background.
  const background = maskable ? { r:0, g:0, b:0, alpha:0 } : BG;

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{
      input: rendered,
      left: Math.round((size - inner) / 2),
      top:  Math.round((size - inner) / 2),
    }])
    .png()
    .toBuffer();
}

for (const job of pngJobs) {
  const buf = await renderPadded(job.size, { maskable: job.maskable });
  await fs.writeFile(`${OUT}/${job.file}`, buf);
  console.log("wrote", job.file);
}

// Build favicon.ico (16/32/48) – Windows & older browsers
const icoBuffers = await Promise.all(
  icoSizes.map(s =>
    sharp(svg, { density: 512 })
      .resize(Math.round(s*(1-2*PADDING)), Math.round(s*(1-2*PADDING)))
      .png()
      .toBuffer()
      .then(content =>
        sharp({
          create: { width: s, height: s, channels: 4, background: BG }
        }).composite([{ input: content,
          left: Math.round(s*PADDING), top: Math.round(s*PADDING) }])
          .png().toBuffer()
      )
  )
);
await sharp(icoBuffers[0])
  .joinChannel(icoBuffers.slice(1)) // not strictly necessary; sharp packs frames via .toFormat('ico')
  .toFormat("ico", { sizes: icoSizes })
  .toFile(`${OUT}/favicon.ico`);
console.log("wrote favicon.ico");
