// tsdown 配置（沿用 dsh-pet 的构建方式：src → lib 产物）
//
// DSH 浏览器插件产出的 lib/client.js 必须是 window.__ModuleLoader__.load({ id, factory })
// 单文件形态；react / react/jsx-runtime / react-dom / @deepseek-ai/* 保持外部 require（不打包）。
//
// 三份配置（去掉上游的 app 入口——本分支不含 electron 独立应用）：
//   1) 浏览器半侧（client → lib/client.js）
//   2) 宿主半侧（index → lib/index.js，ESM）
//   3) 独立模式入口（standalone → lib/standalone.js，把三个 DSH 专有包换成替身）
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

/** 本配置文件所在目录（= 包根） */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)));

/** 替换包名用的绝对路径（rolldown 的 alias 收绝对路径最稳） */
const shim = (name) => join(packageRoot, 'src', 'standalone', 'shims', `${name}.ts`);

/** 两份配置共用的编译口径 */
const shared = {
  format: ['esm'],
  platform: 'node',
  target: 'es2020',
  dts: false,
  outDir: 'lib',
  clean: false,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      client: 'src/client/index.ts',
    },
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
    // 浏览器半侧必须能被**重复执行**：DSH 把 lib/client.js 当经典脚本加载，bundle 重建后
    // （HMR 换 rev）或 combo 请求重试时，同一个文件会在同一页面里再执行一次。经典脚本的
    // 顶层 const/let/function 落在页面全局词法作用域，第二次解析直接 SyntaxError。因此整份
    // 产物包一层 IIFE；前导 ';' 抵消 combo 拼接时的 ASI 歧义。
    outputOptions: { banner: ';(()=>{', footer: '})();' },
  },
  {
    ...shared,
    // 宿主半侧保持 ESM（由 DSH 的 Loader import），绝不能包 IIFE。
    entry: {
      index: 'src/host/index.ts',
    },
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
  },
  {
    ...shared,
    target: 'es2022',
    entry: {
      standalone: 'src/standalone/cli.ts',
    },
    noExternal: [/^@deepseek-ai\/(?:dsh-home-paths|dsh-credentials|dsh-llm)$/],
    external: [/^@electron\//, /^node:/, /^@deepseek-ai\/(?!dsh-home-paths$|dsh-credentials$|dsh-llm$)/],
    alias: {
      '@deepseek-ai/dsh-home-paths': shim('dsh-home-paths'),
      '@deepseek-ai/dsh-credentials': shim('dsh-credentials'),
      '@deepseek-ai/dsh-llm': shim('dsh-llm'),
    },
  },
]);
