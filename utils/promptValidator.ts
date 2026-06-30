export interface ValidationIssue {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  position?: number;
  snippet?: string;
}

export interface PromptValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

const STATIC_POSITION_PATTERNS = [
  /停在/,
  /位于/,
  /悬于/,
  /悬在/,
  /呆在/,
  /站在.*(?:不动|静止|不动)/,
];

const PROCESS_VERB_PATTERNS = [
  /从.*飞来/,
  /从.*坠下/,
  /缓缓走来/,
  /逐渐显形/,
  /逐渐.*显现/,
  /缓缓.*走来/,
  /慢慢.*靠近/,
];

const MISSING_DIRECTION_MARKER = /^镜头\d+.*—[^【]*$/;

const SHOT_ENDING_PATTERNS = [
  /停在画面/,
  /停在.*(?:左侧|右侧|中央|顶部|底部)/,
  /位于画面/,
  /悬于画面/,
];

const CROWD_WITHOUT_DIVERSITY = /(?:一群|众|群|若干|多名)(?!.*(?:长相不同|穿着不同|各自姿态不同|不同外貌|各异))/;

const MULTI_CHARACTER_NO_ANCHOR = /(?:[\u4e00-\u9fa5]{2,4})(?:与|和|跟)(?:[\u4e00-\u9fa5]{2,4})(?!.*(?:米外|距离|画面(?:左|右|前|后|上|下|中)))/;

