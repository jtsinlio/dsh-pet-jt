// 图标后处理：把生图候选裁成 512×512 圆角 PNG，并额外产出一份 64×64 的 alpha 剪影
// （设置页导航那一行用 CSS mask，只吃 alpha，所以必须是"有形状的透明图"）。
//
// 用法：node scripts/dev/prepare-icons.mjs
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const dir = 'assets/icon-candidates';
const SIZE = 512;
const R = Math.round(SIZE * 0.22); // 圆角半径 ≈ 22%（与 DSH 里其它插件图标的观感一致）

const roundedMask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${R}" ry="${R}" fill="#fff"/></svg>`,
);

for (let i = 1; i <= 5; i += 1) {
  const src = `${dir}/c${i}.jpg`;
  // 1) 裁掉右下角服务商水印（768×768 → 700×700 顶对齐，水印在 y≈715 以下）
  // 2) 缩放 512 并套圆角 alpha
  const base = await sharp(src).extract({ left: 34, top: 0, width: 700, height: 700 }).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer();
  const out = await sharp(base)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`${dir}/c${i}.png`, out);
  console.log(`c${i}.png ${out.length}B`);
}

// 导航图标剪影：取第 5 张（玩偶小鲸鱼），按"与背景色的距离"抠出主体 alpha。
const srcFile = process.argv[2] ?? `${dir}/c5.jpg`;
const raw = await sharp(srcFile).resize(128, 128, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { data, info } = raw;
// 背景色 = 四角平均
const cornerIdx = [0, (info.width - 1) * info.channels, (info.height - 1) * info.width * info.channels, (info.width * info.height - 1) * info.channels];
let br = 0, bg = 0, bb = 0;
for (const idx of cornerIdx) { br += data[idx]; bg += data[idx + 1]; bb += data[idx + 2]; }
br /= 4; bg /= 4; bb /= 4;
const alpha = Buffer.alloc(info.width * info.height);
for (let p = 0; p < alpha.length; p += 1) {
  const o = p * info.channels;
  const d = Math.hypot(data[o] - br, data[o + 1] - bg, data[o + 2] - bb);
  // 距离 < 18 视为背景，> 55 视为实心；中间线性过渡（软边，缩到 16px 不会锯齿）
  alpha[p] = Math.max(0, Math.min(255, Math.round(((d - 18) / 37) * 255)));
}
const silhouette = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
  .composite([{ input: { raw: { width: info.width, height: info.height, channels: 1 }, }, blend: 'dest-in' }])
  .png()
  .toBuffer()
  .catch(() => null);
// 上面的写法在 sharp 里不可靠：直接构造 RGBA 更稳
const rgba = Buffer.alloc(info.width * info.height * 4);
for (let p = 0; p < alpha.length; p += 1) {
  rgba[p * 4] = 255; rgba[p * 4 + 1] = 255; rgba[p * 4 + 2] = 255; rgba[p * 4 + 3] = alpha[p];
}
const sil = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .resize(64, 64)
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(`${dir}/nav-mask.png`, sil);
console.log(`nav-mask.png ${sil.length}B (base64 ≈ ${Math.round((sil.length * 4) / 3)}B)`);
void silhouette;
