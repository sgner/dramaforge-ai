#!/usr/bin/env node
/**
 * 一次性 i18n 审计脚本：
 * 1. 扫描所有非测试源码中的 t('...') / t("...") 静态 key 引用（排除模板/拼接动态 key）
 * 2. 解析 locales.ts 四语言 key 集合
 * 3. 输出：代码引用但语言包全部缺失的 key、各语言相对 zh 的缺失、各语言孤儿 key
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIRS = ['', 'components', 'hooks', 'services', 'agent', 'utils'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'backend', 'docs', 'scripts', 'public', '.git']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// 1. 收集代码中的静态 key 引用
const used = new Map(); // key -> [file:line]
const tCallRe = /\bt\(\s*(['"])([A-Za-z0-9_]+)\1\s*\)/g;
const dynamicRe = /\bt\(\s*[^'"\s)]/g; // t( 后面不是字符串字面量的，记录为动态
const dynamicSpots = [];
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    let m;
    tCallRe.lastIndex = 0;
    while ((m = tCallRe.exec(line))) {
      const key = m[2];
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(`${path.relative(ROOT, file)}:${i + 1}`);
    }
    dynamicRe.lastIndex = 0;
    while ((m = dynamicRe.exec(line))) {
      dynamicSpots.push(`${path.relative(ROOT, file)}:${i + 1} :: ${line.trim().slice(0, 100)}`);
    }
  });
}

// 2. 解析 locales.ts
const localesSrc = fs.readFileSync(path.join(ROOT, 'locales.ts'), 'utf8');
const langs = ['zh', 'en', 'ja', 'ko'];
const langKeys = {};
const starts = langs
  .map((lang) => {
    const startRe = new RegExp(`^  ${lang}: \\{`, 'm');
    const start = localesSrc.search(startRe);
    if (start === -1) throw new Error(`lang block not found: ${lang}`);
    return { lang, start };
  })
  .sort((a, b) => a.start - b.start);
for (let i = 0; i < starts.length; i++) {
  const { lang, start } = starts[i];
  const end = i + 1 < starts.length ? starts[i + 1].start : localesSrc.length;
  const block = localesSrc.slice(start, end);
  const keys = new Set();
  const keyRe = /^    ([A-Za-z0-9_]+):/gm;
  let m;
  while ((m = keyRe.exec(block))) keys.add(m[1]);
  langKeys[lang] = keys;
}

const unionAll = new Set(Object.values(langKeys).flatMap((s) => [...s]));

// 3. 报告
console.log('=== 各语言 key 数 ===');
for (const l of langs) console.log(`${l}: ${langKeys[l].size}`);

console.log('\n=== 代码引用但四语言包全部缺失 ===');
const missingAll = [];
for (const [key, spots] of [...used.entries()].sort()) {
  if (!unionAll.has(key)) {
    missingAll.push(key);
    console.log(`${key}  <-  ${spots.slice(0, 3).join(', ')}${spots.length > 3 ? ` (+${spots.length - 3})` : ''}`);
  }
}
console.log(`共 ${missingAll.length} 个`);

console.log('\n=== 代码引用、存在于某些语言但非全语言 ===');
let partial = 0;
for (const [key, spots] of [...used.entries()].sort()) {
  if (unionAll.has(key) && !langs.every((l) => langKeys[l].has(key))) {
    partial++;
    const missing = langs.filter((l) => !langKeys[l].has(key)).join(',');
    console.log(`${key}  缺: ${missing}  <-  ${spots[0]}`);
  }
}
console.log(`共 ${partial} 个`);

console.log('\n=== 以 zh 为基准各语言缺失（全部 key 视角） ===');
for (const l of ['en', 'ja', 'ko']) {
  const miss = [...langKeys.zh].filter((k) => !langKeys[l].has(k));
  console.log(`${l} 缺 ${miss.length} 个: ${miss.join(', ')}`);
}

console.log('\n=== 孤儿 key（存在于某语言但 zh 没有） ===');
for (const l of ['en', 'ja', 'ko']) {
  const orphans = [...langKeys[l]].filter((k) => !langKeys.zh.has(k));
  console.log(`${l} 多 ${orphans.length} 个: ${orphans.join(', ')}`);
}

console.log('\n=== 动态 key 调用点（人工核对用，已排除出静态分析） ===');
dynamicSpots.forEach((s) => console.log(s));
