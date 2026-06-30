import { DramaTask, Character, SceneAsset, Prop, BigShot } from '../types';

export interface AssetCheckItem {
  category: string;
  itemName: string;
  checkName: string;
  passed: boolean;
  detail: string;
}

export interface AssetCheckResult {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  items: AssetCheckItem[];
  overallPass: boolean;
}

function checkCharacter(char: Character): AssetCheckItem[] {
  const items: AssetCheckItem[] = [];
  const name = char.name || 'Unnamed';

  items.push({
    category: 'Character',
    itemName: name,
    checkName: 'faceAnchor.6fields',
    passed: !!(char.faceAnchor?.faceShape && char.faceAnchor?.eyeType && char.faceAnchor?.noseType && char.faceAnchor?.lipType && char.faceAnchor?.boneStructure && char.faceAnchor?.skinTone),
    detail: 'faceAnchor需6字段齐全(脸型/眉/眼/鼻/唇/骨相)',
  });

  items.push({
    category: 'Character',
    itemName: name,
    checkName: 'hairSystem.complete',
    passed: !!(char.hairSystem?.lengthAndStyle && char.hairSystem?.color),
    detail: 'hairSystem需含lengthAndStyle+color',
  });

  items.push({
    category: 'Character',
    itemName: name,
    checkName: 'clothingLayers.6layers',
    passed: !!(char.clothingLayers?.inner && char.clothingLayers?.outer && char.clothingLayers?.overlay && char.clothingLayers?.waist && char.clothingLayers?.lower && char.clothingLayers?.feet),
    detail: 'clothingLayers需6层齐全(inner/outer/overlay/waist/lower/feet)',
  });

  items.push({
    category: 'Character',
    itemName: name,
    checkName: 'threeViewImg.generated',
    passed: !!char.threeViewImg,
    detail: '角色三视图图片需已生成',
  });

  items.push({
    category: 'Character',
    itemName: name,
    checkName: 'noVagueAdjectives',
    passed: !/(?:帅气|美丽|威严|好看|漂亮)/.test(char.visualFeatures || ''),
    detail: 'visualFeatures禁用模糊形容词(帅气/美丽/威严等)',
  });

  return items;
}

function checkSceneAsset(scene: SceneAsset, shotId: string): AssetCheckItem[] {
  const items: AssetCheckItem[] = [];
  const name = `Scene@${shotId.substring(0, 8)}`;

  const requiredFields = ['worldPositioning', 'geography', 'mainStructure', 'extendedSpace', 'naturalAndDistant', 'lightAndColor', 'techSpec', 'qualitySuffix', 'ambientCharacters'];
  const filledCount = requiredFields.filter(f => !!(scene as any)[f]?.trim()).length;

  items.push({
    category: 'Scene',
    itemName: name,
    checkName: '9fields.complete',
    passed: filledCount >= 7,
    detail: `场景7层完整(当前${filledCount}/9字段已填)`,
  });

  return items;
}

function checkProp(prop: Prop): AssetCheckItem[] {
  const items: AssetCheckItem[] = [];
  const name = prop.name || 'Unnamed';

  items.push({
    category: 'Prop',
    itemName: name,
    checkName: 'material.touchable',
    passed: !!(prop.material && prop.craftAndWear),
    detail: '材质需可触摸标准(具体材质名+颜色+工艺+老化)',
  });

  items.push({
    category: 'Prop',
    itemName: name,
    checkName: 'noHumanFigure',
    passed: !/(?:人物|手|手握|手持|人像)/.test(prop.prompt || ''),
    detail: '道具prompt禁止含人物/手',
  });

  items.push({
    category: 'Prop',
    itemName: name,
    checkName: 'imageUrl.generated',
    passed: !!prop.imageUrl,
    detail: '道具图片需已生成',
  });

  return items;
}

function checkBigShot(shot: BigShot): AssetCheckItem[] {
  const items: AssetCheckItem[] = [];
  const name = shot.id.substring(0, 8);

  items.push({
    category: 'Shot',
    itemName: name,
    checkName: 'storyboardPrompt.exists',
    passed: !!shot.storyboardPrompt?.trim(),
    detail: '故事板prompt不能为空',
  });

  items.push({
    category: 'Shot',
    itemName: name,
    checkName: 'soraPrompt.exists',
    passed: !!shot.soraPrompt?.trim(),
    detail: '视频prompt不能为空',
  });

  items.push({
    category: 'Shot',
    itemName: name,
    checkName: 'sceneAsset.attached',
    passed: !!shot.sceneAsset,
    detail: '每个BigShot需关联场景资产',
  });

  return items;
}

export function runAssetCheck(task: DramaTask): AssetCheckResult {
  const allItems: AssetCheckItem[] = [];

  for (const char of task.characters || []) {
    allItems.push(...checkCharacter(char));
  }

  for (const prop of task.props || []) {
    allItems.push(...checkProp(prop));
  }

  for (const scene of task.sceneAssets || []) {
    allItems.push(...checkSceneAsset(scene, 'standalone'));
  }

  for (const shot of task.bigShots || []) {
    if (shot.sceneAsset) {
      allItems.push(...checkSceneAsset(shot.sceneAsset, shot.id));
    }
    allItems.push(...checkBigShot(shot));
  }

  const passedChecks = allItems.filter(i => i.passed).length;
  const failedChecks = allItems.filter(i => !i.passed).length;

  return {
    totalChecks: allItems.length,
    passedChecks,
    failedChecks,
    items: allItems,
    overallPass: failedChecks === 0,
  };
}
