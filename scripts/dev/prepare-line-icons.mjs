// 第二批候选后处理：把「涂色书插画」洗成**极简线条 logo**。
//
// 为什么不用"亮度阈值"：模型给的是带填充与渐变的插画，直接阈值会把整块身体压成实心色块。
// 这里改用**拉普拉斯边缘**（先高斯降噪，再取二阶导），只保留颜色交界处的轮廓线；
// 再上采样+模糊+阈值把线加粗一档，最后染成 DeepSeek 蓝、居中放进白色圆角画布。
//
// 用法：node scripts/dev/prepare-line-icons.mjs [--probe <src>]
import sharp from 'sharp';
import { writeFileSync, existsSync } from 'node:fs';

const SIZE = 512;
const PAD = 66;
const R = Math.round(SIZE * 0.22);
const INK = { r: 77, g: 107, b: 254 }; // #4D6BFE

const roundedMask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${R}" ry="${R}" fill="#fff"/></svg>`,
);

/** alpha(0..255) 单通道 → 品牌蓝线稿，居中放进白底圆角画布 */
async function compose(alpha, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = INK.r;
    rgba[p * 4 + 1] = INK.g;
    rgba[p * 4 + 2] = INK.b;
    rgba[p * 4 + 3] = alpha[p];
  }
  const lines = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize(SIZE - PAD * 2, SIZE - PAD * 2, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const canvas = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: lines, gravity: 'center' }])
    .png()
    .toBuffer();
  return sharp(canvas).composite([{ input: roundedMask, blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
}

/** 一张插画 → 极简蓝线图标 */
async function toLineIcon(src) {
  // 1) 切掉右下角水印 + 内缩 5%（甩掉照片里贴边的桌面/手机边，它们会变成一条假"线"）
  const inset = Math.round(700 * 0.05);
  const cropped = sharp(src).extract({
    left: 34 + inset,
    top: inset,
    width: 700 - inset * 2,
    height: 700 - inset * 2,
  });
  // 2) 降噪后取拉普拉斯边缘（3×3、中心权重 8）：只有"颜色交界"会留下高值
  const blurred = await cropped.clone().greyscale().blur(1.6).toBuffer();
  const lap = await sharp(blurred)
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
    .toBuffer();
  // 3) 自适应阈值：每张图的对比度不一样（有的线深、有的线浅），固定阈值会把浅的那批发成空白。
  //    取拉普拉斯响应的 mean + 1.2σ 作为分界——统计量来自图本身，不猜。
  const stats = await sharp(lap).stats();
  const ch = stats.channels[0];
  const th = Math.min(120, Math.max(8, Math.round(ch.mean + ch.stdev * 1.2)));
  const edges = await sharp(lap).threshold(th).toBuffer();
  console.log(`  lap mean=${ch.mean.toFixed(1)} σ=${ch.stdev.toFixed(1)} → threshold ${th}`);
  // 4) 裁到线条包围盒（找不到边就退回整张，后面会得到一张空白图标）
  let trimmed;
  try {
    trimmed = await sharp(edges).trim({ threshold: 20 }).toBuffer();
  } catch {
    trimmed = edges;
  }
  // 5) 线加粗一档：放大 → 轻微模糊 → 阈值（等价于"膨胀"），缩回时线条更实、更像 logo
  const fat = await sharp(trimmed)
    .resize(1100, 1100, { fit: 'inside', kernel: 'nearest' })
    .blur(2.8)
    .threshold(28)
    .toBuffer();
  const { data, info } = await sharp(fat).greyscale().raw().toBuffer({ resolveWithObject: true });
  // 6) 反相成 alpha：线（白）→ 不透明
  const alpha = Buffer.alloc(info.width * info.height);
  for (let p = 0; p < alpha.length; p += 1) alpha[p] = data[p] > 100 ? 255 : 0;
  return compose(alpha, info.width, info.height);
}

const probeIdx = process.argv.indexOf('--probe');
if (probeIdx !== -1) {
  const src = process.argv[probeIdx + 1] ?? 'assets/icon-candidates/line/l1.jpg';
  const out = await toLineIcon(src);
  writeFileSync('_probe/probe-line.png', out);
  console.log('_probe/probe-line.png', out.length, 'B');
} else {
  for (let i = 1; i <= 10; i += 1) {
    const src = `assets/icon-candidates/line/l${i}.jpg`;
    if (!existsSync(src)) {
      console.log(`l${i}: 跳过（还没有源图）`);
      continue;
    }
    const out = await toLineIcon(src);
    writeFileSync(`assets/icon-candidates/line/l${i}.png`, out);
    console.log(`l${i}.png ${out.length}B`);
  }
}
