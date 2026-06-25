export type SensitiveZone = 'redZone' | 'yellowZone' | 'celebrityZone' | 'ipZone';

export interface FilterMatch {
  zone: SensitiveZone;
  original: string;
  replacement: string | null;
  position: number;
}

export interface FilterResult {
  filteredText: string;
  matches: FilterMatch[];
  blocked: boolean;
  blockedMatches: FilterMatch[];
  replacedMatches: FilterMatch[];
}

const RED_ZONE: Record<string, null> = {
  '真人照片': null,
  '本人上传': null,
  '换脸': null,
  'Deepfake': null,
  '伪造身份': null,
  '模仿名人': null,
  '克隆声音': null,
  '还原本人': null,
  '真实人脸': null,
  '身份证照': null,
  '护照照片': null,
  '监控画面': null,
  '偷拍视角': null,
  '习近平': null,
  '李克强': null,
  '毛泽东': null,
  '邓小平': null,
  '江泽民': null,
  '胡锦涛': null,
  '色情': null,
  '裸体': null,
  '裸露': null,
  '性爱': null,
  '性交': null,
  '生殖器': null,
  '乳房': null,
  '臀部特写': null,
  '高潮': null,
  '性暗示': null,
  '诱惑姿势': null,
  '成人用品': null,
  'AV': null,
  'hentai': null,
  '恋童': null,
  '未成年人色情': null,
  '血腥': null,
  '断肢': null,
  '残骸': null,
  '大量出血': null,
  '杀戮': null,
  '自杀': null,
  '自残': null,
  '上吊': null,
  '酷刑': null,
  '虐待': null,
  '恐怖分子': null,
  '恐怖组织': null,
  '极端主义': null,
  '尸体': null,
  '腐烂': null,
  '吸毒': null,
  '贩毒': null,
  '制毒': null,
  '赌博': null,
  '赌场': null,
  '诈骗教程': null,
  '制造武器': null,
  '爆炸物制作': null,
  '黑客攻击': null,
  '盗窃': null,
  '抢劫': null,
  '教唆犯罪': null,
};

const YELLOW_ZONE: Record<string, string> = {
  'Disney': '童话风格',
  '迪士尼': '童话梦幻风格',
  'Marvel': '超级英雄风格',
  '漫威': '科幻超级英雄风格',
  'DC': '漫画风格',
  'Harry Potter': '魔法世界',
  '哈利波特': '魔法学院风格',
  'Nintendo': '游戏风格',
  '任天堂': '游戏风格',
  'Pokemon': '精灵风格',
  '皮卡丘': '电气精灵',
  'Star Wars': '太空史诗',
  '星球大战': '星际战争风格',
  'Pixar': '3D动画',
  '皮克斯': '3D动画风格',
  'Ghibli': '日式动画',
  '宫崎骏': '日式手绘动画风',
  'Transformers': '机甲风格',
  '变形金刚': '机甲变形风格',
  '奥特曼': '特摄英雄',
  'Nike': '运动品牌',
  '耐克': '知名运动品牌',
  'Adidas': '运动品牌',
  '阿迪达斯': '运动品牌',
  'Apple': '科技公司',
  '苹果': '极简设计产品',
  'iPhone': '智能手机',
  'Coca-Cola': '碳酸饮料',
  '可口可乐': '红色罐装饮料',
  'McDonalds': '快餐',
  '麦当劳': '快餐品牌',
  'Mercedes-Benz': '豪华汽车',
  '奔驰': '豪华汽车',
  'BMW': '运动汽车',
  '宝马': '运动汽车',
  'LV': '奢侈品',
  'Louis Vuitton': '奢侈品',
  'Gucci': '时尚品牌',
  '古驰': '时尚品牌',
  'Chanel': '奢侈品牌',
  '香奈儿': '奢侈品牌',
};