export function validateVideoPrompt(prompt: string): PromptValidationResult {
  const issues: ValidationIssue[] = [];
  const lines = prompt.split('\n');
  let inShotList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.includes('【镜头列表】') || line.includes('镜头列表')) {
      inShotList = true;
      continue;
    }
    if (line.includes('【风格】') || line.includes('【强制声明】')) {
      inShotList = false;
      continue;
    }

    if (!inShotList) continue;

    const shotMatch = line.match(/^镜头\d+/);
    if (!shotMatch) continue;

    for (const pattern of STATIC_POSITION_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          rule: 'STATIC_POSITION',
          severity: 'error',
          message: `检测到静态位置词 "${pattern.source}"，应替换为入画动作 (如 "从画面X侧入画")`,
          position: i,
          snippet: line.substring(0, 80),
        });
      }
    }

    for (const pattern of SHOT_ENDING_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          rule: 'SHOT_ENDING_DESCRIBED',
          severity: 'error',
          message: `检测到镜头尾描述 "${pattern.source}"，严禁描述镜头结束位置`,
          position: i,
          snippet: line.substring(0, 80),
        });
      }
    }

    for (const pattern of PROCESS_VERB_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          rule: 'PROCESS_VERB',
          severity: 'warning',
          message: `检测到过程动词 "${pattern.source}"，应替换为瞬间动词 (如 "砸入/飞溅/扑面")`,
          position: i,
          snippet: line.substring(0, 80),
        });
      }
    }

    if (MISSING_DIRECTION_MARKER.test(line) && line.includes('—')) {
      const descPart = line.split('—')[1] || '';
      const hasMotionKeywords = /入画|袭来|扑面|坠下|推进|拉远|横移|旋转|飞溅|撞击/.test(descPart);
      if (hasMotionKeywords && !descPart.includes('【')) {
        issues.push({
          rule: 'MISSING_DIRECTION_MARKER',
          severity: 'warning',
          message: '镜头含运动描述但缺少【】方向标，关键运动应标注方向',
          position: i,
          snippet: line.substring(0, 80),
        });
      }
    }

    const bracketMatches = line.match(/【[^】]+】/g);
    if (bracketMatches && bracketMatches.length > 2) {
      issues.push({
        rule: 'TOO_MANY_MARKERS',
        severity: 'warning',
        message: `单镜方向标超过2个 (当前${bracketMatches.length}个)，每镜上限2个【】`,
        position: i,
        snippet: line.substring(0, 80),
      });
    }

    if (CROWD_WITHOUT_DIVERSITY.test(line)) {
      issues.push({
        rule: 'CROWD_NO_DIVERSITY',
        severity: 'warning',
        message: '群像描述缺少多样化提示，应加 "长相不同, 穿着不同" 防克隆',
        position: i,
        snippet: line.substring(0, 80),
      });
    }

    if (MULTI_CHARACTER_NO_ANCHOR.test(line)) {
      const hasDistance = /米外|距离/.test(line);
      if (!hasDistance) {
        issues.push({
          rule: 'MULTI_CHAR_NO_ANCHOR',
          severity: 'warning',
          message: '多角色缺少空间锚定，应标注 "[角色] 在距离 [中心角色] X米外的 [画面方向]"',
          position: i,
          snippet: line.substring(0, 80),
        });
      }
    }
  }

  const hasStoryboardDeclaration = prompt.includes('故事板对照声明') || prompt.includes('对应故事板镜头');
  if (!hasStoryboardDeclaration && inShotList === false) {
    issues.push({
      rule: 'MISSING_STORYBOARD_DECLARATION',
      severity: 'warning',
      message: '缺少【故事板对照声明】，视频镜头数应精确对应故事板有内容镜数',
    });
  }

  const hasCreateDeclaration = prompt.includes('创建声明') || prompt.includes('创建此短片');
  if (!hasCreateDeclaration) {
    issues.push({
      rule: 'MISSING_CREATE_DECLARATION',
      severity: 'warning',
      message: '缺少【创建声明】，应包含 "创建此短片 — 不包含任何移动箭头、路径线、镜头分割线"',
    });
  }

  const hasForcedDeclaration = prompt.includes('强制声明');
  if (!hasForcedDeclaration) {
    issues.push({
      rule: 'MISSING_FORCED_DECLARATION',
      severity: 'warning',
      message: '缺少【强制声明】(禁止文字/水印/超现实等)',
    });
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

export function validateStoryboardPrompt(prompt: string): PromptValidationResult {
  const issues: ValidationIssue[] = [];

  if (prompt.includes('@故事板') || prompt.includes('@图片1作为故事板')) {
    issues.push({
      rule: 'STORYBOARD_SELF_REFERENCE',
      severity: 'error',
      message: '故事板首行严禁写 @故事板 自指，参考图只列角色和场景',
    });
  }

  for (const pattern of PROCESS_VERB_PATTERNS) {
    if (pattern.test(prompt)) {
      issues.push({
        rule: 'PROCESS_VERB_IN_STORYBOARD',
        severity: 'error',
        message: `故事板含过程动词 "${pattern.source}"，只允许位置/朝向/姿态/关系类动词`,
      });
    }
  }

  const shotLines = prompt.split('\n').filter(l => /^镜头\d+/.test(l.trim()));
  const blackScreenCount = shotLines.filter(l => l.includes('黑屏')).length;
  const contentCount = shotLines.length - blackScreenCount;
  if (shotLines.length < 8) {
    issues.push({
      rule: 'INSUFFICIENT_SHOTS',
      severity: 'error',
      message: `故事板网格固定8格，当前仅${shotLines.length}镜，不足8镜需用"黑屏"补足`,
    });
  }

  if (!prompt.includes('白色故事板')) {
    issues.push({
      rule: 'MISSING_HEADER',
      severity: 'warning',
      message: '缺少段头固定文案 "白色故事板。2×4 网格..."',
    });
  }

  if (!prompt.includes('分镜故事板')) {
    issues.push({
      rule: 'MISSING_STYLE_LINE',
      severity: 'warning',
      message: '缺少风格行 "分镜故事板 —— 黑白线条、红墨方向箭头、蓝色中文运镜批注"',
    });
  }

  if (!prompt.includes('八帧')) {
    issues.push({
      rule: 'MISSING_TITLE_LINE',
      severity: 'warning',
      message: '缺少标题行 "八帧 —— {标题} (总时长 X 秒)"',
    });
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
