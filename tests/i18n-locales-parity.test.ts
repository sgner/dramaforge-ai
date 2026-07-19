/**
 * i18n 防回归测试（静态分析，无需渲染）：
 *
 * 1. locales.ts 四语言（zh/en/ja/ko）的 key 集合必须完全一致
 *    —— 防止某种语言漏翻导致 UI 落到 `|| key` 兜底、直接显示英文 key 名。
 * 2. 源码中所有静态 t('...') / t("...") 引用的 key 必须存在于语言包
 *    （动态拼接的 key 无法静态判定，不在此列）。
 *
 * 解析方式与 scripts/i18n-audit.cjs 一致：按 `  xx: {` 语言块切分，
 * 提取 4 空格缩进的普通 key（计算属性 [TaskStatus.X] / [ArtStyle.X] 对称存在，不参与比较）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const LANGS = ['zh', 'en', 'ja', 'ko'] as const;

/** 从 locales.ts 源码提取每个语言块的 key 集合。 */
function extractLocaleKeys(): Record<string, Set<string>> {
  const src = fs.readFileSync(path.join(ROOT, 'locales.ts'), 'utf8');
  const starts = LANGS.map((lang) => {
    const idx = src.search(new RegExp(`^  ${lang}: \\{`, 'm'));
    if (idx === -1) throw new Error(`locales.ts 中找不到语言块: ${lang}`);
    return { lang, idx };
  }).sort((a, b) => a.idx - b.idx);

  const result: Record<string, Set<string>> = {};
  starts.forEach(({ lang, idx }, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].idx : src.length;
    const block = src.slice(idx, end);
    const keys = new Set<string>();
    for (const m of block.matchAll(/^    ([A-Za-z0-9_]+):/gm)) keys.add(m[1]);
    result[lang] = keys;
  });
  return result;
}

/** 递归收集非测试源码文件（.ts/.tsx）。 */
function collectSourceFiles(): string[] {
  const SKIP = new Set(['node_modules', 'dist', 'tests', 'backend', 'docs', 'scripts', 'public', '.git']);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

/** 提取源码中静态 t('key') / t("key") 引用的 key（含引用位置，便于报错定位）。 */
function extractUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const re = /\bt\(\s*(['"])([A-Za-z0-9_]+)\1\s*\)/g;
  for (const file of collectSourceFiles()) {
    const rel = path.relative(ROOT, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const key = m[2];
        if (!used.has(key)) used.set(key, []);
        used.get(key)!.push(`${rel}:${i + 1}`);
      }
    });
  }
  return used;
}

describe('i18n locales 完整性（防回归）', () => {
  it('四语言 key 集合完全一致', () => {
    const keys = extractLocaleKeys();
    const base = keys.zh;
    for (const lang of LANGS) {
      const missing = [...base].filter((k) => !keys[lang].has(k));
      const extra = [...keys[lang]].filter((k) => !base.has(k));
      expect(
        missing,
        `${lang} 缺少 ${missing.length} 个 key（以 zh 为基准）: ${missing.join(', ')}`,
      ).toEqual([]);
      expect(
        extra,
        `${lang} 多出 ${extra.length} 个孤儿 key（zh 没有）: ${extra.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('代码中静态引用的 t() key 在四语言包中全部存在', () => {
    const keys = extractLocaleKeys();
    const union = new Set<string>();
    for (const lang of LANGS) keys[lang].forEach((k) => union.add(k));

    const missingReport: string[] = [];
    for (const [key, spots] of extractUsedKeys()) {
      if (!union.has(key)) {
        missingReport.push(`${key}  <-  ${spots.slice(0, 3).join(', ')}`);
      }
    }
    expect(
      missingReport,
      `以下 ${missingReport.length} 个 key 在代码中被引用但语言包中不存在:\n${missingReport.join('\n')}`,
    ).toEqual([]);
  });
});