const CELEBRITY_ZONE: Record<string, string> = {
  '成龙': '功夫巨星气质',
  '李连杰': '武术大师气质',
  '周润发': '影帝气质',
  '刘德华': '天王气质',
  '周杰伦': '音乐才子气质',
  '范冰冰': '女神气质',
  '杨幂': '流量明星气质',
  '赵丽颖': '甜美气质',
  '迪丽热巴': '异域美女气质',
  '肖战': '偶像气质',
  '王一博': '酷盖气质',
  '鹿晗': '小鲜肉气质',
  '吴亦凡': '嘻哈气质',
  '黄子韬': '个性气质',
  '王俊凯': '少年偶像气质',
  '易烊千玺': '实力派气质',
  '王源': '阳光少年气质',
  '蔡徐坤': '舞台王者气质',
  '张艺兴': '努力派气质',
  '杨颖': '混血美女气质',
  '刘亦菲': '仙女气质',
  '刘诗诗': '古典美女气质',
  '倪妮': '高级脸气质',
  '汤唯': '文艺气质',
  '章子怡': '国际范气质',
  '巩俐': '女王气质',
  '张曼玉': '影后气质',
  '梁朝伟': '忧郁男神气质',
  '张国荣': '绝代风华气质',
  '周星驰': '喜剧之王气质',
  '黄渤': '实力派气质',
  '沈腾': '喜剧气质',
  '徐峥': '导演气质',
  '吴京': '硬汉气质',
  '甄子丹': '动作巨星气质',
  '李小龙': '功夫宗师气质',
  '姚明': '篮球巨星气质',
  '李娜': '网球冠军气质',
  'Tom Cruise': '动作巨星气质',
  '汤姆克鲁斯': '动作巨星气质',
  'Brad Pitt': '男神气质',
  '布拉德皮特': '男神气质',
  'Leonardo DiCaprio': '实力派气质',
  '莱昂纳多': '实力派气质',
  'Johnny Depp': '怪咖气质',
  '约翰尼德普': '怪咖气质',
  'Robert Downey Jr': '钢铁侠气质',
  '小罗伯特唐尼': '钢铁侠气质',
  'Chris Evans': '美国队长气质',
  '克里斯埃文斯': '美国队长气质',
  'Scarlett Johansson': '黑寡妇气质',
  '斯嘉丽约翰逊': '黑寡妇气质',
  'Angelina Jolie': '女神气质',
  '安吉丽娜朱莉': '女神气质',
  'Jennifer Lawrence': '大表姐气质',
  '詹妮弗劳伦斯': '大表姐气质',
  'Emma Watson': '学霸气质',
  '艾玛沃森': '学霸气质',
  'Natalie Portman': '才女气质',
  '娜塔莉波特曼': '才女气质',
  'Meryl Streep': '影后气质',
  '梅丽尔斯特里普': '影后气质',
  'Dwayne Johnson': '巨石气质',
  '道恩强森': '巨石气质',
  'Will Smith': 'Fresh Prince气质',
  '威尔史密斯': 'Fresh Prince气质',
  'Tom Hanks': '国民老爸气质',
  '汤姆汉克斯': '国民老爸气质',
};

const IP_ZONE: Record<string, string> = {
  '孙悟空': '神话英雄',
  '猪八戒': '神话角色',
  '唐僧': '高僧形象',
  '哪吒': '神话少年',
  '关羽': '武圣形象',
  '诸葛亮': '智者形象',
  '曹操': '枭雄形象',
  '刘备': '仁君形象',
  '蜘蛛侠': '超级英雄',
  '钢铁侠': '科技英雄',
  '美国队长': '正义英雄',
  '雷神': '神话英雄',
  '绿巨人': '力量英雄',
  '黑寡妇': '特工英雄',
  '鹰眼': '射手英雄',
  '超人': '氪星英雄',
  '蝙蝠侠': '黑暗骑士',
  '神奇女侠': '亚马逊英雄',
  '闪电侠': '速度英雄',
  '海王': '海洋英雄',
  '哆啦A梦': '机器猫',
  '柯南': '侦探少年',
  '鸣人': '忍者少年',
  '路飞': '海贼少年',
  '佐助': '忍者天才',
  '樱木花道': '篮球少年',
  '流川枫': '篮球天才',
  '蜡笔小新': '调皮小孩',
  '樱桃小丸子': '可爱女孩',
  '马里奥': '水管工',
  '索尼克': '蓝色刺猬',
};

