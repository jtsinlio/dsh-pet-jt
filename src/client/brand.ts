/**
 * 品牌资源：dsh-pet-jt 的设置页导航图标（Q 版 DeepSeek 小鲸鱼）。
 *
 * 为什么是一个内联 SVG 字符串而不是图片文件：
 *   DSH 的 `settings.section` 插槽没有图标位（导航图标按分区 id 硬编码 + 兜底齿轮），
 *   上游 dsh-pet 的做法是在 DOM 层给那一行补一个 CSS mask（见 ./nav-icon.ts）。mask 只吃
 *   **alpha 通道**，所以这里给的是"实心剪影"——圆形身体 + 尾巴 + 头顶水花，眼睛用
 *   evenodd 挖空。插件管理页/市场用的是彩色版 `assets/logo-jt.svg`（见 package.json 的 icon）。
 *
 * 图形刻意做得比彩色版更"胖"：16px 下要能一眼认出是那条鲸鱼。
 */
export const JT_NAV_ICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">',
  // 头顶三颗水花
  '<circle cx="9" cy="2.6" r="1.1"/>',
  '<circle cx="12" cy="1.7" r="0.85"/>',
  '<circle cx="15" cy="2.6" r="1.1"/>',
  // 尾巴（右侧）
  '<path d="M18.4 12.6c1.3-.5 2.2-1.5 2.6-2.9l1.1.6c-.3 1.6-1.3 2.8-2.7 3.5 1.4.7 2.4 1.9 2.7 3.5l-1.1.6c-.4-1.4-1.3-2.4-2.6-2.9z"/>',
  // 身体 + 眼睛挖空（evenodd：外圈实体、内圈成洞）
  '<path fill-rule="evenodd" d="M11.4 4.6a7.6 7.6 0 1 0 0 15.2 7.6 7.6 0 0 0 0-15.2zm-2.5 5.1a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7zm5.1 0a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7z"/>',
  '</svg>',
].join('');
