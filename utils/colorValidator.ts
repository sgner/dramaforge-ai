export interface ColorValidationIssue {
  shotId: string;
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ColorValidationResult {
  valid: boolean;
  issues: ColorValidationIssue[];
  errorCount: number;
  warningCount: number;
}

const GENRE_COLOR_RULES: Record<string, {
  requiredPairs: string[];
  forbiddenKeywords: string[];
  requiredContrast: boolean;
}> = {
  '仙侠': {
    requiredPairs: ['青', '金', '白', '墨'],
    forbiddenKeywords: ['荧光', '霓虹', '赛博', '电光'],
    requiredContrast: true,
  },
  '都市': {
    requiredPairs: ['灰', '蓝', '暖黄'],
    forbiddenKeywords: ['仙气', '灵光', '法术'],
    requiredContrast: false,
  },
  '赛博朋克': {
    requiredPairs: ['紫', '蓝', '粉', '霓虹'],
    forbiddenKeywords: ['自然', '田园', '古朴'],
    requiredContrast: true,
  },
  '古风': {
    requiredPairs: ['朱', '墨', '白', '青'],
    forbiddenKeywords: ['霓虹', '荧光', '塑料感'],
    requiredContrast: true,
  },
  '悬疑': {
    requiredPairs: ['暗', '灰', '冷'],
    forbiddenKeywords: ['明亮', '阳光', '温暖'],
    requiredContrast: false,
  },
  '末日': {
    requiredPairs: ['灰', '锈', '暗'],
    forbiddenKeywords: ['鲜艳', '明亮', '荧光'],
    requiredContrast: false,
  },
};

const CONTRAST_PAIR_PATTERN = /([^\s]+?)\s*↔\s*([^\s]+)/;

export function validateColorManagement(
  shots: { id: string; soraPrompt?: string; storyboardPrompt?: string }[],
  genre: string
): ColorValidationResult {
  const issues: ColorValidationIssue[] = [];
  const rules = GENRE_COLOR_RULES[genre];

  for (const shot of shots) {
    const prompt = shot.soraPrompt || shot.storyboardPrompt || '';

    if (!prompt.trim()) continue;

    const colorSection = extractColorSection(prompt);

    if (!colorSection) {
      issues.push({
        shotId: shot.id,
        field: 'colorSection',
        severity: 'warning',
        message: '未找到【色彩】区块，建议按模板格式添加色彩定义',
      });
      continue;
    }

    if (rules) {
      for (const forbidden of rules.forbiddenKeywords) {
        if (colorSection.includes(forbidden)) {
          issues.push({
            shotId: shot.id,
            field: 'colorSection',
            severity: 'error',
            message: `题材"${genre}"色彩区含禁用词"${forbidden}"`,
          });
        }
      }

      const hasRequiredColor = rules.requiredPairs.some(c => colorSection.includes(c));
      if (!hasRequiredColor) {
        issues.push({
          shotId: shot.id,
          field: 'colorSection',
          severity: 'warning',
          message: `题材"${genre}"建议包含以下色调之一: ${rules.requiredPairs.join('/')}`,
        });
      }
    }

    if (CONTRAST_PAIR_PATTERN.test(colorSection)) {
      // Good: has contrast pair
    } else if (colorSection.includes('主色') || colorSection.includes('对比色')) {
      issues.push({
        shotId: shot.id,
        field: 'colorContrast',
        severity: 'warning',
        message: '色彩区提到主色/对比色但未使用"X ↔ Y"格式标注对比对',
      });
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  return {
    valid: errorCount === 0,
    issues,
    errorCount,
    warningCount,
  };
}

function extractColorSection(prompt: string): string {
  const match = prompt.match(/【色彩】\s*([\s\S]*?)(?=【|$)/);
  if (match) return match[1].trim();

  const altMatch = prompt.match(/色彩[：:]\s*([\s\S]*?)(?=\n\n|\n【|$)/);
  if (altMatch) return altMatch[1].trim();

  return '';
}

export function getGenreColorRules(): Record<string, { requiredPairs: string[]; forbiddenKeywords: string[]; requiredContrast: boolean }> {
  return { ...GENRE_COLOR_RULES };
}