function sortByLengthDesc(dict: Record<string, any>): string[] {
  return Object.keys(dict).sort((a, b) => b.length - a.length);
}

const redZoneKeys = sortByLengthDesc(RED_ZONE);
const yellowZoneKeys = sortByLengthDesc(YELLOW_ZONE);
const celebrityZoneKeys = sortByLengthDesc(CELEBRITY_ZONE);
const ipZoneKeys = sortByLengthDesc(IP_ZONE);

function findMatches(text: string, keys: string[], zone: SensitiveZone, replacementDict?: Record<string, string>): FilterMatch[] {
  const matches: FilterMatch[] = [];
  const searchLower = text.toLowerCase();

  for (const key of keys) {
    let startIndex = 0;
    const keyLower = key.toLowerCase();
    while (true) {
      const idx = searchLower.indexOf(keyLower, startIndex);
      if (idx === -1) break;
      matches.push({
        zone,
        original: text.substring(idx, idx + key.length),
        replacement: replacementDict ? (replacementDict[key] || null) : null,
        position: idx,
      });
      startIndex = idx + key.length;
    }
  }

  return matches;
}

export function filterPrompt(text: string): FilterResult {
  const allMatches: FilterMatch[] = [];

  const redMatches = findMatches(text, redZoneKeys, 'redZone');
  allMatches.push(...redMatches);

  const yellowMatches = findMatches(text, yellowZoneKeys, 'yellowZone', YELLOW_ZONE);
  allMatches.push(...yellowMatches);

  const celebrityMatches = findMatches(text, celebrityZoneKeys, 'celebrityZone', CELEBRITY_ZONE);
  allMatches.push(...celebrityMatches);

  const ipMatches = findMatches(text, ipZoneKeys, 'ipZone', IP_ZONE);
  allMatches.push(...ipMatches);

  allMatches.sort((a, b) => b.position - a.position);

  let filteredText = text;
  for (const match of allMatches) {
    if (match.replacement) {
      filteredText =
        filteredText.substring(0, match.position) +
        match.replacement +
        filteredText.substring(match.position + match.original.length);
    }
  }

  const blockedMatches = allMatches.filter((m) => m.zone === 'redZone');
  const replacedMatches = allMatches.filter((m) => m.zone !== 'redZone' && m.replacement);

  return {
    filteredText,
    matches: allMatches,
    blocked: blockedMatches.length > 0,
    blockedMatches,
    replacedMatches,
  };
}

export function filterReferenceTag(tag: string): FilterResult {
  return filterPrompt(tag);
}

export function filterFullPrompt(promptText: string, referenceTags: string[]): {
  promptResult: FilterResult;
  tagResults: FilterResult[];
  combinedBlocked: boolean;
  combinedBlockedMatches: FilterMatch[];
  combinedReplacedMatches: FilterMatch[];
} {
  const promptResult = filterPrompt(promptText);
  const tagResults = referenceTags.map((tag) => filterReferenceTag(tag));

  const allBlocked = [...promptResult.blockedMatches];
  const allReplaced = [...promptResult.replacedMatches];

  for (const tr of tagResults) {
    allBlocked.push(...tr.blockedMatches);
    allReplaced.push(...tr.replacedMatches);
  }

  return {
    promptResult,
    tagResults,
    combinedBlocked: allBlocked.length > 0,
    combinedBlockedMatches: allBlocked,
    combinedReplacedMatches: allReplaced,
  };
}

export { RED_ZONE, YELLOW_ZONE, CELEBRITY_ZONE, IP_ZONE };
