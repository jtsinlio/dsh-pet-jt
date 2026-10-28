// 极简线条 logo 生成器（矢量）：文生图模型（sana）出不了真正的单色线条，所以这 10 张用
// **代码画的 SVG** 兜底——线条严格等宽、任意尺寸都清晰，风格和"极简线条 + Q 版可爱鲸鱼"完全对齐。
//
// 产物：
//   assets/icon-candidates/line/vector-N.svg   源文件（改颜色/线宽直接编辑）
//   assets/icon-candidates/line/vector-N.png   512 预览（白底圆角）
//   assets/icon-candidates/line/vector-sheet.png  10 张拼图（一眼对比）
//
// 用法：node scripts/dev/gen-vector-logos.mjs
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'assets/icon-candidates/line';
mkdirSync(OUT, { recursive: true });
const INK = '#4D6BFE';
const SW = 13; // 线宽（256 视图里）

/** 鲸鱼身体（圆滚滚的 Q 版）：一个圆 + 一条右侧尾鳍 */
const body = () => `
  <circle cx="112" cy="126" r="62"/>
  <path d="M174 126 C 190 120 199 107 197 94 C 185 98 176 108 170 119"/>
  <path d="M174 126 C 190 132 199 145 197 158 C 185 154 176 144 170 133"/>`;

/** 眼睛（实心圆点，Q 版的灵魂） */
const eye = (x = 92, y = 114, r = 7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}" stroke="none"/>`;
const smile = (x = 86, y = 136) => `<path d="M${x} ${y} q 9 9 18 0"/>`;
const blush = () => `<path d="M70 146 l 8 4" opacity="0.55"/><path d="M126 150 l 8 -4" opacity="0.55"/>`;
const fin = () => `<path d="M92 184 c 2 10 -5 18 -16 19" />`;

const VARIANTS = [
  // 1 最基础：圆滚滚 + 尾鳍 + 点眼 + 微笑
  () => `${body()}${eye()}${smile()}${fin()}`,
  // 2 喷水：头顶三颗水珠 + 一道水弧
  () => `
    <path d="M112 64 C 106 48 118 40 128 46"/>
    <circle cx="134" cy="36" r="5" fill="${INK}" stroke="none"/>
    <circle cx="148" cy="46" r="4" fill="${INK}" stroke="none"/>
    <circle cx="122" cy="26" r="3" fill="${INK}" stroke="none"/>
    ${body()}${eye()}${smile()}${fin()}`,
  // 3 圆形徽章：外面套一个细圆环
  () => `
    <circle cx="112" cy="126" r="92" opacity="0.5"/>
    ${body()}${eye()}${smile()}${fin()}`,
  // 4 吐泡泡：左边三颗大小递减的泡泡，最"鲸鱼"
  () => `
    ${body()}
    <circle cx="44" cy="86" r="9"/>
    <circle cx="26" cy="66" r="6"/>
    <circle cx="16" cy="50" r="4"/>
    ${eye()}${smile()}${fin()}`,
  // 5 戴帽子 + 围巾：和现在那只玩偶图标呼应
  () => `
    ${body()}
    <path d="M70 72 C 74 48 96 34 114 34 C 132 34 150 48 154 72"/>
    <path d="M70 72 q 44 10 84 0"/>
    <circle cx="152" cy="52" r="7"/>
    <path d="M74 156 q 38 12 76 0" opacity="0.9"/>
    ${eye()}${smile()}`,
  // 6 抱着爱心
  () => `
    ${body()}
    <path d="M112 190 c -10 -12 -24 -18 -24 -30 c 0 -8 6 -13 13 -13 c 5 0 9 3 11 7 c 2 -4 6 -7 11 -7 c 7 0 13 5 13 13 c 0 12 -14 18 -24 30 z"/>
    ${eye()}${smile()}${fin()}`,
  // 7 睡觉：闭眼 + 三个 z
  () => `
    ${body()}
    <path d="M84 116 q 8 6 16 0"/>
    <path d="M168 52 h 16 l -16 16 h 16" stroke-width="8"/>
    <path d="M190 30 h 12 l -12 12 h 12" stroke-width="6"/>
    ${smile(88, 138)}${fin()}`,
  // 8 旁边有条小鱼（鲸鱼吃小鱼？不，是朋友）
  () => `
    ${body()}
    <path d="M170 206 c 12 -10 30 -10 42 0 c -12 10 -30 10 -42 0 z"/>
    <path d="M212 206 l 12 -9 v 18 z"/>
    <circle cx="184" cy="202" r="3" fill="${INK}" stroke="none"/>
    ${eye()}${smile()}${fin()}`,
  // 9 戴圆眼镜
  () => `
    ${body()}
    <circle cx="88" cy="112" r="17"/>
    <circle cx="126" cy="112" r="17"/>
    <path d="M105 112 h 4"/>
    ${eye(88, 112, 5)}${eye(126, 112, 5)}${smile(90, 146)}`,
  // 10 小领结：细节最少、最好认
  () => `
    ${body()}
    <path d="M100 186 l -16 -10 v 20 z"/>
    <path d="M124 186 l 16 -10 v 20 z"/>
    <circle cx="112" cy="186" r="5" fill="${INK}" stroke="none"/>
    ${eye()}${smile(88, 128)}${blush()}`,
];

const svgOf = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 224 224" width="224" height="224" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const roundedMask = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#fff"/></svg>`,
  );

for (let i = 0; i < VARIANTS.length; i += 1) {
  const svg = svgOf(VARIANTS[i]());
  writeFileSync(`${OUT}/vector-${i + 1}.svg`, svg);
  const png = await sharp(Buffer.from(svg), { density: 400 })
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
  const rounded = await sharp(png).composite([{ input: roundedMask(512), blend: 'dest-in' }]).png().toBuffer();
  writeFileSync(`${OUT}/vector-${i + 1}.png`, rounded);
  console.log(`vector-${i + 1}.svg/png ok`);
}

// 拼图：5 列 2 行，方便一眼挑
const CELL = 200;
const sheet = sharp({ create: { width: CELL * 5, height: CELL * 2, channels: 3, background: '#ffffff' } });
const layers = [];
for (let i = 0; i < 10; i += 1) {
  const buf = await sharp(`${OUT}/vector-${i + 1}.png`).resize(CELL - 16, CELL - 16).png().toBuffer();
  layers.push({ input: buf, left: (i % 5) * CELL + 8, top: Math.floor(i / 5) * CELL + 8 });
}
await sheet.composite(layers).png().toFile(`${OUT}/vector-sheet.png`);
console.log('vector-sheet.png ok');
