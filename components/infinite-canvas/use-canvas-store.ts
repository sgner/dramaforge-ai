import React from 'react';
import { create } from 'zustand';
import {
  CanvasNode,
  Connection,
  Viewport,
  CanvasTheme,
  UndoState,
  UNDO_MAX,
  uid,
  DEFAULT_NODE_SIZES,
  TaskAssetRef,
  TaskAssetKind,
} from './types';
import {
  ApiConfig,
  DEFAULT_PROVIDERS,
  ModelConfig,
  Provider,
  ArtStyle,
  Language,
  getProviderForStep,
  getModelForStep,
  normalizeModelBindings,
} from '../../types';
import { generateSoraVideo, generateCharacterDesign, generateStoryboardImage, generatePropImage } from '../../services/mediaService';
import { expandIdeaToStory, generateScriptFromNovel, optimizeSoraPrompt } from '../../services/llmClient';
import { getT } from '../../i18n';
import { api, type NodeOut, type ConnectionOut, type AssetOut } from '../../services/apiClient';

// 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ら悧鍡欑矆閸喓绠鹃柛鈩冾殜閻涙粓鏌ら弶鎸庡仴闁诡喗顨呴埥澶娾枍閾忣偄鐏﹂柟渚垮妼椤劑宕橀敐鍡樻澑闂備胶绮敋闁汇倕娲︾粩鐔肺熼懡銈囶啎闂佸憡渚楅崑鍕焵椤掍緡娈樻俊鍙夊姍楠炴帒螖婵犲啯娅囬梻渚€娼чˇ浠嬪窗閺嵮€鏋旀い鎾卞灪閳锋垿鎮归崶褍绾ч柟鐧哥秮閺屾稖绠涢弬鍡╀邯閹儳鐣￠柇锔藉兊婵☆偆澧楃换鍐疾濠靛鈷戦梻鍫熺〒缁犳岸鏌嶈閸撴岸寮告總绋跨；?闂?闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т缁€鍫熺箾閸℃ɑ灏伴柛濠呭煐缁绘繈妫冨☉鍗炲壈闂佺琚崝鎴﹀蓟閺囥垹閱囨繝闈涙祩濡倝姊?agent/use-agent-store.ts 闂傚倷娴囧畷鐢稿窗閹邦喖鍨濋煫鍥ㄧ☉閺勩儵鏌涢妷顔煎闁搞劌鍊圭换娑橆啅椤旇崵鐩庨梺鎼炲妼閸婂綊骞堥妸銉建闁糕剝顨呴埛鎺楁⒑閹肩偛鈧牠銆冮崱娑樜﹂柛鏇ㄥ枤閻も偓闂佸湱鍋撻幆灞轿涢悙鐢电＝濞达絽鎼牎閻庡厜鍋撻柟闂寸缁犳牗淇婇妶鍛櫤闁稿鍔戝濠氬醇閻旇　妲堟繛瀵稿У閿曘垹顫?
type AgentEventLite = { type: string; payload?: Record<string, any>; timestamp?: number };
type ArtifactLite = { id: string; kind?: string; asset_kind?: string; name?: string; url?: string; [k: string]: any };
type QuestionLite = { question: string; options?: string[]; [k: string]: any };

export type NodeRenderer = (node: CanvasNode) => React.ReactNode;

// Pipeline AbortController 闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呮繄鍒掑▎鎾崇婵°倓鐒﹀▍鏃堟⒒閸屾瑨鍏屾い顓炵墦椤㈡牠宕ㄩ婊呯厠閻熸粎澧楃敮鎺楀几娴ｈ　鍋撻獮鍨姎妞わ富鍨堕弻瀣炊椤掍胶鍙嗗┑鐘绘涧濡瑥顔忓┑鍥ヤ簻闁瑰墽鍋ㄩ崑銏ゆ煛瀹€瀣М闁诡喗鐟ч埀顒傛暩绾泛危閸儲鈷戦柛婵嗗婢ч亶鏌涢幘瀵告噰闁炽儲妫冨畷姗€顢欓懖鈺嬬床闂備胶绮崝鏇㈡偤閵娿儮鏋嶉柡宥庡幗閻撶喖鐓崶銊︾濞寸姭鏅犻弻娑氣偓锝庡亜婵秹鏌熼鐓庢Щ闁宠鍨归埀顒婄秵閸嬪棝宕㈤悽鍛娾拻闁稿本顨呮禍楣冩⒑瑜版帒浜伴柛娆忛铻ｉ柛灞剧矌绾捐棄霉閿濆懏鎯堥弽锟犳⒑閼姐倕鏆遍柡鍛洴閹箖鎮滈懞銉ヤ汗闁荤姴娲﹁ぐ鍐船閵娾晜鈷戞慨鐟版搐閻忣噣鏌℃担瑙勫€愰挊?
const pipelineAbortControllers = new Map<string, AbortController>();

/** Return all image references feeding a generation node, preserving edge order. */
export function connectedImageUrls(nodes: CanvasNode[], connections: Connection[], targetId: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return connections
    .filter((connection) => connection.to === targetId)
    .map((connection) => byId.get(connection.from))
    .filter((node): node is CanvasNode => node?.type === 'image' && typeof node.url === 'string' && node.url.trim().length > 0)
    .map((node) => node.url!.trim());
}

async function optimizeCanvasMediaPrompt(
  cfg: ApiConfig,
  prompt: string,
  style = 'cinematic',
  language = 'zh',
  signal?: AbortSignal,
): Promise<string> {
  const provider = getProviderForStep(cfg, 'promptOptimization');
  const model = getModelForStep(cfg, 'promptOptimization');
  if (!provider || !model) throw new Error('Prompt optimization model is unavailable');
  let optimized = '';
  for await (const chunk of optimizeSoraPrompt(provider, model, prompt, style, language, undefined, signal)) {
    optimized = chunk;
  }
  if (!optimized.trim()) throw new Error('Prompt optimization returned no content');
  return optimized.trim();
}

// ============ 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄闂佽鍨奸悘鎰亹閹烘挸鈧崵绱掑☉姗嗗剱闁?API 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭罕闂佸搫娲㈤崹鍦不閻樼粯鐓欓柟顖嗗啯顔戞繝銏ｆ硾椤戝洨寮ч埀顒勬⒑閹肩偛鍔橀柛鏂跨Т閳诲秹寮介鐔叉嫼缂備礁顦Λ妤冣偓姘煎枛閻ｇ兘鎯嶉悮姒torage 闂傚倷娴囬褍霉閻戣棄绠犻柟鎹愵嚙缁犵喖姊介崶顒€桅闁圭増婢樼粈鍐┿亜韫囨挻鎼愮亸蹇涙⒒娴ｇ瓔鍤冮柛銊ユ捣娴狅箓鎳為妷顔兼偑闂傚倸鍊风粈渚€骞夐敓鐘茬婵☆垵銆€閺嬫牠鏌￠崶鈺佇ラ柣顓炴椤潡鎳滈棃娑橆潔闂佺粯鎸婚悷褔鎯€椤忓牊鍋嬮柛鈺婂亽娴滄繄绮嬪鍡愬亝闁告劏鏂侀幏娲⒑閸涘﹦绠撻悗姘煎枟閺呭爼寮撮悢缈犵盎闂佹寧鏌ㄩ悘婵嗙暤閸℃瑢鍋撳▓鍨灍濠电偛锕獮鍐閵堝棗浜楅柟鑹版彧缂嶅棝宕憴鍕箚闁绘劦浜滈埀顒佺墪铻炲〒姘ｅ亾鐎规洘娲滈幏鐘裁圭€ｎ偆浜?FastAPI + SQLite闂?===========

/**
 * 婵犵數濮烽弫鎼佸磻濞戙埄鏁嬫い鎾跺枑閸欏繘鎮楀☉娆欎緵婵炲牅绮欓弻鐔兼⒒鐎靛壊妲紓浣哄У閻楁绌辨繝鍥ч柛娑卞幗濞堝爼姊洪崨濠庢畷缁炬澘绉规俊鐢稿礋椤栨艾鍞ㄩ梺闈涱焾閸斿矂藟濠靛棭娓婚柕鍫濋娴滃墽绱撳鍕槮妞ゆ洩缍佸畷濂稿即閻斿皝鍋撻悜鑺ョ厵婵炲牆鐏濋弸銈夋煟閹惧瓨宕屾慨濠冩そ濡啫鈽夊▎妯活棧缂傚倷绀侀ˇ顖滅礊婵犲洨宓侀柛鈩冪☉缁€瀣亜閺嶇數绋婚柡鍛櫊濮婅櫣绮欑捄銊ь唺闂佸憡顭嗛崘锔瑰亾閹烘绠涢柣妤€鐗冮幏铏圭磽閸屾瑧鍔嶉拑閬嶆倵閸偆鎳呴柍褜鍓欑粻宥夊磿閸楃伝娲Ω閳寡冩喘椤㈡岸鍩€椤掑嫬钃熼柍鈺佸暙缁剁偤鏌涢埄鍏╂垿鎮甸弴銏♀拺闁告繂瀚～锕傛煕閺傝法鐏遍柛?{ nodes, connections, viewport, theme, taskAssets }
 */
async function loadFromBackend(projectId?: string): Promise<Partial<CanvasStore> | null> {
  if (!projectId) return null;
  try {
    const snap = await api.getSnapshot(projectId);
    return {
      nodes: snap.nodes.map(toCanvasNode),
      connections: snap.connections.map(toConnection),
      viewport: {
        x: snap.project.viewport.x,
        y: snap.project.viewport.y,
        scale: snap.project.viewport.scale / 100,
      },
      taskAssets: snap.assets.map(toTaskAssetRef),
    };
  } catch (e: any) {
    // 404: 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶鈺佸壋闁兼澘娼￠弻娑樜旈崘褏闂梺缁樺灦閿氭い鏇憾閺屸剝寰勭€ｎ亞浠搁悗瑙勬尭缁夌懓顫忓ú顏咁棃婵炴垼浜崝鎼佹⒑缁嬪灝顒㈤柣鎾偓宕囨殾闁规壆澧楅崑銊╂煟閵忋垺鏆╅柨娑欑矒濮婃椽宕崟顐ｆ闂佹悶鍔庨弫濠氬箖濮椻偓閹垽鎼归崷顓ㄧ床婵犲痉鏉库偓鎰板磻閹炬番浜滈柨鏇炲€烽幉楣冩煕閳规儳浜炬俊鐐€栫敮濠囨嚄閸洖鐓€闁哄洢鍨洪悡銉︽叏濮楀棗骞樼紒鈾€鍋撻梻渚€鈧偛鑻晶瀛樸亜閵忊剝顥堢€规洖銈搁幃銏ゅ川婵犲嫬寤洪梻浣筋嚙妤犳悂宕㈠鍫濈；闁瑰墽绮悡鏇㈡煙閹佃櫕娅呭┑陇濮ら妵鍕棘閹稿骸鏋犲┑顔硷攻濡炶棄鐣烽妸锔剧瘈闁告劦浜滈獮妤呮⒒娴ｅ憡鍟為柡灞诲姂閹矂宕掑杈ㄦ閻熸粎澧楃敮鎺旀兜閳ь剟姊虹紒妯虹仴婵☆偅顨呴埢鎾愁潨閳ь剟寮婚埄鍐ㄧ窞閻忕偞鍨濆▽顏呯節閵忋垺鍤€婵☆偅绻堥妴渚€寮崼婵堫攨闂佺粯鍔忛弲婊堬綖瀹ュ鈷戦柣鐔稿娴犮垽鏌涢悢鍙夋珖闁奸缚椴哥粋鎺斺偓锝庡亞閸樻捇鏌ｉ悢鍝ユ噧閻庢凹鍠楅弲鍫曨敆閸曨剛鍘梺鎼炲劀閸愬彞绱旈柣搴ゎ潐濞叉粓宕楀鈧妴浣割潨閳ь剟骞冮姀銈嗘優闁荤喐澹嗛崐鐐测攽閻樺灚鏆╅柛瀣洴椤㈡岸顢橀悢绋垮伎婵炴潙鍚嬪娆戝閸ф鐓欐繛鍫濈仢閺嬨倝鏌ｉ鐔峰摵闁哄本鐩、鏇㈡晲閸℃瑯妲梺鑽ゅ枑閻熻京绮婚幘鑽ゅ祦闁哄秲鍔嶇紞鍥煕閹炬瀚禒褰掓⒒娴ｈ姤銆冮柣鎺炵畵瀹曟洜鈧湱濮寸徊褰掓⒒娴ｈ鍋犻柛搴灦瀹曟繃鎯旈敐鍥︾瑝闂佺懓澧界划顖炴偂閻旂厧绠抽柟鎯版缁€澶愭煙鏉堝墽鐣辩紒鐘靛У娣囧﹪濡堕崨顔兼闂佹悶鍊曠粔褰掑蓟閺囩喎绶為柛顐ｇ箓婵垺绻涚€涙鐜荤紓宥勭椤?
    if (e && /404/.test(e.message || '')) {
      try {
        await api.createProjectWithId(projectId);
        return { nodes: [], connections: [], viewport: { x: -1800, y: -1000, scale: 1 }, taskAssets: [] };
      } catch (createErr) {
        console.warn('[dramaforge] backend auto-create project failed:', createErr);
        return null;
      }
    }
    console.warn('[dramaforge] backend load failed:', e);
    return null;
  }
}

function toCanvasNode(n: NodeOut): CanvasNode {
  return {
    id: n.id,
    type: n.type as any,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    ...n.data,
  } as CanvasNode;
}

function fromCanvasNode(n: CanvasNode): NodeOut {
  const { id, type, x, y, w, h, ...rest } = n as any;
  return { id, type, x, y, w, h, data: rest };
}

function toConnection(c: ConnectionOut): Connection {
  return { id: c.id, from: c.from_node, to: c.to_node, fromPort: c.from_port, toPort: c.to_port };
}

function fromConnection(c: Connection): ConnectionOut {
  return { id: c.id, from_node: c.from, to_node: c.to, from_port: c.fromPort, to_port: c.toPort };
}

function toTaskAssetRef(a: AssetOut): TaskAssetRef {
  return {
    id: a.id,
    kind: (a.asset_kind || 'image') as TaskAssetKind,
    title: a.title,
    name: a.name,
    url: a.url || '',
    prompt: a.prompt || '',
    providerId: a.provider_id || undefined,
    providerName: a.provider_name || undefined,
    modelId: a.model_id || undefined,
    failed: a.failed,
    error: a.error || undefined,
    generating: a.generating,
    status: a.status || undefined,
    version: a.version || undefined,
    sourceAssetId: a.source_asset_id || undefined,
    derivedFrom: a.derived_from || [],
    referenceRole: a.reference_role || undefined,
    promptSource: a.prompt_source || undefined,
    promptOptimized: a.prompt_optimized || undefined,
    inspectionStatus: a.inspection_status || undefined,
  } as TaskAssetRef;
}

function fromTaskAssetRef(r: TaskAssetRef, projectId?: string): Partial<AssetOut> & { kind: string } {
  return {
    id: r.id,
    project_id: projectId,
    kind: r.kind === 'novel' || r.kind === 'script' ? 'text' : (r.kind === 'storyboard' ? 'image' : 'image'),
    asset_kind: r.kind,
    title: r.title,
    name: (r as any).name || r.title,
    url: r.url,
    prompt: r.prompt,
    provider_id: r.providerId,
    provider_name: r.providerName,
    model_id: r.modelId,
    failed: !!r.failed,
    error: r.error,
    generating: !!r.generating,
    status: r.status,
    version: r.version,
    source_asset_id: r.sourceAssetId,
    derived_from: r.derivedFrom,
    reference_role: r.referenceRole,
    prompt_source: r.promptSource,
    prompt_optimized: r.promptOptimized,
    inspection_status: r.inspectionStatus,
  };
}

// 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸閻ゎ喗銇勯幇鈺佺労闁搞倖娲熼弻銈囩矙鐠恒劋绮甸梺鍛婄懃缁绘﹢寮诲☉銏╂晝闁靛牆鎳忛悘渚€姊哄畷鍥ㄥ殌缂佸鏁搁幑銏犫攽鐎ｎ偒妫冨┑鐐村灦閻燁垰螞閵堝鈷戦柛锔诲幗濞呮洖鈹戦悙鈺佷壕闂備礁鎼悮顐﹀礉瀹€鍕叀濠㈣泛艌閺嬪酣鐓崶銊﹀鞍闁硅櫕鐟ラ埞鎴︽倷鐎涙绋囬梺姹囧妿閸忔ê顕ｉ弻銉﹀亹闁肩⒈鍓氬▓鎯р攽鎺抽崐鎰板磻閹炬番浜滈柟鍓у仺閸嬨垻鈧娲栧畷顒勫煝鎼淬劌绠涢悗锝庡亞婢ь亪鏌?state 闂傚倷娴囬褍霉閻戣棄鏋佸┑鐘宠壘绾捐鈹戦悩鍙夋悙缂佹劖顨婇弻鈥愁吋鎼粹€冲箥婵炲瓨绮庨幊鎾烩€﹂崸妤佸殝闂傚牊绋戦～宀€绱撴担鎻掍壕閻庡厜鍋撻柛鏇ㄥ墰閸樻悂鎮楅獮鍨姎濡ょ姵鎮傞悰顕€寮介鐔哄幈濠碘槅鍨崇划顖滀焊閿曞倹鐓涚€光偓閳ь剟宕伴弽褏鏆︾憸鐗堝俯閺佸啴鏌ㄥ┑鍡樺櫧妞わ絾鐓″缁樻媴缁涘娈愰梺鍝ュУ椤ㄥ﹪濡撮崘顔奸唶闁靛繒濮撮悘?
let saveNodesTimer: ReturnType<typeof setTimeout> | null = null;
let saveConnTimer: ReturnType<typeof setTimeout> | null = null;
let saveViewTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveNodes(projectId: string, nodes: CanvasNode[]) {
  if (saveNodesTimer) clearTimeout(saveNodesTimer);
  saveNodesTimer = setTimeout(() => {
    api.saveNodes(projectId, nodes.map(fromCanvasNode)).catch((e) => console.warn('[dramaforge] saveNodes failed', e));
  }, 600);
}

function scheduleSaveConnections(projectId: string, conns: Connection[]) {
  if (saveConnTimer) clearTimeout(saveConnTimer);
  saveConnTimer = setTimeout(() => {
    api.saveConnections(projectId, conns.map(fromConnection)).catch((e) => console.warn('[dramaforge] saveConnections failed', e));
  }, 600);
}

function scheduleSaveViewport(projectId: string, viewport: Viewport) {
  if (saveViewTimer) clearTimeout(saveViewTimer);
  saveViewTimer = setTimeout(() => {
    api.updateProject(projectId, { viewport: { x: viewport.x, y: viewport.y, scale: Math.round(viewport.scale * 100) } })
      .catch((e) => console.warn('[dramaforge] saveViewport failed', e));
  }, 800);
}

// 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕闂佺硶鍓濋…鍥╃不妤ｅ啯鐓欓悗鐢殿焾閸撻亶鏌ｉ幒鏃€娅曠紒?闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢埛姘そ婵¤埖寰勭€ｎ亙妲愰梻渚€娼ц墝闁哄懏鐩幏?闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佺粯鍔曢顓犵不妤ｅ啯鐓冪憸婊堝礈濮樿鲸宕叉繛鎴欏灩瀹告繃銇勯幘璺烘瀾鐎规洘濞婂娲捶椤撗勭秺闂佹悶鍎滈崪浣剐у┑锛勫亼閸婃洜鎹㈤幇鐗堝亱闊洦鎸鹃弳锔界節婵犲倻澧涢柍閿嬪灴閺屾稑鈽夊鍫濅紣缂備焦顨嗙喊宥囨崲濠靛顫呴柍钘夋嚀閳ь剚瀵ч〃銉╂倷閹绘帗娈柧缁樼墵閺屾盯骞囬崗鍝ョ泿閻?
async function syncAssetCreate(r: TaskAssetRef, projectId?: string): Promise<TaskAssetRef> {
  try {
    const created = await api.createAsset({ ...fromTaskAssetRef(r, projectId) });
    return { ...r, id: created.id };
  } catch (e) {
    console.warn('[dramaforge] syncAssetCreate failed', e);
    return r;
  }
}
async function syncAssetUpdate(r: TaskAssetRef): Promise<void> {
  try {
    await api.updateAsset(r.id, fromTaskAssetRef(r));
  } catch (e) {
    console.warn('[dramaforge] syncAssetUpdate failed', e);
  }
}
async function syncAssetDelete(id: string): Promise<void> {
  try {
    await api.deleteAsset(id);
  } catch (e) {
    console.warn('[dramaforge] syncAssetDelete failed', e);
  }
}

// 婵犵數濮烽弫鎼佸磻濞戙埄鏁嬫い鎾跺枑閸欏繘鏌℃径瀣鐟滅増甯楅崐濠氭煢濡警妲归柣搴墴濮婃椽宕ㄦ繝鍐ㄧ樂闂佸憡娲﹂崜姘额敊閸ヮ剚鈷掑ù锝呮啞閸熺偤鏌涢弮鎾剁暤鐎规洏鍨介幊婵嬪箥椤旂粯鐫忛梻鍌氬€搁崐鐑芥嚄閸撲礁鍨濇い鏍仜缁€澶嬩繆閵堝懏鍣圭紒鐘靛█閺岀喖鎮欓鈧晶顖炴煕閵堝棙绀€闂囧鏌ｅΟ鐑樷枙闁稿骸绻橀幃宄扳枎濞嗘垹鏆ら梺鍝勭灱閸犳劕顭囪箛娑樼鐟滃繘寮抽悩娴嬫斀闁绘劕寮堕崳鐑芥煕閵娿儺鐓奸柛鈹惧亾?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻娑㈠焺閸愵亖妲堥梺绋胯閸旀垿骞冨畡鎵虫瀻闊洦鎼╂禒楣冩⒑缁嬫寧鎹ｉ柛鐘崇墵瀵鏁撻悩鑼€為梺鍝勭墢閺佹悂寮弽顐ょ＝濞达絿鎳撴慨鍫熴亜閵娿儻韬€殿喖顭烽弫鎾绘偐閼碱剦妲伴梻浣告啞濞诧箓宕戦崟顖ｆ晜妞ゅ繐鎳愮粻楣冩煕椤愶絿绠橀柛鈺嬬秮閺屸€崇暆閳ь剟宕伴幘璇茬闁绘顕ч悘鎶芥煣韫囷絽浜炲ù婊冪埣濮婄粯鎷呴崷顓熻弴闂佺閰ｆ禍鍫曠嵁婵犲伣鐔哥瑹椤栨碍顓块梻浣稿閻撳牓宕戦崟顓燁偨闁绘劕妯婇悢鍡涙偣妤︽寧顏犻柣蹇氶哺閵囧嫰寮埀顒€螞閸愵喖钃?taskAssets 闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呮繄鍒掑▎鎾崇婵＄偛鐨烽崑鎾诲礃椤旂厧鑰垮┑鐐村灱妞存悂寮查埡鍛€甸柛蹇擃槸娴滈箖姊洪崨濠冨闁稿妫濋幆鍫ュ礋椤栨稈鎷洪梺鍛婄箓鐎氼喗鏅堕敂鐣岀濞达絽鍟垮ú銈夋偂濠靛鍙撻柛銉ｅ妿閳洟鏌ｉ幘璺烘灈闁哄本娲濈粻娑欑節閸愨晝褰囬梻浣告啞钃辩紒顔兼捣濡?
function rebuildTaskAssetsFromNodes(nodes: CanvasNode[]): TaskAssetRef[] {
  const tagMap: Record<string, string> = {
    character: 'assetTagCharacter',
    prop: 'assetTagProp',
    scene: 'assetTagBackground',
    storyboard: 'assetTagStoryboard',
    novel: 'canvasPanelAssetsNovel',
    script: 'canvasPanelAssetsScript',
  };
  const t = getT();
  const refs: TaskAssetRef[] = [];
  for (const n of nodes) {
    const kind = n._assetKind as string | undefined;
    if (!kind) continue;
    const tagKey = tagMap[kind] || '';
    const tagLabel = tagKey ? t(tagKey) : kind;
    const isText = kind === 'novel' || kind === 'script';
    refs.push({
      id: n.id,
      kind: kind as TaskAssetKind,
      name: (n.title || n.name || '') as string,
      url: n.url || '',
      tags: n._assetFailed ? [tagLabel, t('canvasPanelAssetTagFailed')] : [tagLabel],
      prompt: n._assetPrompt as string | undefined,
      providerId: n._assetProviderId as string | undefined,
      providerName: n._assetProviderName as string | undefined,
      modelId: n._assetModelId as string | undefined,
      generating: false,
      failed: n._assetFailed as boolean | undefined,
      error: n._assetError as string | undefined,
      status: n._assetStatus as string | undefined,
      version: typeof n._assetVersion === 'number' ? n._assetVersion : undefined,
      sourceAssetId: n._assetSourceAssetId as string | undefined,
      derivedFrom: Array.isArray(n._assetDerivedFrom) ? (n._assetDerivedFrom as string[]) : undefined,
      referenceRole: n._assetReferenceRole as string | undefined,
      promptSource: n._assetPromptSource as string | undefined,
      promptOptimized: n._assetPromptOptimized as string | undefined,
      inspectionStatus: n._assetInspectionStatus as string | undefined,      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧壕鍦磼鐎ｎ偓绱╂繛宸簼閺呮繈鏌嶈閸撶喖寮崘顔碱潊闁靛牆鎳愰鐓庮渻閵堝棙顥嗘俊顐㈠閹啴顢曢敂瑙ｆ嫼闂佸憡绋戦敃銉﹀緞閸曨個鐟邦煥鎼存繈鍋楅梺璇″枙閸楁娊鐛Ο鑲╃＜婵☆垳鍘ч獮?text 婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁躲倝鏌涢幘妤€鍟悘濠囨⒑閸撴彃浜栭柛銊ㄦ閳?prompt 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒缁€澶屸偓鍏夊亾闁逞屽墴閸┾偓妞ゆ帊绀侀崵顒勬煕閵娾晜娑ч摶鐐烘煏韫囧鈧牠鍩涢幋鐘电＜閻庯綆鍘界涵鍓佺磼閻樺崬宓嗛柡宀€鍠栧畷姗€寮婚妷銉ュ強闂備浇顕栭崹浼存偋閸℃侗鏁囧┑鍌滎焾閻愬﹪鏌嶉崫鍕殶闁告柨鐖煎缁樻媴閾忕懓绗￠梺鐓庣秺缁犳牠銆佸棰濇晣闁绘鏁搁悞濂告⒑閸涘﹥澶勯柛瀣╃窔閸┾偓妞ゆ帊绀佺粭鎺撱亜椤愶絿绠為柛鈹惧亾濡炪倖甯掔€氼剛绮堢€ｎ偁浜滈柟鎹愭硾娴犙囨煕閺傝法绉烘慨?assetKind=text 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犳壆绱掔€ｎ偒鍎ラ柛銈嗘礋閺屾盯顢曢敐鍡欘槰闂佺顑呴崐鍧楀箖濡ゅ懏鏅查幖绮瑰墲閻忓牏绱掔紒銏犲箰闁稿鎹囧缁樻媴閻熼偊鍤嬬紓浣割儐閸ㄥ綊鍩€椤掍礁鍤柛鎾跺枛婵℃挳宕掑☉姘辩槇濠殿喗锕╅崢楣冨矗?
      ...(isText ? {} : {}),
    });
  }
  return refs;
}

const API_CONFIG_KEY = 'dramaforge-canvas-api-config';

function loadApiConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(API_CONFIG_KEY);
    if (!raw) return createDefaultApiConfig();
    const data = JSON.parse(raw);
    if (data && data.providers && (data.modelBindings || data.stepBindings)) {
      // Migrate old format: ensure providers have all fields
      data.providers = data.providers.map((p: any) => ({
        id: p.id || '',
        name: p.name || p.id || '',
        baseUrl: p.baseUrl || p.base_url || '',
        protocol: p.protocol || 'openai',
        enabled: p.enabled !== false,
        apiKey: p.apiKey || p.api_key || '',
        imageModels: p.imageModels || p.image_models || [],
        chatModels: p.chatModels || p.chat_models || [],
        videoModels: p.videoModels || p.video_models || [],
        hasKey: p.hasKey || p.has_key || false,
        keyPreview: p.keyPreview || p.key_preview || '',
        walletApiKey: p.walletApiKey || '',
        hasWalletKey: p.hasWalletKey || false,
        walletKeyPreview: p.walletKeyPreview || '',
        volcengineAccessKeyId: p.volcengineAccessKeyId || '',
        volcengineSecretAccessKey: p.volcengineSecretAccessKey || '',
        hasVolcengineAccessKey: p.hasVolcengineAccessKey || false,
        volcengineAccessKeyPreview: p.volcengineAccessKeyPreview || '',
        hasVolcengineSecretKey: p.hasVolcengineSecretKey || false,
        volcengineSecretKeyPreview: p.volcengineSecretKeyPreview || '',
        volcengineProjectName: p.volcengineProjectName || 'default',
        volcengineRegion: p.volcengineRegion || 'cn-beijing',
      }));
      return normalizeModelBindings(data);
    }
    return createDefaultApiConfig();
  } catch {
    return createDefaultApiConfig();
  }
}

function saveApiConfig(config: ApiConfig) {
  try {
    localStorage.setItem(API_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable
  }
}

/* ========================
 * 婵犵數濮烽弫鎼佸磻閻愬搫绠伴柤濮愬€曢弸鍫⑩偓骞垮劚濞层劑鎯屽▎鎾寸厵閻庣數顭堥瀷婵犳鍠楁繛濠囧蓟閿涘嫪娌悹鍥ㄥ絻婵酣姊哄Ч鍥р偓銈夊闯閿濆钃熸繛鎴欏灩閻掓椽鏌涢幇銊︽珖婵炲牄鍊濋弻锝夋偐鏉堚晝鐡樼紓浣藉蔼濞夋洖危閹版澘绠抽柟鎯х－缁愮偞绻濋姀锝嗙【濠靛倹姊婚幉浼村幢濞嗘垹锛濇繛杈剧稻閸ㄦ繈宕ラ锝囩闁告粈鐒︾壕鐥梐lStorage 闂?闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄闂佽鍨奸悘鎰亹閹烘挸鈧崵绱掑☉姗嗗剱闁?DB
 * 闂傚倸鍊峰ù鍥敋瑜庨〃銉х矙閸柭も偓鍧楁⒑椤掆偓缁夊澹曟繝姘厪闁割偅绻冩刊濂告煟鎼淬倕鐓愰柕鍥у瀵粙顢曢～顓熷媰闂備胶绮敮鎺椻€﹂悜钘夎摕闁跨喓濮寸粈瀣亜閹扳晛鈧顢欐繝鍥ㄧ厽闁靛繆鏅涢悘鐘充繆椤愶絿绠炵€?services/mediaProviderMigration.ts闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熼悜妯烩拻闁活厽鐟╅弻鈥愁吋鎼粹€茬凹閻庤娲橀悡锟犲蓟閳ユ剚鍚嬮幖绮光偓宕囶啈闂備胶绮幐鎼佸磹閸ф绠栨慨妞诲亾闁诡喗鐟ч幑鍕姜閻楀牏娼栫紓鍌氬€烽懗鑸垫叏瀹曞洤鍨濇繛鍡樻尭閽冪喖鏌ㄥ┑鍡╂Ч闁哄懏鐓￠弻娑㈠焺閸愵亝鍣梺闈╃秵閸樺ジ鍩為幋锕€鐓￠柛鈩冦仦閼割亪姊虹粙娆惧剰闁挎洏鍊濋幃?re-export 闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т缁€鍫熺箾閸℃ɑ灏伴柛濠呭煐缁绘繈妫冨☉鍗炲壈闂佺琚崝鎴﹀蓟閺囥垹閱囨繝鍨姈鏁堥梻浣侯焾鐎涒晠鏁冮姀銈呰摕闁斥晛鍟欢鐐烘倵閿濆簼绨藉ù鐘叉憸缁辨捇宕掑姣欍垽姊虹敮顔剧М妤犵偛鍟村畷鐑筋敇濞戞ü澹曢梺鎸庣箓缁ㄨ偐鑺辨繝姘厸闁糕剝鐟ラ弸娑㈡煛鐏炵澧查柟宄版嚇濡啫鈽夐幒鎴滃濠电娀娼уΛ顓㈠吹閺囩喆浜滈柟鐑樺灥椤忣偆鈧鎸风欢姘剁嵁閺嶎偀鍋撳☉娅虫垹浜搁鐏?
 * 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熺紒銏犳灈缁炬儳顭烽弻鐔煎箚瑜滈崵鐔虹磼閻樿崵鐣洪柡灞剧洴閸ㄦ儳鐣烽崶鈺婂敹濠电姭鎷冮崟顓炲绩闂佸搫鑻粔鐑铰ㄦ笟鈧弻娑欐償閿濆海鍔稿銈嗘尭閵堢鐣烽崼鏇炵厸闁告劑鍔庨崐鐐烘⒒閸屾瑦绁版い鏇嗗厾褰掓倻閽樺鐤囬梺瑙勫礃椤曆呪偓姘槹閵囧嫰骞掗幋婵愪患闂佹悶鍔岄崐褰掑箞閵娿儙鐔煎箰鎼达絻鈧劙鏌ｉ悢鍝ユ嚂缂佺姵鎹囬悰顕€寮介銏犵亰闂佺绻愰ˇ顖涚妤ｅ啯鐓ｉ煫鍥风到娴滄繃銇?`dramaforge-media-migrated-v1=1`闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁搞倖鍔栭妵鍕冀椤愵澀绮剁紓浣哄У閻楁绌辨繝鍥ч柛娑卞幗濞堝墎绱掗悙顒€鍔ら柛姘儔婵＄敻宕熼姘鳖啋闁诲酣娼ч幗婊堟偩婵傚憡鈷戦柤濮愬€曢弸鎴犵磼鐠囪尙澧︾€殿喛顕ч埥澶愬閻樼數鏉告俊鐐€栫敮鎺楀磹閹版澘顫呴柕鍫濇閸樹粙姊洪棃娑辩劸闁稿酣浜堕崺娑㈠籍閸喓鍘垫俊鐐差儏妤犳悂鍩㈤崼鈶╁亾濞堝灝鏋熸繛鍏肩懆閻忔帡鎮楅悷鏉款伃妞わ綇闄勭粩?
 * 闂傚倸鍊搁崐鐑芥嚄閸洖纾块柣銏㈩焾閻ら箖鏌嶉崫鍕櫣缂佹劖顨嗘穱濠囧Χ閸涱喖娅ら梺绋款儏椤︾敻寮婚妸銉㈡斀闁糕檧鏅滄晥闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當缂佺姴缍婇弻鐔碱敍濠婂啯鐏堝┑顔硷工閹碱偆鍙呯紓鍌欑劍閿氶柍璇茬箻濮婃椽宕ㄦ繝鍐弳缂備礁顦遍幊鎾绘偩閻戣棄浼犻柛鏇樺妽椤秴鈹戦绛嬫當婵☆偅鐟ラ々濂稿Ω閳哄倵鎷洪梻鍌氱墛缁嬫挻鏅堕弴銏＄厵闁告劖鐓￠崣鍕崉椤栫偞鐓曟繛鎴烆焽閹界娀鏌ｉ幘瀛樼闁哄被鍔戝顒勫箰鎼淬垹鍓靛┑鐘殿暜缁辨洟宕㈣閳ワ箓鎳楅锝喰┑鐘愁問閸ｏ綁藟閹捐绀?localStorage 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇楀亾妞ゎ厼鐏濊灒闁兼祴鏅濋悡瀣⒑閸撴彃浜濇繛鍙夛耿瀹曟垿顢旈崼鐔哄幈闂佹枼鏅涢崯浼村煀閺囥垺鐓曢幖杈剧磿鏁堥梺鍝勬湰閻╊垰顕ｉ幘顔嘉╅柕鍫濇处閺呭ジ姊洪崫鍕垫Т闁哄懏绮岃灋闁告劦鍠氬畵渚€鏌″搴′簮闁稿鎸搁埥澶娾枍閾忣偄鐏撮柟顕嗙節婵＄兘鍩￠崒婊冨箰闂備礁鎲℃笟妤呭磻閸曨垱鍊堕柡灞诲劜閻撴稑霉閿濆懏鎲搁弫鍫ユ倵鐟欏嫭绀堥柛妯犲洤鐓橀柟杈剧畱閻愬﹦鎲稿鍡欑彾?apiKey闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熷▎陇顕уú顓€佸▎鎾崇鐟滃秴鐣烽妷鈺傗拺闁告繂瀚峰Σ褰掓煕閵娧冩灈鐎殿喖鎲￠幆鏃堝Ω閿旀儳甯楅梻浣哥枃濡椼劎绮堟笟鈧铏節閸ャ劎鍘遍柣搴秵閸嬪懎鐣烽崟顑句簻闁挎梻鏅崣鈧梺鍝勬湰缁嬫垿鍩㈡惔銈囩杸闁哄啯鍨堕敍渚€姊绘担绛嬪殐闁搞劌宕灋闁告劦鍠氬畵浣圭箾閸℃ɑ灏紒鈧€ｎ偁浜滈柟鎹愭硾娴犫晠鏌?
 *       婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀閽冪喖鏌曟繛鐐珦闁轰礁瀚伴弻娑樷槈濞嗘劗绋囩紓浣哄У閻楁绌辨繝鍥ч柛娑卞枛濞咃絿绱撴担鍝勑為柛搴ｆ暬瀵顓奸崼顐ｎ€囬梻浣告啞閹搁箖宕版惔顭戞晪闁挎繂顦崹鍌涖亜閹扳晛鐏紒鎰仱閺岀喖宕楅崗鐓庡壒闂佸摜濮甸悧鏇㈠煝?/ 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼槷闂佸搫绋侀崢浠嬪磻閿熺姵鐓冮柛婵嗗閸ｅ湱绱掗埀顒勫磼濞戞绠氬銈嗙墬閼归箖骞冮幋锔藉€堕煫鍥ㄦ崌閸欏嫰鏌＄仦绋垮⒉鐎垫澘瀚埀顒婄秵娴滃爼宕电€ｎ喗鈷戠紒瀣皡閸旂喖鏌℃担鍛婃喐婵″弶鍔欓獮鎺懳旈埀顒傜尵瀹ュ鐓欓悗娑欘焽缁犳ê霉閻撳海澧㈢紒杈ㄦ尰閹峰懏绂掔€ｎ亝鎳欑紓鍌欐祰椤曆囨偋閸℃稒鍋╃€瑰嫰鍋婇悡銉╂煕閹邦厼鍔ら柟顔藉灴濮婃椽骞栭悙鎻掑濠电姭鍋撻柛锔诲幗椤洟鏌熼幆褜鍤熺紒鐘荤畺閺岀喓鈧數顭堟禒锕傛倶韫囷絽骞樼紒杈ㄥ笚瀵板嫮鈧綆鍋勯崬澶愭倵鐟欏嫭澶勯柛銊ョ埣瀹曟椽鍩€椤掍降浜滈柟鐑樺灥椤忣亪鏌ｉ幘瀵告噰婵﹤顭烽崺鈧い鎺戝缁犳稒銇勯弮鍌氬付妞ゎ剙顦扮换婵嬫偨闂堟刀娑㈡煕鐎ｎ偅灏柕鍡樺笒椤繈鏁愰崨顒€顥氶梺璇插椤旀牠宕板顓熸珷婵°倕鎳庣粻姘舵煛閸愩劎澧曟い顐㈡嚇閺屻劌鈽夊Ο渚槐闂?apiKey闂?
 * ======================== */
export {
  migrateLocalProvidersToBackend,
  resetMediaMigrationFlag,
  type MigrationResult,
} from '../../services/mediaProviderMigration';

function createDefaultApiConfig(): ApiConfig {
  return {
    providers: DEFAULT_PROVIDERS.map(p => ({
      ...p,
      imageModels: [...p.imageModels],
      chatModels: [...p.chatModels],
      videoModels: [...p.videoModels],
    })),
    modelBindings: normalizeModelBindings({ providers: DEFAULT_PROVIDERS }).modelBindings,
  };
}

// 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢崯顖氱暦閺屻儲鐓曠€光偓閳ь剟宕曢幋鐘电闁哄稁鍘介悡娆撴煟濡も偓閻楀﹦娆㈤懠顒傜＜闁逞屽墮閻ｆ繈宕熼鍌氬箰闁诲骸绠嶉崕杈╂崲閹烘鍋╃€规洖娲ㄧ壕濂告煃瑜滈崜娑㈠焵椤掑﹦绉甸柛鎾寸〒婢规洟鎳栭埞鎯т壕闁稿繐顦禍楣冩⒑閸涘﹤濮€闁哄應鏅滅粋鎺楀煛閸屾粎鐦堝┑鐐茬墕閻忔繈寮搁悢鍏肩厵妞ゆ梻鍘ч埀顒€娼￠幃浼搭敋閳ь剟宕洪埀?闂?闂傚倸鍊搁崐鐑芥倿閿曗偓椤啴骞愭惔锝庢锤闂佺粯鍔曢幖顐ょ玻濡ゅ懎绠规繛锝庡墮婵′粙鏌涚€ｅ吀閭柡灞剧洴瀵挳濡搁妷褌鍝楅梻浣告惈椤戝嫮娆㈠璺鸿摕闁挎繂鎲橀弮鍫濈劦妞ゆ帒瀚崑瀣煕閳╁啰鎳呴柣顓炵墦閺屻劑寮撮悙娴嬪亾瑜版帗鍋?loadProject 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍝勭▉閸樿偐澹曢崷顓熷枑闁绘鐗嗘穱顖炴煛娴ｅ憡顥㈤柡宀嬬秮楠炲洭顢楁径濠冾啀婵＄偑鍊愰弲婵嬪礂濮椻偓閻涱噣寮介銏犵亰闂佽崵鍠愬姗€鍩涙径鎰拺缂佸灏呴崝鐔兼煛娴ｅ憡鎲告俊鍙夊姍楠炴帒螖閳ь剛鐚惧澶嬬厵閻庢稒顭囩粻妯好归悪鈧崢鐣屾崲濠靛棌鏋旈柛顭戝枤娴狀厼鈹戦敍鍕哗婵☆偄瀚伴幃?
const savedApiConfig = loadApiConfig();

interface CanvasStore {
  nodes: CanvasNode[];
  connections: Connection[];
  viewport: Viewport;
  selected: Set<string>;
  theme: CanvasTheme;
  undoStack: UndoState[];
  assetPanelOpen: boolean;
  composerOpen: boolean;
  apiConfig: ApiConfig;
  projectId: string | null;
  taskAssets: TaskAssetRef[];

  // Cascade run state
  cascadeRunning: boolean;
  cascadeRunPath: string[];
  cascadeNodeStatus: Map<string, 'queued' | 'running' | 'done' | 'failed'>;

  addNode: (node: CanvasNode) => void;
  removeNodes: (ids: string[]) => void;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  moveNode: (id: string, x: number, y: number) => void;
  resizeNode: (id: string, w: number, h: number) => void;

  addConnection: (from: string, to: string) => void;
  removeConnection: (id: string) => void;

  setViewport: (viewport: Viewport) => void;
  setTheme: (theme: CanvasTheme) => void;

  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  toggleSelect: (id: string) => void;

  pushUndo: () => void;
  performUndo: () => void;

  copySelected: () => void;
  pasteNodes: (point: { x: number; y: number }) => void;
  clipboard: CanvasNode[];

  groupSelectedNodes: () => void;
  toggleAssetPanel: () => void;
  toggleComposer: () => void;

  setApiConfig: (config: ApiConfig) => void;
  setTaskAssets: (assets: TaskAssetRef[]) => void;

  // Cascade run actions
  startCascadeRun: (path: string[]) => void;
  updateCascadeNodeStatus: (nodeId: string, status: 'queued' | 'running' | 'done' | 'failed') => void;
  stopCascadeRun: () => void;

  // Video generation action
  runVideoGeneration: (nodeId: string, params: {
    prompt: string;
    providerId: string;
    modelId: string;
    inputImageUrls: string[];
    aspectRatio?: string;
    duration?: string;
  }) => Promise<void>;

  // Pipeline action 闂?闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箛椤旇棄搴婇梺褰掑亰閸庨潧鈽夊Ο婊勬瀹曘劑顢欓悡搴☆棄濠碉紕鍋戦崐鏍暜閹烘纾归柛锔诲幐閸?闂傚倸鍊搁崐宄懊归崶顒夋晪闁哄稁鍘奸崹鍌炴⒒閸喓鈻撻柡瀣Ч閺岋繝宕堕埡浣囷綁鏌涜箛鏃傜煉闁哄被鍊楃划娆戞崉閵娿倗椹冲┑鐘愁問閸犳鍒掑澶娢﹂柛鏇ㄥ灠缁犲磭鈧箍鍎卞ù鍌毼ｉ鈧弻鐔煎礂閸忚偐绋囬梺鎸庢磸閸婃繈宕洪妷锕€绶為柟閭﹀墰椤旀帡姊洪悡搴綗闁稿﹥顨堢划锝呂旈崘顏嗭紳婵炶揪缍侀ˉ鎾舵嫻娴煎瓨鐓曢悗锝庝簼閸ｇ晫绱掗纰卞剰妞ゆ挸銈稿畷濂割敃閿濆倹鐎卞┑鐘垫暩婵兘銆傞挊澹╋綁宕ㄩ弶鎴犵厬闂佸憡鍔﹂崰鏍不?
  runPipeline: (nodeId: string, params: {
    inputText: string;
    sourceType: 'novel' | 'idea';
    style: ArtStyle;
    language: Language;
  }) => Promise<void>;

  // Pipeline 闂傚倸鍊搁崐鐑芥嚄閸洍鈧箓宕奸妷顔芥櫈闂佺硶鍓濋悷銉╁垂濠靛牃鍋撻獮鍨姎妞わ缚绮欏顐﹀幢濡偐顔曢梺鐟扮摠閻熴儵鎮橀埡鍐＜闁绘﹩鍠栭崝銈夋煙閸欏鍊愭鐐差儔閺佸倻鎮伴垾鍏呭?
  stopPipeline: (nodeId: string) => void;

  // 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊箣閿濆憛鎾绘煕?闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊閵忊晝鍔搁梺钘夊暟閸犲酣鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑缁嬫鍎嶉柛鏃€鍨垮濠氭晲婢跺﹦鐫勯梺绋胯閸婃宕濋幖浣光拺閻犲洩灏欑粻鐗堢箾瀹割喖寮€殿喛顕ч埥澶娢熷鍕拹闁瑰嘲鎳樺畷鐑筋敇閵娧冭€块梻鍌氬€搁崐椋庣矆娴ｅ壊鍤曢柛鎾茬閸ㄦ繈骞栧ǎ顒€濡肩紒鐘冲閹叉悂寮捄銊︽闂佺粯姊婚埛鍫ュ极閸岀偞鐓曟い鎰Т閻忊晝绱掗埀顒勫醇閵夛腹鎷绘繛杈剧悼閹虫捇顢氬鍛＜閻庯綆鍋勯悘鎾煙椤斻劌瀚弧鈧梺鎼炲劀閸曨厸鍋撻鈧—鍐Χ閸℃锛曢梺绋款儐閹稿銆冮妷鈺傚€烽柡澶嬪灥椤秹姊洪悷鏉挎Щ闁硅櫕锕㈤悰顕€寮介鐔封偓鐑芥煟濡も偓閻楀﹦娆㈠鑸碘拻濞达綀妫勯崥鐟扳攽椤旂偓鏆€规洘绻堥獮瀣晝閳ь剛澹曢崸妤佸€甸梻鍫熺⊕閹叉悂鏌ｉ鐐靛闁靛洤瀚伴獮鍥礈娴ｇ懓浠规俊鐐€愰弲鐐典焊濞嗘挸绠熼柟闂寸缁秹鏌涢锝囩疄婵☆偆鍏樺娲川婵犲嫮绱伴梺绋挎唉鐏忔瑩鍩€?+ 濠电姷鏁告慨鐢割敊閺嶎厼绐楁俊銈呭暞瀹曟煡鏌熼柇锕€鏋涚紒韬插€曢湁闁绘ê妯婇崕鎰版煕鐎ｎ亶妯€闁哄本鐩獮姗€鎳犻鈧俊浠嬫煟韫囨挾绠伴梺甯秮瀵鈽夐姀鐘插祮闂侀潧顭堥崐婵嬪磻濡ゅ懏鈷戠紓浣诡焽閳洟鏌熼悷鐗堟悙妞ゎ偄绻愮叅妞ゅ繐瀚宀勬⒑閸︻厼鍔嬮柡瀣靛墴閺佹劖寰勭€ｎ剙骞愰梺璇茬箳閸嬬偤寮告繝姘卞彆妞ゆ帒瀚悡娆愩亜閺冨洤鍚归柣顓熺懇閺岀喖顢欓崫鍕紕缂備緡鍠楅悷褔骞戦崟顖毼╅柕鍫濇瀹?+ 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝Υ閸愨晜鍎熼柕蹇嬪焺濞茬鈹戦悩璇у伐闁绘锕畷鎴﹀煛閸涱喚鍘介梺閫涘嵆濞佳勬櫠娴煎瓨鐓?prompt闂?
  retryFailedAsset: (taskAssetId: string, customPrompt?: string) => Promise<void>;

  setNodes: (nodes: CanvasNode[]) => void;
  setConnections: (connections: Connection[]) => void;
  reset: () => void;
  loadProject: (projectId: string) => void;

  // AgentMode 闂?Canvas 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭紒瀣嚦濞戞鏃堝焵椤掑啰浜辨繝鐢靛仜濡瑩骞愰幖浣稿瀭闁稿本绋掗崣蹇斾繆椤栨氨浠㈤柣鎾村姍閺岋繝宕担绋款潽闂侀€涚┒閸斿矂锝炲鍫濆耿婵°倐鍋撶紒鐘茬秺閺?agent 婵犵數濮烽弫鎼佸磻濞戙垺鍋ら柕濞у啫鐏婇悗鍏夊亾闁告洖鐏氶弲鐐烘⒑閸涘﹥澶勯柛瀣у亾闂佸搫顑呴柊锝夊蓟閺囷紕鐤€閻庯綆浜栭崑鎾诲即閻樺吀绗夊銈嗘磵閸嬫捇鏌″畝瀣瘈鐎规洖鐖奸崺鈩冩媴妞嬪孩宕熷┑锛勫亼閸婃垿宕濆澶嬪剮妞ゆ牜鍋涢拑?7 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢幊宀勫焵椤掆偓閸熸潙鐣锋總绋课ㄩ柕澶涘閳ь剦鍓熷娲川婵犲啫鐦烽梺鍛婃处閸撴岸顢欓崶顒佲拻濞达絽鎲￠崯鐐烘煕閺冩挾鐣电€规洏鍨介幊婵嬪箥椤旂粯鐫忛梻?
  nodeOverrides: Record<string, { dx: number; dy: number }>;
  addAgentNodes: (input: {
    userGoal: string;
    plan: any[];
    actions: AgentEventLite[];
    observations: AgentEventLite[];
    artifacts: Record<string, ArtifactLite[]>;
    pendingQuestion: QuestionLite | null;
    status?: string;
  }) => void;
  clearAgentNodes: () => void;

  /** 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝Υ閸愨晜鍎熼柕蹇嬪焺濞茬鈹戦悩璇у伐閻庢凹鍙冨畷锝堢疀濞戞瑧鍘撻梺鍛婄箓鐎氼剟寮抽悢铏规／闁告瑣鍎抽惌娆撴煛鐏炵晫效鐎规洦鍋婂畷鐔碱敃閻旇渹澹曢悷婊呭鐢帞鐥?viewport 婵犵數濮烽弫鎼佸磻濞戙埄鏁嬫い鎾跺枑閸欏繐霉閸忓吋缍戠痪鎯ф健濮婃椽顢楅埀顒傜矙娓氣偓瀵偅绻濋崶銊у幍闂備緡鍙忕粻鎴﹀几閵堝棔绻嗘い鎰靛亜閻忥箓鏌＄仦鐔锋閻も偓闂佹寧绻傞幊宥囪姳鐠囧樊娓婚柕鍫濈箳缁嬪鏌ｉ幙鍕瘈鐎?agent_node + 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熺紒銏犳灈缁炬儳顭烽弻鐔煎箲閹邦啩?padding闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿孩顨呴妴鎺戭潩閿濆懍澹曟俊鐐€戦崹娲偡閳哄懎鏄ラ柍褜鍓氶妵鍕箳閹存繍浠鹃梺缁樻尵閸犳劙濡甸崟顖ｆ晝妞ゆ劑鍨归～鈺傜節绾版ǚ鍋撻懠顒傜厯闂佸搫鏈惄顖炲春閿熺姴纾兼繝褎鍎抽～宀€绱撻崒娆戭槮妞ゆ垵鎳樿棟闁汇垻顭堥弰銉╂煃瑜滈崜姘跺Φ閸曨垰绠抽柟瀛樼箥娴犻箖姊虹粙鍨劉闁搞劌娼″濠氬Χ閸氥倕婀遍埀顒婄秵閸嬪懘鎮甸弴鐘电＝濞达絽鎼牎闂佽崵鍟块弲鐘差嚕鐠囨祴妲堥柕蹇曞Х椤斿﹪姊虹憴鍕姢妞ゆ洦鍙冨畷娆撴晸閻樻枼鎷烘繛鏉戝悑閻熝呯矓閻㈠憡鐓曢柟鎹愭硾閺嬪孩銇勯弴顏嗙М妞ゃ垺娲熸俊鍫曞磼濮橆偄顥氭繝鐢靛仦閸ㄥ爼顢旀导鏉戠娴ｅ秹宕堕宥嗏枌婵犳鍠栭敃銈夆€﹀畡鎵殾闁圭儤鍩堝鈺呮煟閹惧啿顒㈡い鏂跨Ч濮?*/
  fitAgentView: (boardW: number, boardH: number) => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  connections: [],
  viewport: { x: -1800, y: -1000, scale: 1 },
  selected: new Set(),
  theme: 'light',
  undoStack: [],
  clipboard: [],
  assetPanelOpen: false,
  composerOpen: false,
  apiConfig: savedApiConfig,
  projectId: null,
  taskAssets: [],
  cascadeRunning: false,
  cascadeRunPath: [],
  cascadeNodeStatus: new Map(),
  nodeOverrides: {},

  addNode: (node) =>
    set((s) => ({ nodes: [...s.nodes, node] })),

  removeNodes: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const toDelete = new Set<string>();
      const collect = (id: string) => {
        if (toDelete.has(id)) return;
        toDelete.add(id);
        const n = s.nodes.find((x) => x.id === id);
        if (n && (n.type === 'group' || n.type === 'promptGroup')) {
          (n.items || []).forEach(collect);
        }
      };
      ids.forEach(collect);
      return {
        nodes: s.nodes.filter((n) => !toDelete.has(n.id)),
        connections: s.connections.filter(
          (c) => !toDelete.has(c.from) && !toDelete.has(c.to)
        ),
        selected: new Set([...s.selected].filter((id) => !toDelete.has(id))),
      };
    }),

  updateNode: (id, updates) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),

  moveNode: (id, x, y) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    })),

  resizeNode: (id, w, h) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, w, h } : n)),
    })),

  addConnection: (from, to) =>
    set((s) => {
      if (!from || !to || from === to || s.connections.some((connection) => connection.from === from && connection.to === to)) {
        return s;
      }
      return { connections: [...s.connections, { id: uid('c'), from, to }] };
    }),

  removeConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
    })),

  setViewport: (viewport) => set({ viewport }),

  setTheme: (theme) => set({ theme }),

  select: (ids, additive = false) =>
    set(() => ({
      selected: additive
        ? new Set([...get().selected, ...ids])
        : new Set(ids),
    })),

  clearSelection: () => set({ selected: new Set() }),

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),

  pushUndo: () =>
    set((s) => {
      const state: UndoState = {
        nodes: JSON.parse(JSON.stringify(s.nodes)),
        connections: JSON.parse(JSON.stringify(s.connections)),
      };
      const stack = [...s.undoStack, state];
      if (stack.length > UNDO_MAX) stack.shift();
      return { undoStack: stack };
    }),

  performUndo: () =>
    set((s) => {
      if (!s.undoStack.length) return s;
      const state = s.undoStack[s.undoStack.length - 1];
      return {
        nodes: state.nodes,
        connections: state.connections,
        selected: new Set(),
        undoStack: s.undoStack.slice(0, -1),
      };
    }),

  copySelected: () =>
    set((s) => {
      const toCopy = [...s.selected]
        .map((id) => s.nodes.find((n) => n.id === id))
        .filter(Boolean) as CanvasNode[];
      return { clipboard: JSON.parse(JSON.stringify(toCopy)) };
    }),

  pasteNodes: (point) =>
    set((s) => {
      if (!s.clipboard.length) return s;
      const xs = s.clipboard.map((n) => n.x);
      const ys = s.clipboard.map((n) => n.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const dx = point.x - cx;
      const dy = point.y - cy;
      const idMap = new Map<string, string>();
      const copies = s.clipboard.map((n) => {
        const copy = JSON.parse(JSON.stringify(n));
        copy.id = uid(n.type);
        copy.x = n.x + dx;
        copy.y = n.y + dy;
        copy.running = false;
        idMap.set(n.id, copy.id);
        return copy;
      });
      copies.forEach((c) => {
        if ((c.type === 'group' || c.type === 'promptGroup') && c.items) {
          c.items = c.items.map((id: string) => idMap.get(id) || id);
        }
      });
      const newSelected = new Set(copies.map((c) => c.id));
      return {
        nodes: [...s.nodes, ...copies],
        selected: newSelected,
      };
    }),

  groupSelectedNodes: () =>
    set((s) => {
      const targets = [...s.selected]
        .map((id) => s.nodes.find((n) => n.id === id))
        .filter((n): n is CanvasNode => !!n);
      if (targets.length < 2) return s;
      const xs = targets.map((n) => n.x);
      const ys = targets.map((n) => n.y);
      const ws = targets.map((n) => n.w);
      const hs = targets.map((n) => n.h || 220);
      const boxX = Math.min(...xs);
      const boxY = Math.min(...ys);
      const boxW = Math.max(...xs.map((x, i) => x + ws[i])) - boxX;
      const boxH = Math.max(...ys.map((y, i) => y + hs[i])) - boxY;
      const group: CanvasNode = {
        id: uid('grp'),
        type: 'group',
        x: boxX - 24,
        y: boxY - 40,
        w: boxW + 48,
        h: boxH + 64,
        items: targets.map((n) => n.id),
      };
      return {
        nodes: [...s.nodes, group],
        selected: new Set([group.id]),
      };
    }),

  toggleAssetPanel: () =>
    set((s) => ({ assetPanelOpen: !s.assetPanelOpen })),

  toggleComposer: () =>
    set((s) => ({ composerOpen: !s.composerOpen })),

  setApiConfig: (config) =>
    set({ apiConfig: config }),

  setTaskAssets: (assets) =>
    set({ taskAssets: assets }),

  startCascadeRun: (path) =>
    set(() => {
      const statusMap = new Map<string, 'queued' | 'running' | 'done' | 'failed'>();
      path.forEach((id) => statusMap.set(id, 'queued'));
      return { cascadeRunning: true, cascadeRunPath: path, cascadeNodeStatus: statusMap };
    }),

  updateCascadeNodeStatus: (nodeId, status) =>
    set((s) => {
      const newMap = new Map(s.cascadeNodeStatus);
      newMap.set(nodeId, status);
      return { cascadeNodeStatus: newMap };
    }),

  stopCascadeRun: () =>
    set({ cascadeRunning: false, cascadeRunPath: [], cascadeNodeStatus: new Map() }),

  runVideoGeneration: async (nodeId, params) => {
    const t = getT();
    const { prompt, providerId, modelId, inputImageUrls, aspectRatio, duration } = params;
    const cfg = get().apiConfig;
    const provider = cfg.providers.find(p => p.id === providerId);
    if (!provider) {
      get().updateNode(nodeId, { runError: 'optimizing prompt' });
      return;
    }
    // modelId 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍌氫壕婵ê宕崢瀵糕偓瑙勬礉椤顭囪箛娑辨晝闁靛繆鍓濋澶愭⒒閸屾艾鈧兘鎮為敃鍌氱畺闁割偅娲栫粈澶屸偓鍏夊亾闁告洖鐏氶弲鐐烘⒑閸涘﹦鈯曟繛鍏肩懅缁寮介鐔哄幐闂佹悶鍎弲娑溾叴闂備胶顭堥鍡涘箰閹间礁鐓″璺号堥弸搴繆椤栨繂鍚归柡鍡╁幗娣囧﹪鎮欓鍕ㄥ亾閺嶎厼鍨傞柟鎯板Г閸婂潡鏌ㄩ弬鍨挃闁活厽鐟ラ…璺ㄦ崉閻戞ɑ鎷遍柣搴㈢濮樸劑骞夊宀€鐤€闁哄洨濮烽悞濂告⒑閸涘﹥澶勯柛銊╀憾閹€斥槈濮楀棛鍞甸柣鐘荤細濞咃絾鏅堕弴銏＄厱闁哄倽顕ч崝锕傛煛?Provider.videoModels闂?
    const modelName = modelId;
    if (!modelName) {
      get().updateNode(nodeId, { runError: 'optimizing prompt' });
      return;
    }

    // 婵?Provider 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顐㈢亰閻庡厜鍋撻柛鏇ㄥ亜閻濇ê顪冮妶鍡楃瑨闁哥噥鍋婂鎶芥倷閻戞ǚ鎷绘繛杈剧秬椤宕戦悩缁樼厱闁哄倽娉曢悞鍛娿亜閵忥紕澧电€规洏鍔戝鍫曞箣閻樺灚姣囬梻鍌欑閹碱偄煤閵忋倕鍨傜憸鐗堝笒缁€鍕煟濡偐甯涢柣鎾存礋閺岋繝宕堕妷銉ヮ瀳婵炲瓨绮庨崑鐔烘?ModelConfig
    const model: ModelConfig = {
      id: modelName,
      providerId: provider.id,
      modelName,
      displayName: modelName,
      apiPath: '/video/generations',
      apiFormat: 'openai-video',
      customHeaders: '',
      customBodyTemplate: '',
      customResponsePath: '',
      pollApiPath: '',
      enabled: true,
    };

    try {
      const optimizedPrompt = await optimizeCanvasMediaPrompt(cfg, prompt);
      get().updateNode(nodeId, { _assetSourcePrompt: prompt, _assetPrompt: optimizedPrompt });
      const videoUrl = await generateSoraVideo(
        optimizedPrompt,
        'cinematic',
        'zh',
        provider,
        model,
        inputImageUrls,
        (status) => {
          get().updateNode(nodeId, { runError: status });
        }
      );

      get().updateNode(nodeId, {
        url: videoUrl,
        mediaKind: 'video',
        runStatus: 'done',
        running: false,
      });
    } catch (e: any) {
      get().updateNode(nodeId, {
        runStatus: 'failed',
        running: false,
        runError: e?.message || 'optimizing prompt',
      });
    }
  },

  runPipeline: async (nodeId, params) => {
    const t = getT();
    const cfg = get().apiConfig;
    const pipelineNode = get().nodes.find(n => n.id === nodeId);
    if (!pipelineNode) return;

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當缂佺姾娅ｇ槐鎾存媴妤︽寧顎楅梺鎼炲妼閻栫厧顕ｆ繝姘櫢闁绘灏欓敍婊冣攽閻樿宸ラ柛鐘冲哺瀵娊顢橀悩鐢碉紳婵炶揪缍侀ˉ鎾剁驳韫囨洜纾奸柣妯哄暱閻忔挳鏌ㄥ┑鍫濅粶闁宠鍨垮畷鐓庮潩椤戝灝顥氶梻浣圭湽閸ㄦ椽顢欓弽顓熷€块柣鎰靛墰缁犻箖鏌涢鐘茬仼闁宠鐗撻弻锛勪沪鐠囨祴鍋撳┑鍡欐殾妞ゆ劧绠戠粈瀣亜閹邦喖鏋庡ù婊勫劤閳规垿鎮╃€圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滄晥闂備胶顭堥鍡涘礉濞嗘挸钃熼柕鍫濐槸娴肩娀鏌曟径妯烘灍婵絽鐭傚?
    const updatePipeline = (updates: Partial<CanvasNode>) => get().updateNode(nodeId, updates);

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當缂佺姵妞藉娲箰鎼达絺妲堝銈忓閺佸骞?
    const log = (msg: string) => {
      const node = get().nodes.find(n => n.id === nodeId);
      const prevLog = (node?._pipelineLog as string[]) || [];
      updatePipeline({ _pipelineLog: [...prevLog, msg] });
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當閻庢冻绲介埞鎴︻敊绾柉鍚紓浣哄У閻楃姴顕ｆ繝姘櫖闁告洦浜濋崟鍐煟閻樺弶澶勭憸鏉垮暞閹便劑寮撮悙鈺傛杸闂佺偨鍎遍崯璺ㄧ棯瑜旈弻鐔碱敊閻撳簶鍋撻幖浣瑰仼闁绘垼妫勫敮闂佸啿鎼崐鐟扳枍閸ヮ剚鈷戦梺顐ゅ仜閼活垱鏅剁€电硶鍋撶憴鍕闁荤啿鏅犲顐﹀箻缂佹ê浜归梺鑲┾拡閸撱劎妲愭潏銊х瘈闁汇垽娼у瓭闂佹寧娲忛崐妤呭焵椤掍焦鐨戦柛蹇斆悾?
    const isStopped = () => {
      const controller = pipelineAbortControllers.get(nodeId);
      return !controller || controller.signal.aborted;
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當缂佺姴顭峰娲箹閻愭彃顬堥梺闈涚墛閹倿鐛崘顏呭枂闁告洦鍓欓鎾绘⒑閸涘﹦绠撻悗姘卞厴瀵娊顢橀悜鍡樺瘜闂侀潧鐗嗗Λ妤冪箔瑜旈弻娑氣偓锝庡墮娴犻亶鏌曢崱妤€鏆ｅ┑锛勫厴閸┾剝鎷呴崟鎾虫处閻撴洘绻涢幋婵嗚埞闁诲繆鍓濈换娑㈠醇椤愩垺鐝濆┑?
    const markStepDone = (step: string) => {
      const node = get().nodes.find(n => n.id === nodeId);
      const completed = (node?._pipelineCompletedSteps as string[]) || [];
      if (!completed.includes(step)) {
        updatePipeline({ _pipelineCompletedSteps: [...completed, step] });
      }
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當閻庢冻绲介埞鎴︻敊绾柉鍚紓浣哄У閻楃姴顕ｆ繝姘櫖闁告洦浜濋崟鍐煟閻樺弶澶勭憸鏉垮暞閹便劑寮撮悜鍡樺瘜闂侀潧鐗嗗Λ妤冪箔瑜旈弻娑氣偓锝庡墮娴犻亶鏌曢崱妤€鏆ｅ┑锛勫厴閸┾剝鎷呴崟鎾虫处閻撴洟鏌嶉埡浣告灓闁绘帗妞介弻銊╁即閻愭祴鍋撹ぐ鎺撳亗闁哄洨鍠愰崣蹇斾繆椤栨碍鎯堥柍閿嬫閺岋綁鏁愭径澶嬪枤闂佸搫鏈惄顖炵嵁鐎ｎ噮鏁嶆繝濠傛嫅缁辩敻姊绘笟鈧埀顒傚仜閼活垱鏅舵导瀛樼厵闁惧浚鍋呭畷宀€鈧鍠氶弫濠氥€佸Δ鍛妞ゆ劑鍨婚埀顒夊幖閳规垿顢欑粵瀣姼闂佺硶鏅滈悧鐘差嚕閺屻儺鏁嗛柛鏇ㄥ墰閸樺崬顪冮妶鍡楀闁稿﹥娲熷鎼佸箣閿旂晫鍘介梺鐟版惈缁夊爼鎯屽▎鎾寸厸鐎光偓鐎ｎ剛袦濡ょ姷鍋涘ú顓€佸Δ浣瑰闁伙絽鐭堥弨銊╂⒒閸屾瑧鍔嶉柣顏勭秺瀹曠銇愰幒鍡忓亾閿曞倹鍊婚柣锝呰嫰缁侊箓鎮楅獮鍨姎闁绘绮岃灒濞达絽澹婂〒濠氭煏閸繂鏆欓柣蹇ｄ邯閺屾盯濡搁妷锕€浠撮悗?
    const isStepDone = (step: string) => {
      const completed = (pipelineNode._pipelineCompletedSteps as string[]) || [];
      return completed.includes(step);
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當妞ゎ偀鏅犲铏规嫚閺屻儳宕紓浣介哺濞茬喖宕洪埀顒併亜閹烘垵鈧憡绂掗鐐寸厱濠电姴鍟扮粻妯肩磼鏉堛劍灏い顐ｇ箖濞煎繘鍩￠崘顏勫Ъ濠碉紕鍋戦崐鏍礉瑜忓濠囧锤濡炲皷鍋撻崨瀛樺殤妞ゆ帊绀侀弸鎴︽椤愩垺澶勬繛鍙夌墵瀹曠懓鈹戦崼姘壕妤犵偛鐏濋崝姘亜閿斿灝宓嗙€规洟娼ч鍏煎緞鐎ｎ剙骞堥梺璇茬箳閸嬫稒鏅舵禒瀣剹濠电姴浼呰ぐ鎺撳亼闁逞屽墴瀹曞綊鏌嗗鍐ｅ亾閸愵喖唯闁冲搫鍊搁埀顒傚厴閺屸剝寰勭€ｎ亞浠存繝娈垮枛閹芥粎妲愰幘瀛樺闁惧繒鎳撶粭锟犳⒑閹肩偛濡奸柣蹇旂箞閹箖鎮滈挊澶愬敹闂佸搫娲ㄩ崰搴ㄥ焵椤掑倸鍘撮柡宀嬬秮婵偓闁靛繆鍓濆В鍕⒑?ID
    const createAssetGroup = (kind: string, label: string, offsetX: number) => {
      const groupNode = createNode('group', {
        x: pipelineNode.x + pipelineNode.w + 60 + offsetX,
        y: pipelineNode.y,
      }, {
        title: label,
        items: [],
        _assetKind: kind,
        _groupId: 'root',
      });
      get().addNode(groupNode);
      return groupNode.id;
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當妞ゎ偒浜缁樼節鎼粹€斥拻闂佸憡鎸荤粙鎾澄ｉ幇鏉跨閻庢稒锚椤庢挾绱撴担鍓插剱妞ゆ垶鐟︾粋鎺撶附閸涘ň鎷洪梺鍛婄缚閸庤鲸绂掗敂鐣岀闁稿繗鍋愰幊鍡欐喐妫颁胶绐旈柡宀嬬秮閹晠宕ｆ径濠庢П闁荤喐绮嶅姗€宕幘顔芥櫜闁绘劗鍎ら弲鎻掝熆鐠轰警鍎忓ù鐙€鍨堕幃宄邦煥閸愵€倝鏌嶈閸撴岸宕欑憴鍕洸婵犻潧顑冮埀顒€鍟存俊鐑藉煛娴ｅ搫鈧偛顪冮妶鍡楃瑐缂佲偓娴ｇ硶鏋旈柣鏂垮悑閳锋垹绱掔€ｎ偄顕滄繝鈧幍顔剧＜妞ゆ柨鍚嬪﹢鎵磼閸屾稑娴い銏＄洴閹瑧鈧數顭堝铏節閻㈤潧浠﹂柛銊ョ埣閳ワ箓宕堕妸锔界彿闂佸搫鍟崐鑽ゅ閸忛棿绻嗛柕鍫濆€告禍鎯ь渻閵堝繘妾繝銏★耿閳ワ箓宕堕妸褏鐦堝┑顔斤供閸樺ジ鍩€椤掑倸鍘存慨濠傤煼瀹曞ジ鎮㈢悰鈥愁潓闂備焦鐪归崐鏇灻洪鐑嗘綎婵炲樊浜滅粻浼村箹鏉堝墽宀涙俊鎻掔墕椤啴濡惰箛鎾舵В闂佹悶鍔岄悥濂哥嵁婵犲洦鍋勯柛蹇曞帶娴滄粓姊虹紒妯诲碍婵﹫绠掗·鍌炴⒒娴ｇ瓔鍤欑紒缁樺浮瀹曟垿鎮㈤崗鍏煎劒闁瑰吋鐣崝宀€绮堟径鎰厱闁哄洢鍔岄悘锟犳煟?taskAssets
    const addAssetNodeToGroup = (
      groupId: string,
      url: string,
      title: string,
      kind: string,
      index: number,
      metadata?: { prompt?: string; providerId?: string; providerName?: string; modelId?: string }
    ) => {
      const group = get().nodes.find(n => n.id === groupId);
      if (!group) return;
      const col = index % 3;
      const row = Math.floor(index / 3);
      const assetNode = createNode('image', {
        x: group.x + 24 + col * 290,
        y: group.y + 40 + row * 200,
      }, {
        url,
        title,
        mediaKind: 'image',
        _assetKind: kind,
        _groupId: groupId,
        _assetPrompt: metadata?.prompt,
        _assetProviderId: metadata?.providerId,
        _assetProviderName: metadata?.providerName,
        _assetModelId: metadata?.modelId,
      });
      get().addNode(assetNode);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢埛姘そ婵¤埖寰勭€ｎ亙妲愰梻渚€娼ц墝闁哄懏鐩幏鎴︽偄鐏忎焦鏂€闂佺粯蓱瑜板啴顢旈銈囨／闁诡垎浣镐划闂佸搫鏈惄顖氼嚕閹绢喖惟闁靛鍎抽鎴︽⒒?items 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢幊宀勫焵椤掆偓閸燁垰顕ラ崟顖氱疀妞ゆ垟鏂傞崕鐢稿蓟濞戙垹绠涢梻鍫熺⊕閻忓牆鈹戦敍鍕粧缂侇喗鐟╅獮鍐潨閳ь剟骞冨▎鎴炲磯闁烩晜甯楅幐缁樼┍婵犲伅鍦偓锝庝簷婢规洟姊?
      const updatedGroup = get().nodes.find(n => n.id === groupId);
      if (updatedGroup) {
        const items = [...(updatedGroup.items || []), assetNode.id];
        const itemCount = items.length;
        const cols = Math.min(itemCount, 3);
        const rows = Math.ceil(itemCount / 3);
        get().updateNode(groupId, {
          items,
          w: Math.max(280, 24 + cols * 290 + 24),
          h: 40 + rows * 200 + 24,
        });
      }
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻鐔稿閺夋垳鍠婇梺杞扮閿曨亪寮诲鍫闂佸憡鎸鹃崰鏍嵁閸愵亝鍏滈柛婊€鐒︿簺闂備浇顕х€涒晠宕欑憴鍕洸婵犻潧顑冮埀顒€鍟存俊鐑藉煛娴ｅ搫鈧偤姊洪棃娑辩叚缂佺姵鍨垮畷婵嬪川鐎涙ǚ鎷洪柣鐔哥懃鐎氼剟宕濋妶鍥ｅ亾濞堝灝鏋︽繛澶嬬洴閸┿垹顓兼径瀣汗缂傚倷鐒﹂…鍥储閹间焦鍊垫鐐茬仢閸旀岸鏌熼搹顐㈠缂侇喚绮€佃偐鈧稒顭囬崢浠嬫⒑闂堟稓澧曢柟鍐查叄椤㈡棃顢橀悩顐壕婵炲牆鐏濆▍姗€鏌涢敐蹇曠М妤犵偛锕ら…銊╁醇濠靛棛鈧厼顪冮妶鍡楀闁哥姵鍔欓幃姗€宕橀鍡欙紳闂佺鏈悷銊╊敊婢舵劖鐓曢悗锝庡亝瀹曞矂鏌″畝瀣埌妞ゎ偅绻堥、妤佸緞婵犲喚鍟€缂傚倸鍊风拋鏌ュ磻?
      const tagMap: Record<string, string> = {
        character: 'assetTagCharacter',
        prop: 'assetTagProp',
        scene: 'assetTagBackground',
        storyboard: 'assetTagStoryboard',
      };
      const tagKey = tagMap[kind] || '';
      const tagLabel = tagKey ? t(tagKey) : kind;
      const assetRef: TaskAssetRef = {
        id: assetNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url,
        tags: [tagLabel],
        prompt: metadata?.prompt,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
      };
      // 闂?setTaskAssets 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢埛姘そ閺佸倿鏌ㄩ姘缂備焦顨嗙粙鎴﹀疮娴兼潙姹查柨鏇炲€归悡鏇熺箾閸℃绂嬫俊鑼劋閵囧嫰鍩￠崘銊ュ箣闂佸搫鏈ú妯侯嚗閸曨垰骞㈡俊顖濆吹瑜板啰绱撻崒姘偓鎼佸磹閹间絸鍥偨缁嬭儻鎽曞┑鐐村灦缁酣鎮块埀顒勬⒑閻熸澘鈷旂紒杈╁枛婵偓閹鸿櫕绂嶅鍫熺厪闁割偅绻冮崳褰掓煛閸☆厾绉柡宀嬬磿娴狅箓鎮惧畝鈧崝顔剧磽娴ｅ搫校闁烩晩鍨堕悰顔碱潨閳ь剟骞栬ぐ鎺濇晝闁挎繂娲﹁缂?
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕闂佺硶鍓濈粙鎺楁偂濞戞﹩鐔嗛悹杞拌閸庡繑銇勯弴鐔虹煉闁哄本绋掔换婵嬪礋椤掍焦鐦庣紓?
      void syncAssetCreate(assetRef, get().projectId || undefined);
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮剻閻旂儤瀚氶柟缁樺俯濞间粙姊绘担鍛婃喐闁稿绋掗弲鑸垫償閵娿儳鐤呴梺褰掓？閻掞箓宕戠€ｎ喗鐓曟い鎰╁€曢弸鏃堟煥濞戞瑧銆掔紒杈ㄦ尰閹峰懐鎲撮崟顓炲汲闂備礁顓介弶鍨瀷缂備緡鍠楅悷锕€顕ラ崟顖氱疀闁割煈鍋呭▍鍡涙⒒娴ｅ憡鍟炴繛鎻掔Ч瀵彃鈻庨幘宕囬獓濡炪倖鎸堕崹娲偂閻斿吋鐓熸俊顖氭惈閺嗗崬鈹戦鐓庘偓鍧楀蓟濞戞瑦鍎熼柍銉ㄦ珪濮ｆ劙姊哄畷鍥╁笡闁圭懓娲悰顔锯偓锝庡枟閸嬫劙鏌涢幇顖氱毢婵絽娲缁樻媴閸涘﹤鏆堝┑鐐额嚋闂勫嫮绮嬪澶樻晜闁割偆鍠庢禒鎺楁⒑閻熸澘鈷旂紒顕呭灦閹繝濡烽敂鍓ь啎闂佺懓顕崕鎰版倿閽樺鐔嗙憸搴☆潖閼姐倖顫曢柟鐑樻⒒绾惧吋淇婇姘儓闁圭晫鏁诲铏规嫚閳ヨ櫕鐏嶉梺绋垮婵炲﹪宕洪姀鈩冨劅闁靛鍎抽悿鈧俊鐐€栫敮鎺楀磹閹间礁鐒垫い鎺嶇缁椦呯磼鏉堛劍灏伴柟宄版嚇楠炴捇骞掑鍜佹濠电姴鐥夐弶搴撳亾瑜忕划濠氬箳閹存梹鐏冮梺鍝勬川閸?+ 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲闁稿绻濋弻鏇熺箾閻愵剚鐝﹂梺杞扮椤戝寮婚弴銏犻唶婵犻潧娴傚Λ銈夋⒑瀹曞洦鍤€缂佸缍婂璇差吋婢跺﹦鍘告繛杈剧到閹测€斥枔閵娧呯＝濞达絼绮欓崫娲煟濡ゅ啫鈻堢€殿喖顭锋俊鎼佸Ψ閵忊槅娼旀繝娈垮枟椤ㄥ懎螞濞嗘搩鏁侀柛鈩冪懅绾捐棄霉閿濆嫮鐭欓柛婵婃缁辨帞鎷犻懠顒€鈪甸梺璇″枙閸楁娊銆佸▎鎾村€锋い鎺嗗亾缁剧虎鍨跺铏圭磼濡櫣浠稿銈庡幖閻楁挸鐣烽妷鈺婃晝闁挎棁袙閹峰搫鈹戦鐐殌婵炲眰鍊濋幃妯绘綇閵婏絼绨婚梺鍝勬搐濡骞婇幇鏉跨婵鍩栭埛鎴︽煕椤垵娅橀柛搴㈠灴閺屽秶绱掑Ο鑽ゅ弳闂佸疇顫夐崹鍧楀箖閳哄懎绠甸柟鍝勬娴滈箖鏌涘┑鍕姢闁绘粎绮穱濠囧Χ閸屾矮澹曢梻鍌氭搐椤︾敻寮婚妸銉㈡斀闁糕剝锚濞呇囨倵濞戞瑧绠炴慨濠傛惈鐓ら悹鍥紦缁ㄨ崵绱撴担鍓叉Ц濠⒀冮叄瀹?
    const addFailedAssetNodeToGroup = (
      groupId: string,
      title: string,
      kind: string,
      index: number,
      errorMsg: string,
      metadata?: { prompt?: string; providerId?: string; providerName?: string; modelId?: string }
    ) => {
      const group = get().nodes.find(n => n.id === groupId);
      if (!group) return;
      const col = index % 3;
      const row = Math.floor(index / 3);
      // 婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁€濠囨煃瑜滈崜姘辨崲濞戞瑥绶為悗锝庡亞椤︿即鎮楀▓鍨珮闁稿锕ユ穱濠囧醇閺囩偟鍊為梺鍐叉惈閸熶即宕㈤鐐粹拻濞达絽鎲￠崯鐐烘煕閺冣偓椤洦绂嶇粙搴撴瀻闁规崘娅曟潏?ID 婵犵數濮烽弫鎼佸磻閻愬搫绠板┑鐘崇閸ゅ苯螖閿濆懎鏆欏鍛攽閳藉棗鐏ュ鐟扮墛閹便劑鎼归鐘辩盎闂佸湱鍎ら崹鐢割敂閳哄懏鍋℃繛鍡樼懅閻ｅ灚顨ラ悙瀵稿婵炵厧绻樺畷婊嗩槼闁稿瑪鍥ㄢ拺閺夌偞澹嗙粣鏃傜磼閻樺磭澧い顐㈢箰鐓ゆい蹇撳椤斿矂姊洪崷顓炲妺闁哄鍓熸俊鐑藉煛閸屾粌骞楅梻浣瑰濡線顢氳閹﹢鏁傞柨顖氫壕婵炲牆鐏濆▍姗€鏌涢敐蹇曠М妤犵偛锕ら…銊╁醇閻曚焦顥堟繝鐢靛仦閸ㄥ墎鍠婂澶婄厺?id 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢埛姘そ閺佸倿鏌ㄩ姘缂備焦顨嗙粙鎴﹀疮娴兼潙姹?
      const failedNodeId = uid('fail');
      const assetNode = createNode('image', {
        x: group.x + 24 + col * 290,
        y: group.y + 40 + row * 200,
      }, {
        title,
        mediaKind: 'image',
        _assetKind: kind,
        _groupId: groupId,
        _assetFailed: true,
        _assetError: errorMsg,
        _assetPrompt: metadata?.prompt,
        _assetProviderId: metadata?.providerId,
        _assetProviderName: metadata?.providerName,
        _assetModelId: metadata?.modelId,
      });
      assetNode.id = failedNodeId;
      get().addNode(assetNode);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢埛姘そ婵¤埖寰勭€ｎ亙妲愰梻渚€娼ц墝闁哄懏鐩幏鎴︽偄鐏忎焦鏂€闂佺粯蓱瑜板啴顢旈銈囨／闁诡垎浣镐划闂佸搫鏈惄顖氼嚕閹绢喖惟闁靛鍎抽鎴︽⒒?items 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢幊宀勫焵椤掆偓閸燁垰顕ラ崟顖氱疀妞ゆ垟鏂傞崕鐢稿蓟濞戙垹绠涢梻鍫熺⊕閻忓牆鈹戦敍鍕粧缂侇喗鐟╅獮鍐潨閳ь剟骞冨▎鎴炲磯闁烩晜甯楅幐缁樼┍婵犲伅鍦偓锝庝簷婢规洟姊?
      const updatedGroup = get().nodes.find(n => n.id === groupId);
      if (updatedGroup) {
        const items = [...(updatedGroup.items || []), assetNode.id];
        const itemCount = items.length;
        const cols = Math.min(itemCount, 3);
        const rows = Math.ceil(itemCount / 3);
        get().updateNode(groupId, {
          items,
          w: Math.max(280, 24 + cols * 290 + 24),
          h: 40 + rows * 200 + 24,
        });
      }
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻娑樷槈閸楃偟浠悗瑙勬礀瀵爼骞堥妸銉庣喖宕归鎯у缚闂備胶顭堥鍌炲疾濠婂懏宕叉繛鎴欏灩楠炪垺淇婇姘儓妞ゎ偄鐬肩槐鎾存媴閻熸壆绁峰┑鐘亾閺夊牃鏅滈～鏇㈡煙閻戞﹩娈旈柣鎺戠仛閵囧嫰骞掑澶嬵€栭梺绋款儏閿曨亪骞冭ぐ鎺戠畳闁圭儤鍨甸‖澶愭偠?+ 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲闁稿绻濋弻鏇熺箾閻愵剚鐝﹂梺杞扮椤戝寮婚弴銏犻唶婵犲灚鍔栨晥闂?
      const tagMap: Record<string, string> = {
        character: 'assetTagCharacter',
        prop: 'assetTagProp',
        scene: 'assetTagBackground',
        storyboard: 'assetTagStoryboard',
      };
      const tagKey = tagMap[kind] || '';
      const tagLabel = tagKey ? t(tagKey) : kind;
      const assetRef: TaskAssetRef = {
        id: assetNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url: '',
        tags: [tagLabel, t('canvasPanelAssetTagFailed')],
        prompt: metadata?.prompt,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
        failed: true,
        error: errorMsg,
      };
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕闂佺硶鍓濈粙鎺楁偂濞戞﹩鐔嗛悹杞拌閸庡繑銇勯弴鐔虹煉闁哄本绋掔换婵嬪礋椤掍焦鐦庣紓?
      void syncAssetCreate(assetRef, get().projectId || undefined);
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當妞ゎ偀鏅犲铏规嫚閺屻儳宕紓浣介哺濞茬喖宕洪埀顒併亜閹烘垵鈧憡绂掗鐐寸厱濠电姴鍠氬▓婊呪偓瑙勬礃濞茬喐淇婇懜闈涚窞濠电姴鍊稿▓銈夋⒒娴ｅ憡鍟為柛鏃撶畵瀹曚即寮介鐔蜂壕婵﹩鍓﹀Σ褰掓煏閸パ冾伃妤犵偞甯￠獮瀣攽閸ヮ煈鍟€闂傚倷绶氬褔鎮у鍫濈；闁告洦鍨辩粻鎺撶節閻㈤潧顫掗柛娑卞帨閵忊€茬箚妞ゆ劧缍嗗▓娆撴煟韫囨柨濮嶆慨濠勭帛閹峰懘鎼归悷鎵偧闂備礁鎲″褰掋€冮崨鏉戠厺鐎广儱顦～鍛存煏韫囧﹥顫婃繛鑲╁枎閳规垿鎮欓崣澶樻！闂佹悶鍔嶆繛濠囧箖閻愬绡€闁搞儮鏅涜ぐ鍕⒑閹肩偛鍔橀柛鏂跨焸瀹曠敻顢楅崟顒傚幈?闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝箖濞差亜惟鐟滃秹寮搁崼鈶╁亾楠炲灝鍔氶柟閿嬪灴閹虫捇宕稿Δ浣哄幍濠电偛鐗嗛悘婵嬪几閵堝拋娓婚柣鐔告緲閺嗚鲸銇勯鐐村仴闁硅櫕绮撻幃浠嬫倷閸忓浜鹃柟鐑樻⒒绾惧ジ鏌嶈閸撶喎鐣烽崡鐑嗘建闁糕剝锕╅崯宥夋⒒娴ｈ櫣甯涢柛鏃€锕㈠畷娲冀椤愶絽鍘规俊銈忕到閸燁垶鎮″▎鎰╀簻闁哄啫娲よ闁诲繐娴氶崢浠嬪Φ閸曨垼鏁冮柣妯垮皺娴煎牊绻濈喊澶岀？闁稿繑蓱娣囧﹪鎮滈挊澹┿劎鎲稿鍥ㄦ殰?taskAssets
    const addTextAssetNode = (text: string, title: string, kind: string, offsetX: number, metadata?: { providerId?: string; providerName?: string; modelId?: string }) => {
      // kind 婵?novel/script 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顔姐亜閺嶃劎鍟查柤鏉挎健閹嘲鈻庤箛鎿冧紑缂備胶濞€缁犳牠寮诲☉銏犖ㄦい鏃傚帶椤亪姊虹粙娆惧剭闁告梹鍨垮濠氬即閻旇櫣顔曢梺鍓茬厛閸犳帡宕戦幘婢勬棃宕ㄩ闂寸敾闂備礁鍟块幖顐﹀箠韫囨稒鍋傞柣鏃€鎮舵禍婊勩亜閹伴潧浜滃褜鍠栭埞鎴︻敊閻熼澹曞┑鐘垫暩婵兘銆傞挊澹╋綁宕ㄩ弶鎴犵厬闂佸憡鍔﹂崰鏍不閺嶃劎绠鹃柛鈩兩戠亸顓㈡煙绾懎鐓愰柕鍥у楠炴﹢顢涘☉杈ㄧ秹婵犵數鍋熼崢褔鎮ラ悡搴綎?
      const nodeType: 'novel' | 'script' | 'prompt' = kind === 'novel' ? 'novel' : kind === 'script' ? 'script' : 'prompt';
      const textNode = createNode(nodeType, {
        x: pipelineNode.x + pipelineNode.w + 60 + offsetX,
        y: pipelineNode.y,
      }, {
        text,
        title,
        _assetKind: kind,
        _groupId: 'root',
        _assetProviderId: metadata?.providerId,
        _assetProviderName: metadata?.providerName,
        _assetModelId: metadata?.modelId,
      });
      get().addNode(textNode);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熼悜姗嗘畷闁搞倕鑻灃闁挎繂鎳庨弸銈夋煛娴ｅ壊鍎愰柕鍥у瀵噣宕掑☉娆戝涧婵＄偑鍊愰弲婊堟偂閿熺姷宓侀柡宥庣仈鎼搭煈鏁嗛柍褜鍓熼幃姗€顢旈崼鐔哄幗闁瑰吋鎯岄崰鏍р枍瀹ュ鐓涚€光偓鐎ｎ剛鐦堥悗瑙勬礀閵堟悂銆侀弴銏狀潊闁绘﹩鍋呯€氱喓绱撻崒姘偓宄邦渻閹烘梹顐介柨鐔哄Т绾惧鏌涘☉鍗炵仯闁活厼顦遍埀顒€绠嶉崕閬嶆偋濠婂喚鐎舵い蹇撴绾捐棄霉閿濆嫮鐭欓柛婵囨そ閺屾盯骞嬮悩鑼簼l 闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呮繄鍒掑▎鎾崇婵＄偛鐨烽崑鎾诲礃椤旂厧鑰垮┑鐐村灱妞存悂寮查埡鍛€甸柛蹇擃槸娴滈箖姊洪崨濠冨闁告挻鐟︾粋?data URL 闂傚倷娴囧畷鐢稿窗閹邦喖鍨濋煫鍥ㄧ☉閺勩儵鏌涢妷顔煎闁搞劌鍊块弻娑㈡晜鐠囨彃绠哄銈庡亝濞茬喖寮婚妸銉㈡婵☆垯璀︽禒閬嶆⒑缁嬫鍎愰柟鍛婃倐閸┿儲寰勬繛鐐€哄銈嗘寙閸岀偛浠愰柣?
      // 婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁躲倝鏌﹀Ο鐚寸礆婵炴垯鍨圭猾宥夋煕鐏炲墽鈽夋い蹇旀倐濮婅櫣绱掑Ο鑽ゅ弳闂佺濮ょ划鎾诲Υ閸涙潙钃熼柕澶涘閸橀亶姊洪弬銉︽珔闁哥喍鍗抽崺锝夊Ψ瑜忕壕浠嬫煕鐏炴儳鍤俊顖楀亾闂備礁鎼張顒傜矙閺嶎偆涓嶆繛鎴欏灩缁犺崵绱撻崒姘辨槀闁搞劏娅ｉ幑銏犫攽鐎ｎ亞鍔﹀銈嗗笒鐎氱兘寮崒鐐寸厱婵炴垵宕悘锝夋煙閾忣偆绠為柟顔煎槻椤劑宕橀鐓庡強闂備浇顕栭崰鎾诲磿閻㈡悶鈧礁顫濈捄铏瑰姦濡炪倖宸婚崑鎾淬亜閺囶亞绋婚悗闈涖偢瀵爼骞嬮悪鈧Σ鍫曟煟閻斿摜鐭婃い鎴濇缁骞掗幋鏃€顫嶉梺闈涢獜缁辨洟宕㈤柆宥嗏拺闂傚牊渚楀Σ鍫曟煕鎼淬劋鎲鹃柛鈺傜洴瀵剙鈻庨崜褍鏁搁柣鐔哥矊闁帮綁骞冭閹晝鎷犻崣澶屸偓顒勬倵楠炲灝鍔氭繛鑼█瀹曟垿骞樼拠鍙夊祶濡炪倖鎸鹃崰搴ㄥ礉閸嶇 婵?novel/script 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顔姐亜閺嶃劎鍟查柤鏉挎健閺屾盯鏁傜拠鎻掔濡炪値鍋呭ú鐔煎蓟閻斿皝鏋旈柛顭戝枟閻忓秹姊虹粙娆惧剱闁绘顨婃俊鐢稿礋椤栨氨鐤€闂侀潧顭堥崕閬嶅煕婢跺ň鏀介柣鎰级閸ｈ棄鈹戦悙鈺佷壕闂備礁鎼径鍥焵椤掍礁澧柛姘儔閺屾稑鈽夐崡鐐典化濡炪倖鏌ㄩ敃銉ф崲濠靛顫呴柨婵嗗缂嶅牓鏌ｉ姀鈺佺仭閻㈩垽绻濆畷娲閵堝懐顔掗柣搴ㄦ涧閹芥粓鎯侀崼銉︹拺闁告稑锕ゆ慨锕傛煕濞嗗繘顎楅悡銈嗐亜閹烘垵顏柍?
      const assetRef: TaskAssetRef = {
        id: textNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url: '', // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧壕鍦磼鐎ｎ偓绱╂繛宸簼閺呮繈鏌嶈閸撶喖寮崘顔碱潊闁靛牆鎳愰鐓庮渻閵堝棙顥嗘俊顐㈠閹啴顢曢敂瑙ｆ嫼闂佸憡绋戦敃銉﹀緞閸曨個鐟邦煥鎼存繈鍋楅梺?url 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犳彃霉閿濆洨銆婇柡瀣Ч閺屻劌鈹戦崱鈺傂﹂梺?
        tags: [kind === 'novel' ? t('assetTagNovel') : t('assetTagScript')],
        prompt: text,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
      };
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撴担鎻掍壕闂佺硶鍓濈粙鎺楁偂濞戞﹩鐔嗛悹杞拌閸庡繑銇勯弴鐔虹煉闁哄本绋掔换婵嬪礋椤掍焦鐦庣紓?
      void syncAssetCreate(assetRef, get().projectId || undefined);
      return textNode.id;
    };

    // 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺绯曞墲缁嬫垹绮婚悩璇茬婵烇綆鍓欓悘顏堟煕濞嗗繒绠查柕鍥у缁犳盯骞樼捄渚澑闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當缂佺姴顭峰娲濞戞艾鈷婃繝纰樷偓铏枠闁糕斁鍋撳銈嗗笂缁讹繝宕箛娑欑厱闁绘ê纾晶閬嶆煙楠炲灝鐏叉鐐差儏椤灝鈹戦崶銊ｄ虎閻庤娲滈…鍫ｇ亙闂侀€炲苯澧摶鐐存叏濡炶浜鹃梺鍝勭焿缁插€熺亙闂侀€炲苯澧撮柟顔ㄥ嫮绡€闁搞儯鍔岄埀顒€鐏氶妵鍕即濡も偓娴滈箖姊洪崫鍕効缂佺粯绻傞悾閿嬬附閸撳弶鏅濋梺闈涚箳婵參骞忛妶鍥╃＝闁稿本鐟﹂ˇ椋庣磼鐠佸湱绡€鐎规洘鍨垮畷銊╊敍濠婂懐鍔归柣搴＄畭閸庨亶鎮у鍐剧€舵い蹇撴绾捐棄霉閿濆嫮鐭欓柛婵囨そ閺岋綁鎮ら崒姘兼喘缂備緡鍠栭澶愮嵁閹烘嚦鏃堝焵椤掆偓椤斿繐鈹戦崶銉ょ盎闂佽宕樺▔娑㈠几濞嗘挻鐓曟慨妯煎帶娴滅増鎱ㄦ繝鍌涙儓閺佸牓鏌涢妷鎴濇噸缁辨洟姊绘担鍛婃喐濠殿喚鏁诲畷婵嗏枎韫囨洘娈鹃梺鑽ゅ枛閸嬪﹤顭囬埡鍌樹簻闁规崘娉涜ⅴ闂佸搫顑嗛悧鏇⑩€旈崘顔嘉ч柛鈩兠弳妤呮⒑缁嬪灝顒㈤柛鏃€鐟ラ锝夋嚋閻㈢數鐦堝┑顔斤供閸樻悂骞忓ú顏呪拺闁革富鍘剧敮娑㈡偨椤栨粌浠х紒顔碱煼瀹曪絾寰勫畝鈧鏇㈡⒑閸︻厾甯涢悽顖涱殜瀹曟垿濡疯閸嬫挸鈻撻崹顔界彯闂佸憡鎸鹃崰鏍嵁閸愵収妯勯悗瑙勬礀閵堟悂骞冮姀銏″仒闁炽儱鍘栨竟鏇烆渻閵堝棙纾甸柛瀣崌閺屸€崇暆鐎ｎ剛鐦堥悗瑙勬礀閵堟悂銆侀弴銏狀潊闁绘瑢鍋撴繛鐓庮煼濮婄粯鎷呴崨濠冨枑闂佺顑嗛惄顖炪€佸棰濇晣闁靛繒濮烽崝锕€顪冮妶鍡楀潑闁稿鎸荤换婵嬪焵椤掑嫬纭€闁绘劏鏅滈悗娲⒑闂堟稓绠為柛銊︽そ閿?
    const updateTextAssetContent = (assetId: string, text: string, generating: boolean) => {
      const current = get().taskAssets;
      const updated = current.map(a =>
        a.id === assetId ? { ...a, prompt: text, generating } : a
      );
      get().setTaskAssets(updated);
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗崱妞惧婵＄偑鍊ゆ禍婊堝疮閺夋垹鏆﹂柟鐑橆殕閸婄兘鏌熺紒妯虹瑨缂佷緡鍣ｅ铏规嫚閹绘帩鍔夌紓浣割儐鐢喖骞楅锔解拺缂備焦蓱鐏忋劑鏌涚€ｎ偅宕屾慨濠勭帛閹峰懘宕烽鐔诲即闂備焦鎮堕崝宀勫Χ閹间降鈧礁顫濋幇浣剐紓鍌欑贰閸犳帡寮查悩璇茬畺婵犲﹤鐗婇崵宥夋煏婢跺牆鍔滈柣銈呮嚇濮婄粯鎷呮笟顖滃姼闂佸搫鐗滈崜娑㈠礆閹烘柧娌柛鎾楀本绁?text
      get().updateNode(assetId, { text });
    };

    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢崯浼存儗濞嗘挻鐓欓悗鐢殿焾鍟哥紒?AbortController
    const abortController = new AbortController();
    pipelineAbortControllers.set(nodeId, abortController);
    const signal = abortController.signal;

    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佹悶鍎洪崜娆戝瑜版帗鐓涚€广儱楠搁獮鏍煢閸愵亜鏋涢柡灞剧洴婵＄兘顢欓悡搴交闂備礁鎲￠悷銉╂晝閵夆晛桅闁告洦鍨伴崘鈧梺闈浤涚仦鐐啇闂傚倷鑳堕…鍫燁殽閹间焦鏅濋柕鍫濐槸閻撯€愁熆閼搁潧濮囩紒鐘差煼閹嘲鈻庤箛鎿冧紝婵炲濮弲鐘差潖閸濆嫅褔宕惰娴犵厧顪冮妶搴″箻闁稿繑锕㈤幃浼搭敊绾板崬鎮戦梺鍓插亽閸嬪懘鍩㈡径瀣╃箚?
    const isResume = !!(pipelineNode._pipelineStopped && pipelineNode._pipelineParams);
    const resumeParams = isResume ? pipelineNode._pipelineParams! : params;
    const { inputText, sourceType, style, language } = resumeParams;

    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢崯顖氱暦閺屻儲鐓曠€光偓閳ь剟宕曢幋鐘电闁哄稁鍘介悡娆撴煟濡も偓閻楀﹦娆㈤懠顒傜＜闁?
    get().updateNode(nodeId, { runError: 'optimizing prompt' });
    updatePipeline({
      running: true,
      runStatus: 'running',
      _pipelineStopped: false,
      _pipelineParams: resumeParams,
      ...(isResume ? {} : {
        _pipelineProgress: 0,
        _pipelineStep: t('canvasPipelineStepInit'),
        _pipelineLog: [isResume ? t('canvasPipelineLogResume') : t('canvasPipelineLogStart')],
      }),
    });

    try {
      // ===== Step 1: PREPROCESSING =====
      if (!isStepDone('preprocessing')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepPreprocess'), _pipelineProgress: 5 });
        log(sourceType === 'idea' ? t('canvasPipelineLogIdeaExpand') : t('canvasPipelineLogNovelProcess'));

        let processedText = inputText;
        if (sourceType === 'idea') {
          const llmProvider = getProviderForStep(cfg, 'preprocessing');
          const llmModel = getModelForStep(cfg, 'preprocessing');
          if (!llmProvider || !llmModel) throw new Error(t('canvasPipelineNoPreprocessProvider'));

          // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鎻掔€梻鍌氱墛閸忔艾鈽夊Ο婊勬瀹曘儵鎸婃径瀣灎濡炪們鍨洪〃濠傜暦閹烘垟鏋庨柟瀛樼箓閳锋洟姊婚崒姘肩叕闁稿瀚叅闁挎洖鍊哥粈鍕喐閻楀牆绗掗柛姘愁潐缁绘盯骞嬪▎蹇曚痪闂佺顑戠徊鍧楀箟缁嬫鍚嬮柛銉到娴滅偓鎱ㄥ鈧Λ璺ㄨ姳閸忕浜滈柕濠忕到閸旓妇鈧娲栭悥濂搞€佸Δ浣瑰闁告稑锕﹂弸鈧梻鍌氬€烽懗鍫曗€﹂崼銉ュ珘妞ゆ帒鍊搁崹婵嬫倶閻愭彃鈷旀い鈺呮敱閵囧嫰寮介顫勃闂佺粯鎸堕崕鑼崲濞戙垹绠ｉ柣鎴濇閸旈攱绻濋埛鈧崟顒傤槰缂備胶绮换鍫ュ春閳ь剚銇勯幒鎴濐伌闁轰礁鍊块弻娑㈩敃閵堝懏鐎绘繛瀵稿У濡炶棄顫忛搹鍦＜婵☆垳鍎甸幏璇差渻閵堝骸骞栭柣妤佹崌楠炲啫顫滈埀顒€鐣烽幆閭︽Х濠碘剝褰冮悧鎾诲蓟閻旂厧鍨傛い鏂垮悑濞堫厼螖閻橀潧浠﹂柣妤冨█瀵鈽夊Ο婊呭枛閹筹繝濡堕崱妤€鐏￠梺璇叉唉椤煤濮椻偓閹虫繃銈ｉ崘銊у弨婵犮垼娉涜癌闁绘柨鍚嬮崵鍐煃鏉炴壆璐版俊鏌ヤ憾濮婂宕掑▎鎴М闂佺顕滅换婵嬪Υ閸愵喖閱囬柣鏃傤焾瀵潡鎮楃憴鍕婵炲眰鍔庣划鍫熺節閸ャ劎鍘卞┑鐐村灦椤洭骞楅悩缁樼厱闁靛牆鎳愭晥闂佸搫鏈粙鎾寸閿曞倸绀堢憸蹇涙偂閳ь剙鈹戦悙宸殶濠殿垼鍙冨畷褰掑醇閺囩偠鎽?
          const novelNodeId = addTextAssetNode('', t('canvasPipelineAssetNovel'), 'novel', 0, {
            providerId: llmProvider.id,
            providerName: llmProvider.name,
            modelId: llmModel.modelName,
          });
          processedText = '';
          for await (const chunk of expandIdeaToStory(llmProvider, llmModel, inputText, language, signal)) {
            processedText += chunk;
            updatePipeline({ _pipelinePreview: processedText.slice(-200) });
            // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鏃傚劋瀹曞弶绻濋棃娑氬ⅱ闁活厼妫楅湁闁挎繂娲ら崝瀣亜椤愶絾绀嬮柡灞诲姂閹垽宕崟鎴欏灲閹嘲鈻庡▎鎴犳殼闂佽鍠楅敃銏ゅ箖濞嗘劖濯撮柛鎰ㄦ櫓閳ь剚顨婂娲川婵犲啰鍙嗛柣搴㈢煯閸楀啿顕ｇ拠娴嬫闁靛繒濮烽濠囨⒑閸︻厼浜鹃柛鎾村哺閸┾偓妞ゆ帊鑳堕惌宀€绱掓潏銊ョ瑲缂佹鍠栧畷鎯邦槺缂併劏鍋愮槐鎾存媴缁嬪簱鍋撻崫銉х煋闁绘垵澹欓崶顒佸殤妞ゆ帒鍊婚敍?
            updateTextAssetContent(novelNodeId, processedText, true);
          }
          // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸搫顦伴崵姘洪鍕幐闂佸憡绮堥悞锕傚疾閳哄懏鈷戦柟鑲╁仜閸旀挳鏌涢幘鏉戝摵鐎规洘鍨挎俊鎼佸煛閸屾粌骞楅梻浣告惈閸燁偊宕戦崱娑欏€垮Δ锝呭暞閻撶喖鐓崶銊﹀鞍闁哥姵锕㈤弻鐔碱敊缁涘鐤侀梺璇″枤閸忔﹢骞冭瀹曞ジ鎮㈢粙娆句紗闂?
          updateTextAssetContent(novelNodeId, processedText, false);
        } else {
          // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩顐熷亾閿曞倸鐐婃い鎺嗗亾缂佹劖顨婇獮鏍箹椤撶姴甯ㄧ紓鍌氱У閻楃娀寮婚悢鍏肩劷闁挎洍鍋撻柡瀣懇閺岋綁骞掗幋顖濆惈闂佺粯鎼╅崑濠傜暦閸洖惟闁靛鍎查惁鎾绘⒒娴ｈ鍋犻柛濠冪墵閹嫰顢涢悙鑼舵憰闂佹寧绻傞ˇ顖炴偂濞戞◤褰掓晲閸パ冨闂佽褰冮妶鎼佸蓟閿濆顫呴柍杞拌兌娴狀參姊洪崷顓х劸闁哥喎娼￠幃鎯х暋閹锋梹妫冨畷銊╊敇閸ャ儱濮傞柡灞炬礃缁旂喖顢涘顒変紑濠电偛鐗勯崐婵嗩潖缂佹ɑ濯撮柣鐔煎亰閸ゅ绱撴担鍓插剱闁搞劌娼￠獮鍐樁缂佺姵绋戦埥澶娾枎韫囧孩鍩涘┑鐘垫暩閸嬬偤宕归鐐插瀭闁革富鍘介崗婊堟煃瑜滈崜鐔奉潖濞差亜宸濆┑鐘插€搁～鎴︽煟韫囨挾绠查柣鐔叉櫅椤曪綁宕樺顔藉兊闂佺厧鎽滈弫鎼佸储閻㈠憡鐓熼幖娣灮閳洟鏌ㄥ顑芥斀妞ゆ柣鍔岄幊鎰?
          processedText = inputText;
          addTextAssetNode(processedText, t('canvasPipelineAssetNovel'), 'novel', 0);
        }
        log(t('canvasPipelineLogTextDone').replace('{0}', String(processedText.length)));
        updatePipeline({ _pipelineProgress: 15, _pipelineProcessedText: processedText });
        markStepDone('preprocessing');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepPreprocess')));
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 2: SCRIPT_GENERATION =====
      let scriptResult: any = null;
      if (!isStepDone('scriptGeneration')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepScript'), _pipelineProgress: 20 });
        log(t('canvasPipelineLogScript'));

        const scriptProvider = getProviderForStep(cfg, 'scriptGeneration');
        const scriptModel = getModelForStep(cfg, 'scriptGeneration');
        if (!scriptProvider || !scriptModel) throw new Error(t('canvasPipelineNoScriptProvider'));

        // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鎻掔€梻鍌氱墛閸忔艾鈽夊Ο婊勬瀹曘儵鎸婃径瀣灎濡炪們鍨洪〃濠傜暦閻旂⒈鏁嗛柍褜鍓欓埢鎾澄旈埀顒勫煘閹达富鏁婇柡鍌樺€撶欢鐢告⒑閸涘⊕鑲╁垝濞嗘挾宓侀煫鍥ㄧ⊕閻掕偐鈧箍鍎卞Λ妤佺椤栫偞鍋℃繝濠傚暟鑲栭梺閫炲苯澧柛鎴ｎ潐缁傚秴鈹戠€ｃ劉鍋撻崘顔嘉ㄩ柍杞拌兌閸婄偛顪冮妶鍡楃瑐缂佲偓娴ｇ硶鏋旈柣鏂垮悑閳锋垹绱掔€ｎ偄顕滄繝鈧幍顔剧＜妞ゆ柨鍚嬪﹢鎵磼閸屾稑娴い銏＄洴閹瑧鈧數顭堝铏節閻㈤潧浠﹂柛銊ョ埣閳ワ箓宕堕妸锔界彿闂佸搫娲ㄩ崰鎾跺姬閳ь剟姊洪柅鐐茶嫰婢у瓨銇勯姀鈩冾棃鐎规洖銈搁幃銏ゆ憥閸屾粎澶勯梻鍌氬€烽懗鍓佸垝椤栨凹娼栧┑鐘冲焹閳ь剨绠撳畷濂稿Ψ閿曗偓閳ь剙鐖奸弻娑㈠Ψ閹存柨浜惧┑鈩冨絻閻楁捇寮婚悢鐓庡瀭妞ゆ柨鍚嬪▓顓炍旈悩闈涗沪闁绘濞€瀵鈽夊Ο婊呭枛閹筹繝濡堕崱妤€鐏￠梺璇叉唉椤煤濮椻偓閹虫繃銈ｉ崘銊у弨婵犮垼娉涜癌闁绘柨鍚嬮崵鍐煃鏉炴壆璐版俊鏌ヤ憾濮婂宕掑▎鎴М闂佺顕滅换婵嬪Υ閸愵喖閱囬柣鏃傤焾瀵潡鎮楃憴鍕婵炲眰鍔庣划鍫熺節閸ャ劎鍘卞┑鐐村灦椤洭骞楅悩缁樼厱闁靛牆鎳愭晥闂佸搫鏈粙鎾寸閿曞倸绀堢憸蹇涙偂閳ь剙鈹戦悙宸殶濠殿垼鍙冨畷褰掑醇閺囩偠鎽?
        const scriptNodeId = addTextAssetNode('', t('canvasPipelineAssetScript'), 'script', 320, {
          providerId: scriptProvider.id,
          providerName: scriptProvider.name,
          modelId: scriptModel.modelName,
        });
        let accumulatedText = '';
        for await (const partial of generateScriptFromNovel(scriptProvider, scriptModel, pipelineNode._pipelineProcessedText || inputText, style, language, signal)) {
          scriptResult = partial;
          const charCount = partial.characters?.length || 0;
          const shotCount = partial.bigShots?.length || 0;
          updatePipeline({
            _pipelinePreview: t('canvasPipelinePreviewScript').replace('{0}', String(charCount)).replace('{1}', String(shotCount)),
          });
          // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鏃傚劋瀹曞弶绻濋棃娑氬ⅱ闁活厼妫楅湁闁挎繂娲ら崝瀣亜椤愶絾绀嬮柡灞诲姂閹垽宕崟鎴欏灲閹嘲鈻庡▎鎴犳殼闂佽鍠楅敃銏ゅ箖濞嗘劖濯撮柛鎰ㄦ櫓閳ь剚顨婂娲川婵犲啰鍙嗛柣搴㈢煯閸楀啿顕ｇ拠娴嬫闁靛繒濮烽濠囨⒑閸︻厼浜鹃柛鎾村哺閸┾偓妞ゆ帊鑳堕惌宀€绱掓潏銊ョ瑲缂佹鍠栧畷鎯邦槺缂併劏鍋愮槐鎾存媴缁嬪簱鍋撻崫銉х煋闁绘垵澹欓崶顒佸殤妞ゆ帒鍊婚敍?
          const partialText = JSON.stringify(partial, null, 2);
          if (partialText !== accumulatedText) {
            accumulatedText = partialText;
            updateTextAssetContent(scriptNodeId, partialText, true);
          }
        }
        // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸搫顦伴崵姘洪鍕幐闂佸憡绮堥悞锕傚疾閳哄懏鈷戦柟鑲╁仜閸旀挳鏌涢幘鏉戝摵鐎规洜鏁诲畷鍫曞Ω閿曗偓瀵灝鈹戦绛嬫當婵☆偅顨婇悰顔嘉旈崨顔惧幍闂佺粯鍨堕崹婵嬪箟妤ｅ啯鐓涚€光偓鐎ｎ剛袦婵犳鍠掗崑鎾绘⒑闂堟稓绠冲┑顔炬暬閹銈ｉ崘鈹炬嫼闂佺鍋愰崑娑欎繆閼恒儲鍙忔俊顖滎焾婵倿鏌涢埞鎯т壕婵＄偑鍊栫敮鎺楀磹瑜版帒鍚归柍褜鍓熷娲传閸曨厼鈷堥梺鍛婃尵閸犲酣鎮?
        updateTextAssetContent(scriptNodeId, JSON.stringify(scriptResult, null, 2), false);

        const characters: any[] = scriptResult?.characters || [];
        const props: any[] = scriptResult?.props || [];
        const fromScriptElements = ((scriptResult?.script || []).filter((s: any) => s.sceneAsset).map((s: any) => s.sceneAsset)) as any[];
        const fromBigShots = (() => {
          const seen = new Set<string>();
          const result: any[] = [];
          for (const shot of (scriptResult?.bigShots || [])) {
            const sa = shot?.sceneAsset;
            if (sa && !seen.has(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50))) {
              seen.add(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50));
              result.push(sa);
            }
          }
          return result;
        })();
        const sceneAssets: any[] = (Array.isArray(scriptResult?.sceneAssets) && scriptResult.sceneAssets.length > 0)
          ? scriptResult.sceneAssets
          : (fromScriptElements.length > 0 ? fromScriptElements : fromBigShots);
        const bigShots: any[] = scriptResult?.bigShots || [];
        const visualSignature = scriptResult?.visualSignature;

        log(t('canvasPipelineLogScriptDone').replace('{0}', String(characters.length)).replace('{1}', String(props.length)).replace('{2}', String(sceneAssets.length)).replace('{3}', String(bigShots.length)));
        updatePipeline({
          _pipelineProgress: 40,
          _pipelineScriptResult: scriptResult,
        });
        markStepDone('scriptGeneration');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepScript')));
        scriptResult = pipelineNode._pipelineScriptResult;
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      const characters: any[] = scriptResult?.characters || [];
      const props: any[] = scriptResult?.props || [];
      const fromScriptElements2 = ((scriptResult?.script || []).filter((s: any) => s.sceneAsset).map((s: any) => s.sceneAsset)) as any[];
      const fromBigShots2 = (() => {
        const seen = new Set<string>();
        const result: any[] = [];
        for (const shot of (scriptResult?.bigShots || [])) {
          const sa = shot?.sceneAsset;
          if (sa && !seen.has(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50))) {
            seen.add(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50));
            result.push(sa);
          }
        }
        return result;
      })();
      const sceneAssets: any[] = (Array.isArray(scriptResult?.sceneAssets) && scriptResult.sceneAssets.length > 0)
        ? scriptResult.sceneAssets
        : (fromScriptElements2.length > 0 ? fromScriptElements2 : fromBigShots2);
      const bigShots: any[] = scriptResult?.bigShots || [];
      const visualSignature = scriptResult?.visualSignature;

      // ===== Step 3: CHARACTER_DESIGN =====
      if (!isStepDone('characterDesign')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepCharacter'), _pipelineProgress: 45 });
        log(t('canvasPipelineLogCharGen').replace('{0}', String(characters.length)));

        const charProvider = getProviderForStep(cfg, 'characterDesign');
        const charModel = getModelForStep(cfg, 'characterDesign');
        if (charProvider && charModel && characters.length > 0) {
          // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢崯浼存儗濞嗘挻鐓欓悗鐢殿焾鍟哥紒鎯у綖缁瑩寮婚悢鐓庣闁归偊鍓涢崢顐︽⒑閸濄儱孝婵☆偅绻堝濠氭偄閸忕厧鈧粯淇婇婵嗗惞妞わ负鍎遍—鍐Χ閸愩劌濮庣紓浣虹帛閿曘垽鐛崘顏呭厹闁告粈鐒︿簺闂備浇顕х€涒晠宕欑憴鍕洸婵犻潧顑冮埀顒€鍟存俊鐑藉煛娴ｅ搫鈧偤姊洪崘鍙夋儓闁哥喍鍗抽弫?
          const groupId = createAssetGroup('character', t('canvasPipelineAssetGroupCharacter'), 640);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < characters.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = characters.slice(i, i + BATCH);
            await Promise.all(batch.map(async (char) => {
              try {
                const prompt = char.visualFeatures || char.description || char.name || '';
                const imgUrl = await generateCharacterDesign(char, style, language, charProvider, charModel, signal);
                addAssetNodeToGroup(groupId, imgUrl, char.name || t('canvasPipelineDefaultCharName'), 'character', assetIdx++, {
                  prompt,
                  providerId: charProvider.id,
                  providerName: charProvider.name,
                  modelId: charModel.modelName,
                });
                log(t('canvasPipelineLogCharDone').replace('{0}', char.name || t('canvasPipelineDefaultUnnamed')));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = char.visualFeatures || char.description || char.name || '';
                addFailedAssetNodeToGroup(groupId, char.name || t('canvasPipelineDefaultCharName'), 'character', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: charProvider.id,
                  providerName: charProvider.name,
                  modelId: charModel.modelName,
                });
                log(t('canvasPipelineLogCharFail').replace('{0}', char.name).replace('{1}', e.message));
              }
            }));
          }
        } else {
          log(t('canvasPipelineNoCharProvider'));
        }
        updatePipeline({ _pipelineProgress: 60 });
        markStepDone('characterDesign');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepCharacter')));
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 4: PROP_DESIGN =====
      if (!isStepDone('propDesign') && props.length > 0) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepProp'), _pipelineProgress: 62 });
        log(t('canvasPipelineLogPropGen').replace('{0}', String(props.length)));

        const propProvider = getProviderForStep(cfg, 'characterDesign');
        const propModel = getModelForStep(cfg, 'characterDesign');
        if (propProvider && propModel) {
          const groupId = createAssetGroup('prop', t('canvasPipelineAssetGroupProp'), 960);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < props.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = props.slice(i, i + BATCH);
            await Promise.all(batch.map(async (prop) => {
              try {
                const prompt = prop.prompt || prop.name || 'prop';
                const imgUrl = await generatePropImage(prompt, propProvider, propModel, signal);
                addAssetNodeToGroup(groupId, imgUrl, prop.name || t('canvasPipelineDefaultPropName'), 'prop', assetIdx++, {
                  prompt,
                  providerId: propProvider.id,
                  providerName: propProvider.name,
                  modelId: propModel.modelName,
                });
                log(t('canvasPipelineLogPropDone').replace('{0}', prop.name || t('canvasPipelineDefaultUnnamed')));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = prop.prompt || prop.name || 'prop';
                addFailedAssetNodeToGroup(groupId, prop.name || t('canvasPipelineDefaultPropName'), 'prop', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: propProvider.id,
                  providerName: propProvider.name,
                  modelId: propModel.modelName,
                });
                log(t('canvasPipelineLogPropFail').replace('{0}', prop.name).replace('{1}', e.message));
              }
            }));
          }
        }
        markStepDone('propDesign');
      } else if (!isStepDone('propDesign')) {
        markStepDone('propDesign');
      } else if (props.length > 0) {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepProp')));
      }
      updatePipeline({ _pipelineProgress: 68 });

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 5: SCENE_DESIGN =====
      if (!isStepDone('sceneDesign') && sceneAssets.length > 0) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepScene'), _pipelineProgress: 70 });
        log(t('canvasPipelineLogSceneGen').replace('{0}', String(sceneAssets.length)));

        const sceneProvider = getProviderForStep(cfg, 'storyboarding');
        const sceneModel = getModelForStep(cfg, 'storyboarding');
        if (sceneProvider && sceneModel) {
          const groupId = createAssetGroup('scene', t('canvasPipelineAssetGroupScene'), 1280);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < sceneAssets.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = sceneAssets.slice(i, i + BATCH);
            await Promise.all(batch.map(async (scene) => {
              try {
                const prompt = scene.prompt || scene.mainStructure || 'scene';
                const imgUrl = await generatePropImage(prompt, sceneProvider, sceneModel, signal);
                addAssetNodeToGroup(groupId, imgUrl, scene.mainStructure || t('canvasPipelineDefaultSceneName'), 'scene', assetIdx++, {
                  prompt,
                  providerId: sceneProvider.id,
                  providerName: sceneProvider.name,
                  modelId: sceneModel.modelName,
                });
                log(t('canvasPipelineLogSceneDone').replace('{0}', scene.mainStructure || t('canvasPipelineDefaultUnnamed')));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = scene.prompt || scene.mainStructure || 'scene';
                addFailedAssetNodeToGroup(groupId, scene.mainStructure || t('canvasPipelineDefaultSceneName'), 'scene', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: sceneProvider.id,
                  providerName: sceneProvider.name,
                  modelId: sceneModel.modelName,
                });
                log(t('canvasPipelineLogSceneFail').replace('{0}', scene.mainStructure).replace('{1}', e.message));
              }
            }));
          }
        }
        markStepDone('sceneDesign');
      } else if (!isStepDone('sceneDesign')) {
        markStepDone('sceneDesign');
      } else if (sceneAssets.length > 0) {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepScene')));
      }
      updatePipeline({ _pipelineProgress: 75 });

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 6: STORYBOARDING =====
      if (!isStepDone('storyboarding')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepStoryboard'), _pipelineProgress: 78 });
        log(t('canvasPipelineLogShotGen').replace('{0}', String(bigShots.length)));

        const shotProvider = getProviderForStep(cfg, 'storyboarding');
        const shotModel = getModelForStep(cfg, 'storyboarding');
        if (shotProvider && shotModel && bigShots.length > 0) {
          const groupId = createAssetGroup('storyboard', t('canvasPipelineAssetGroupStoryboard'), 1600);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < bigShots.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = bigShots.slice(i, i + BATCH);
            await Promise.all(batch.map(async (shot) => {
              try {
                const involvedChars = characters.filter(c =>
                  shot.charactersInvolved?.some((name: string) => name.toLowerCase().includes(c.name?.toLowerCase()))
                );
                const context = involvedChars.map((c: any) => `${c.name}: ${c.visualFeatures}`).join('; ');
                const refImages = involvedChars.map((c: any) => c.threeViewImg).filter(Boolean) as string[];
                const prompt = shot.storyboardPrompt || shot.description || '';
                const img = await generateStoryboardImage(
                  prompt, style, language, context, refImages, shotProvider, shotModel, signal
                );
                addAssetNodeToGroup(groupId, img, `${t('canvasPipelineDefaultShotName')} ${shot.id || assetIdx}`, 'storyboard', assetIdx++, {
                  prompt,
                  providerId: shotProvider.id,
                  providerName: shotProvider.name,
                  modelId: shotModel.modelName,
                });
                log(t('canvasPipelineLogShotDone').replace('{0}', String(shot.id || assetIdx)));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = shot.storyboardPrompt || shot.description || '';
                addFailedAssetNodeToGroup(groupId, `${t('canvasPipelineDefaultShotName')} ${shot.id || assetIdx}`, 'storyboard', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: shotProvider.id,
                  providerName: shotProvider.name,
                  modelId: shotModel.modelName,
                });
                log(t('canvasPipelineLogShotFail').replace('{0}', String(shot.id)).replace('{1}', e.message));
              }
            }));
          }
        }
        updatePipeline({ _pipelineProgress: 90 });
        markStepDone('storyboarding');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepStoryboard')));
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 7: PROMPT_OPTIMIZATION =====
      if (!isStepDone('promptOptimization')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepPromptOpt'), _pipelineProgress: 92 });
        log(t('canvasPipelineLogPromptOpt'));

        const optProvider = getProviderForStep(cfg, 'promptOptimization');
        const optModel = getModelForStep(cfg, 'promptOptimization');
        if (optProvider && optModel && bigShots.length > 0) {
          const BATCH = 5;
          for (let i = 0; i < bigShots.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = bigShots.slice(i, i + BATCH);
            await Promise.all(batch.map(async (shot) => {
              try {
                const originalPrompt = shot.soraPromptOriginal || shot.soraPrompt || 'Scene';
                let optimized = '';
                for await (const chunk of optimizeSoraPrompt(optProvider, optModel, originalPrompt, style, language, visualSignature, signal)) {
                  optimized += chunk;
                }
                shot.soraPrompt = optimized;
                shot.soraPromptOptimized = optimized;
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                log(t('canvasPipelineLogPromptOptFail').replace('{0}', String(shot.id)));
              }
            }));
          }
          log(t('canvasPipelineLogPromptOptDone'));
        }
        markStepDone('promptOptimization');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepPromptOpt')));
      }

      // ===== 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勭粻鐘绘煙閹规劦鍤欓悗姘槹閵囧嫰骞掗幋婵愪患闂?=====
      pipelineAbortControllers.delete(nodeId);
      updatePipeline({
        running: false,
        runStatus: 'done',
        _pipelineProgress: 100,
        _pipelineStep: t('canvasPipelineStepDone'),
        _pipelineStopped: false,
        _pipelineLog: [...((get().nodes.find(n => n.id === nodeId)?._pipelineLog as string[]) || []), t('canvasPipelineLogAllDone')],
      });
    } catch (e: any) {
      pipelineAbortControllers.delete(nodeId);
      const currentLog = (get().nodes.find(n => n.id === nodeId)?._pipelineLog as string[]) || [];

      if (e.name === 'AbortError') {
        // 闂傚倸鍊搁崐鐑芥倿閿曗偓椤啴宕归鍛姺闂佺鍕垫當缂佲偓婢跺备鍋撻獮鍨姎妞わ富鍨跺浼村Ψ閿斿墽顔曢梺鐟邦嚟閸嬬喖骞婇崨瀛樼厓缂備焦蓱椤ュ牓鏌熼鑲╃Ш鐎规洖鐖兼俊鎼佸Ψ瑜忛妶鐑芥煟閻愬瓨鐨戦柛鐘崇墪椤繘鎼归崷顓犵厯濠电偛妫欓崕鎶藉礈鏉堚晝纾藉〒姘搐閺嬫稓绱掓径濠勭Ш闁?
        updatePipeline({
          running: false,
          runStatus: 'stopped',
          _pipelineStopped: true,
          _pipelineStep: t('canvasPipelineStepStopped'),
          _pipelineLog: [...currentLog, t('canvasPipelineLogStopped')],
        });
      } else {
        // 闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉甸崑锟犳煙閹増顥夋鐐灲閺屽秹宕崟顐熷亾瑜版帒绾х紒瀣氨閺€浠嬫煟濮楀棗鏋涢柣蹇ｄ邯閺屾稒鎯旈妶鍛睏闂佸憡甯楃敮鈥崇暦濠婂棭妲奸梺?
        const errorMsg = e.message || t('canvasPipelineUnknownError');
        get().updateNode(nodeId, { runError: 'optimizing prompt' });
        updatePipeline({
          running: false,
          runStatus: 'failed',
          _pipelineLog: [...currentLog, t('canvasPipelineLogError').replace('{0}', errorMsg)],
        });
      }
    }
  },

  stopPipeline: (nodeId) => {
    const controller = pipelineAbortControllers.get(nodeId);
    if (controller) {
      controller.abort();
    }
  },

  // 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊箣閿濆憛鎾绘煕?闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊閵忊晝鍔搁梺钘夊暟閸犲酣鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑缁嬫鍎嶉柛鏃€鍨垮濠氭晲婢跺﹦鐫勯梺绋胯閸婃宕濋幖浣光拺閻犲洩灏欑粻鐗堢箾瀹割喖寮€殿喛顕ч埥澶娢熷鍕拹闁瑰嘲鎳樺畷鐑筋敇閵娧冭€块梻鍌氬€搁崐椋庣矆娴ｅ壊鍤曢柛鎾茬閸ㄦ繈骞栧ǎ顒€濡肩紒鐘冲閹叉悂寮捄銊︽闂佺粯姊婚埛鍫ュ极閸岀偞鐓曟い鎰Т閻忊晝绱掗埀顒勫醇閵夛腹鎷绘繛杈剧悼閹虫捇顢氬鍛＜閻庯綆鍋勯悘鎾煙椤斻劌瀚弧鈧梺鎼炲劀閸曨厸鍋撻鈧—鍐Χ閸℃锛曢梺绋款儐閹稿銆冮妷鈺傚€烽柡澶嬪灥椤秹姊洪悷鏉挎Щ闁硅櫕锕㈤悰顕€寮介鐔封偓鐑芥煟濡も偓閻楀﹦娆㈠鑸碘拻濞达綀妫勯崥鐟扳攽椤旂偓鏆€规洘绻堥獮瀣晝閳ь剛澹曢崸妤佸€甸梻鍫熺⊕閹叉悂鏌ｉ鐐靛闁靛洤瀚伴獮鍥礈娴ｇ懓浠规俊鐐€愰弲鐐典焊濞嗘挸绠熼柟闂寸缁秹鏌涢锝囩疄婵☆偆鍏樺娲川婵犲嫮绱伴梺绋挎唉鐏忔瑩鍩€?+ 濠电姷鏁告慨鐢割敊閺嶎厼绐楁俊銈呭暞瀹曟煡鏌熼柇锕€鏋涚紒韬插€曢湁闁绘ê妯婇崕鎰版煕鐎ｎ亶妯€闁哄本鐩獮姗€鎳犻鈧俊浠嬫煟韫囨挾绠伴梺甯秮瀵鈽夐姀鐘插祮闂侀潧顭堥崐婵嬪磻濡ゅ懏鈷戠紓浣诡焽閳洟鏌熼悷鐗堟悙妞ゎ偄绻愮叅妞ゅ繐瀚宀勬⒑閸︻厼鍔嬮柡瀣靛墴閺佹劖寰勭€ｎ剙骞愰梺璇茬箳閸嬬偤寮告繝姘卞彆妞ゆ帒瀚悡娆愩亜閺冨洤鍚归柣顓熺懇閺岀喖顢欓崫鍕紕缂備緡鍠楅悷褔骞戦崟顖毼╅柕鍫濇瀹?+ 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝Υ閸愨晜鍎熼柕蹇嬪焺濞茬鈹戦悩璇у伐闁绘锕畷鎴﹀煛閸涱喚鍘介梺閫涘嵆濞佳勬櫠娴煎瓨鐓?prompt闂?
  retryFailedAsset: async (taskAssetId: string, customPrompt?: string) => {
    const t = getT();
    const cfg = get().apiConfig;
    let asset = get().taskAssets.find(a => a.id === taskAssetId);
    // 闂傚倸鍊搁崐椋庣矆娴ｈ櫣绀婂┑鐘插亞閻掔晫鎲搁幋锕€桅闁规壆澧楅崐鐑芥煟閵忋垺鏆╅柣锝堝煐缁绘繈濮€閿濆懐鍘梺鍛婃⒐濞叉粎鍒?taskAsset 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顕€鏌熼崜浣烘憘闁轰礁锕弻鐔兼焽閿曗偓閺嬬喐銇勯锝嗙缂佺粯绻堝Λ鍐ㄢ槈閸楃偛澹堥梻浣告啞閸斿繘宕戦幘缁樷拺闁煎鍊曢弸鎴︽煟閻旀潙鍔ら柍褜鍓氶崙褰掑礈濞戞艾鍨濆┑鐘叉处閺呮繈鏌涚仦鍓с€掗柛妯圭矙濮婃椽妫冨☉銏㈠椽缂傚倸绉村Λ婵嗙暦闂堟稈鏋庨柟瀵稿Х閿涙粓姊洪崫鍕殭闁稿﹥鎮傚畷銏ゅ箻椤旂晫鍘甸悗瑙勬礀濞层倖绂掓潏鈹惧亾鐟欏嫭绀冮悽顖涘浮閳ワ箓濡搁埡浣侯槰閻熸粌绉堕埀顒€鐏氳ぐ鍐煘閹达附鍊婚柛銉㈡櫅閸╁苯鈹戦悙璺虹毢濠电偐鍋撻悗瑙勬礃缁矂鍩為幋锕€鐐婄憸婊堝吹閵堝鈷戦柛娑橈功閳藉鏌ｆ幊閸旀垵鐣烽崹顐ょ瘈闁告劧缂氱花濠氭椤愩垺澶勯柟鍛婃倐椤㈡棃鍩￠崘鈺佷粡闂佺粯鏌ㄩ崥瀣煕閹达附鐓曟繛鎴烇公瀹搞儳绱掑Δ浣圭殤缂佽鲸甯為埀顒婄秵閸嬪嫰鎮橀埡鍐＜閺夊牄鍔嶅畷灞绢殽閻愭惌鐒介柍褜鍓涢弫鍝ユ兜閸洖鍑犻柡宥庡幗閳锋垿姊洪銈呬粶闁兼椿鍨遍弲鍫曨敍濠婂懐锛滈柣搴秵娴滆泛螣閳ь剙顪冮妶鍐ㄧ仾婵☆偄鍟悾宄邦潨閳ь剟鍨鹃敃鍌氱闁绘劖鍔忛弲鐘差潖缂佹ɑ濯撮柛娑橈攻閸庢捇姊洪崫銉ユ珡闁搞劏娉涢悾鐑藉即閵忊€虫異闂佸啿鎼崯浼存倿閹屾富闁靛牆妫楁慨褏绱掗幓鎺撳仴闁靛棗鎳橀幊鐘活敆娴ｅ憡鐎炬繝鐢靛█濞佳囨偋婵犲浄缍栭柡鍥╁枔缁犻箖鏌涢埄鍏╂垹浜搁鐘电＝濞达絽寮跺▍鍡涙煏閸パ冾伃鐎殿喕绮欐俊姝岊槷婵℃彃鐗撳鐑樺濞嗗繒妲ｉ梺鍝ュУ閻楃娀宕洪妷锕€绶為柟閭﹀墰椤旀帞绱撴担鍦灱妞ゎ偄顦甸妴鍌炴嚃閳哄啰锛濇繛杈剧悼椤牓鎳滆ぐ鎺撶厽闁哄诞浣镐划濡ょ姷鍋涢敃顏堝箖濞嗘挸浼犻柛鏇ㄥ弿缁卞弶绻濋悽闈浶㈤柨鏇樺€濆畷顖炲煛閸涱厾顦遍梺鍝勭▉閸樹粙鍩涢幋锔界厽闁瑰瓨姊瑰▍鍡樼箾閸涱厽鍤囬柡宀嬬稻楠炲﹪鏌涢弬鍧楀弰鐎殿噮鍋婇、姘跺焵椤掑嫮宓佹慨妞诲亾妞ゃ垺鐟╅幐濠冨緞婢跺瞼澶勯梻鍌氬€烽懗鍓佸垝椤栨凹娼栧┑鐘冲焹閳ь剨绠撳畷濂稿Ψ閿曗偓閳ь剙鐖奸弻娑㈠Ψ椤旂厧顫梺?
    if (!asset) {
      const canvasNode0 = get().nodes.find(n => n.id === taskAssetId);
      if (!canvasNode0) return;
      // 闂傚倸鍊搁崐宄懊归崶顒婄稏濠㈣泛顑囬々鎻捗归悩宸剰缂佲偓婢跺备鍋撻獮鍨姎妞わ富鍨堕幏鎴︽偄閸忚偐鍘遍梺闈涱槶閸ㄥ搫鈻嶉崱娑欏€堕煫鍥ㄦ崌閸欏嫰鏌＄仦鍓ф创鐎殿喗鎸虫俊鎼佸Χ婢跺﹣绮ｉ梻鍌欒兌缁垳绮欓幒妤€绠伴柛鎾楀嫷娼熼梺鍦劋椤ㄥ繘寮崘顔界厪濠㈣埖锚閺嬫稒绻涢崼顐㈠籍婵﹨娅ｉ幏鐘诲矗婢跺闂梻浣侯焾缁绘垿鏁冮姀鐙€鍤曟い鎰╁焺閸氬鏌涘鈧悞锕傚磽閻㈠憡鈷戦柛娑橈工婵洨鈧鍣崜娆撳煘閹寸姭鍋撻敐搴′簽闁?_assetKind 婵犵數濮烽弫鎼佸磻閻愬樊鐒芥繛鍡樻尭鐟欙箓鎮楅敐搴℃灍闁哄拋浜缁樻媴閸涘﹤鏆堥柦鍐憾閺岋綁鍩℃繝鍌滀桓閻庢鍣崑鍕敇婵傜鐐婇柨鏃囨婵即姊绘担绋挎倯濞存粈绮欏畷鏇㈡焼瀹ュ懐顦梺闈浥堥弲婊堝煕閹达附鐓曟繛鎴烇公瀹搞儳绱掑Δ浣稿摵闁哄矉缍侀幃銈夊磼濠婂懏娈奸梻浣筋嚃閸燁偊宕惰椤旀帒顪冮妶鍡橆梿闁稿鍔欓、娆愬緞婵犲孩瀵岄梺闈涚墕濡瑩鎮￠妷鈺傜厽闊洦姊荤粻姘舵煟韫囨柨濮嶆慨濠勭帛閹峰懘鎼归悷鎵偧闂備礁鎲″鐟懊洪弽顓熸櫇闁靛繆鍓濈紞鍥煃閸濆嫬鈧憡绂掕箛鎿冩富闁靛牆妫楁慨褏绱掗悩鍐茬伌鐎规洖缍婂畷鎺楁倷閺夋垟鍋撻悽鍛婄叆婵犻潧妫濋妤€霉濠婂嫮鐭掗柡灞诲€濆Λ鍐ㄢ槈濮樻瘷銊╂⒑?
      const inferredKind = (canvasNode0._assetKind as string) ||
        (canvasNode0.type === 'video' ? 'storyboard' :
         canvasNode0.type === 'image' ? 'storyboard' : 'storyboard');
      const newAsset: TaskAssetRef = {
        id: taskAssetId,
        kind: inferredKind as any,
        title: (canvasNode0.name as string) || '',
        name: (canvasNode0.name as string) || '',
        url: canvasNode0.url || '',
        prompt: (canvasNode0._assetPrompt as string) || '',
        providerId: (canvasNode0._assetProviderId as string) || undefined,
        providerName: (canvasNode0._assetProviderName as string) || undefined,
        modelId: (canvasNode0._assetModelId as string) || undefined,
        failed: false,
        error: undefined,
        generating: false,
      } as TaskAssetRef;
      // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼槷闂佸搫绋侀崢浠嬪磻閿熺姵鐓忓璺烘濞呭懘鏌?taskAssets 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢幊宀勫焵椤掆偓閸燁垰顕ラ崟顖氱疀妞ゆ垟鏂傞崕鐢稿蓟濞戙垹绠涢梻鍫熺⊕閻忔捇鎮楃憴鍕矮缂佽埖宀搁獮鍐亹閹烘挻鍎梺鑽ゅ枑濠㈡ɑ淇婂ú顏呪拺缂佸灏呮Λ姘渻鐎涙ɑ鍊愭鐐茬墦婵℃悂濡烽姀鈩冩澑闂備礁鎲″ú锕傚磻閸曨剚鍙忛幖娣妽閳锋垿鎮归崶锝傚亾閾忣偆浜舵俊鐐€戦崝宀勬偋韫囨稑绀?
      get().setTaskAssets([...get().taskAssets, newAsset]);
      void syncAssetCreate(newAsset, get().projectId || undefined);
      asset = newAsset;
    }

    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸搫顦伴崵姘洪鍕幐闂佸憡绮堥悞锕傚疾閳哄懏鈷戦柟鑲╁仜閸旀﹢鏌涢弬鍧楀弰闁糕斂鍨藉顕€鍩€椤掑倹宕叉繛鎴烇供閸熷懏銇勯弮鍥у惞闁烩晛楠搁埞鎴︽倷閸欏娅￠梺鎼炲妺缁瑩鐛崘顓滀汗闁圭儤鍨归崐鐐烘⒑闂堟侗鐓┑鈥虫喘閺佸秴鈽夐姀鈾€鎷洪梺缁樻尭濞撮攱绂掑☉銏＄厱闁靛鍎查崑銉р偓娈垮櫘閸嬪嫰顢橀崗鐓庣窞濠电姴娲﹂弳鍛存⒒娴ｄ警鏀扮€规洜鏁婚幆鍐偉閳х憖ating + 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒闂?failed闂?
    const updatedAssets = get().taskAssets.map(a =>
      a.id === taskAssetId
        ? { ...a, failed: false, error: undefined, generating: true, prompt: customPrompt ?? a.prompt }
        : a
    );
    get().setTaskAssets(updatedAssets);
    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢捇鏌ｉ悢鍝ユ嚂缂佺姵鎹囬悰顕€寮介妸锔剧Ф闂佸憡鎸嗛崨鍜冪稻缁?
    const retryingAsset = updatedAssets.find(a => a.id === taskAssetId);
    if (retryingAsset) void syncAssetUpdate(retryingAsset);

    // 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸婅埖鎱ㄥΟ鎸庣【缁炬儳娼￠弻鐔煎箚閻楀牜妫勯梺鍝勫閸庢娊鍩€椤掆偓閸樻粓宕戦幘缁樼厓鐟滄粓宕滈悢鐓庢槬闁逞屽墯閵囧嫰骞掗幋婵冨亾瑜版帒姹查柍鍝勬噺閻撴瑩鏌ц箛锝呬簼閻忓繒鏁婚弻銈吤洪鍐╁枤閻庢鍠栭…閿嬩繆閻戣姤鏅濋柍褜鍓氱粋鎺懨洪鍛幗闂佺粯锚瀵墎绮氶崸妤佸€堕煫鍥ㄦ⒒閹冲洦銇勯姀鈩冾棃妤犵偞锕㈤、娆撴偩鐏炶棄绠婚梻鍌欑閹诧紕鎹㈤崒婧惧亾濮樼厧澧撮柛鈹惧亾濡炪倖宸婚崑鎾淬亜椤撶偛妲婚柣锝囧厴楠炲鏁傞懞銉︾彸濠电姰鍨煎▔娑㈩敄閸℃せ鏋嶉柡宥庡幗閳锋垿鏌涢幘鏉戠祷濞存粍绻勭槐鎺楊敊閸忓吋宕崇紓渚囧枟濮婂鍩€椤掑嫭娑ч柟鑺ョ矌婢规洘绂掔€ｎ偆鍘遍梺褰掑亰閸樺ジ宕濋妶澶嬬厸閻庯綆鍋嗛幊鍐嚕閹扮増鐓曢柕澶嬪灥缁夌兘宕ラ鈶芥棃鎮╅棃娑楃钵缂備浇鍩栧畝鎼佸Υ娴ｇ硶妲堥柕蹇曞瑜旈弻娑㈠Ψ閵忊剝鐝﹀┑?
    const canvasNode = get().nodes.find(n => n.id === taskAssetId);

    try {
      // 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸婅埖鎱ㄥΟ鎸庣【缁炬儳娼￠弻鐔煎箚閻楀牜妫勯梺鍝勫閸庣敻骞冨鈧幃娆撳箵閹哄棙瀵栭梻浣藉吹閸犳洟锝炴径灞惧床婵炴垯鍨圭粻锝夋煟閹存繃顥犻柛鏃傚厴閺岋絾鎯旈敐鍡楁畬濡炪倧濡囬弫璇差嚕?濠电姷鏁告慨鐑姐€傞挊澹╋綁宕ㄩ弶鎴濈€銈呯箰閻楀棝鎮為崹顐犱簻闁瑰搫妫楁禍鍓х磼閸撗嗘闁告瑥鍟村畷娲焵椤掍降浜滈柟鐑樺灥閳ь剚鎮傚畷銏ゅ箻椤旂晫鍘告繛杈剧到閹芥粌鐡俊鐐€ら崑鍛崲閸儯鈧線寮撮姀鐘栄囨煕濞戝崬鏋ゅù婊呭厴濮婂宕掑▎鎺戝帯濡炪値鍘奸悧蹇涘箲閵忋倕绠涢柣妤€鐗嗘禍閬嶆⒑閸涘﹣绶遍柛鐘虫皑缁粯銈ｉ崘鈺冨幈闂侀潧顦介崰鏍ㄦ櫠椤栫偞鐓曢悗锝冨妼婵倿鏌＄仦鐐缂佺粯鐩畷褰掝敊绾拌京鈧兘姊绘笟鈧褔鎮у鍫濈；闁告洦鍨辩粻鎺撶節閻㈤潧顫掗柛娑卞帨閵忋倖鐓曞┑鐘叉噹閸氬湱绱掗鍓у笡缂佸倹甯為埀顒婄秵閸嬪嫰鍩€椤掆偓閻忔氨鎹㈠☉銏犵闁绘劕鐏氶崳浠嬫⒑缂佹ê绗╁┑顔哄€楅幑?providerId / modelId
      const step = (asset.kind === 'character' || asset.kind === 'prop') ? 'characterDesign' : 'storyboarding';
      let provider = cfg.providers.find(p => p.id === asset.providerId && p.enabled);
      if (!provider) provider = getProviderForStep(cfg, step) || undefined;
      // 婵犵數濮烽弫鍛婃叏娴兼潙鍨傞柣鎾崇岸閺嬫牗绻涢幋鐐寸殤闁活厽鎹囬弻娑㈩敃閿濆棛顦ラ梺?step 婵犵數濮甸鏍窗濡ゅ啯鏆滄俊銈呭暟閻瑩鏌熼悜妯镐粶闁逞屽墾缁犳挸鐣锋總绋课ㄦい鏃囧Г濞呭秹姊洪懡銈呅㈡繛灞傚€曢锝夘敆閸曨剙浜滈梺缁樻尭濞撮攱瀵肩€ｎ喗鍊甸悷娆忓缁€鈧┑鐐跺皺婵炩偓鐎规洘鍨块獮妯肩磼濡　鍋撴繝姘厾闁诡厽甯掗崝婊勭箾閸涱喚澧垫慨濠冩そ瀹曟粓骞撻幒宥囧嚬缂傚倷娴囬褔宕愰崹顔炬殾闁汇垻顭堢粻铏繆閵堝嫯鍏岄柛姗€浜跺娲传閸曨喚妾ㄩ梺鍛婃处閸嬪懘顢旈悩缁樷拻濞达絿鐡旈崵鍐煕閵娿倕宓嗛柟顔ㄥ棛鐤€婵炴垶顭囬崝锕€顪冮妶鍡楃瑨闁稿﹤缍婂畷鐢稿焵椤掑嫭鈷戦柛婵嗗婢ч亶鏌涢幘璺烘瀻妞ゆ洩缍侀獮搴ㄦ嚍閵夛附鐝冲┑鐘灱濞夋盯顢栭崨鏉戠?apiPath/apiFormat 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏂垮⒔閻瑩鏌熷▎鈥崇湴閸旀垿宕洪埀顒併亜閹烘垵鈧崵澹?
      let model = getModelForStep(cfg, step);
      // 婵犵數濮烽弫鍛婃叏閻戝鈧倹绂掔€ｎ亞鍔﹀銈嗗坊閸嬫捇鏌涢悢閿嬪仴闁糕斁鍋撳銈嗗坊閸嬫挾绱撳鍜冭含妤犵偛鍟灒閻犲洩灏欑粣鐐烘煟韫囨洖浠﹂柛搴㈠▕閹啴顢曢敂瑙ｆ嫼闂佸憡绋戦敃銉﹀緞閸曨個鐟邦煥鎼存繈鍋楅梺璇″枙閸楁娊鐛Ο鑲╃＜婵☆垵妗ㄩ崠鏍р攽閻愯埖褰х紓宥佸亾濡炪値鍋勯ˇ鍗炩枎閵忋倖鍤戞い鎺戝€婚敍婵嬫倵楠炲灝鍔氶柟铏姈閻楀海绱撻崒娆戭槮闁稿﹤鎽滅划鏃堟偡閹殿喗娈鹃梻渚囧墮缁夋挳宕￠幎鑺ョ厽婵☆垵娅ｆ禒娑㈡煕閻樺啿娴慨濠勭帛閹峰懘宕ㄦ繝鍌涙畼闂備胶鍘х紞濠勭不閺嶎厼绠氬鑸靛姈閸嬪倿骞栫€涙〞鎴︽倶?modelName 婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁躲倝鏌﹀Ο鐚寸礆婵炴垶菤閺€浠嬫煕椤愶絿绠撻柣蹇擄工椤啴濡堕崱娆忣潷缂備緡鍠栫粔鐢稿礆婵犲啰闄勯柛娑橈功閸橆亪姊洪崜鎻掍簼缂佽鍟蹇撯攽鐎ｎ偆鍘甸梺鍝勵儛閸嬪嫭鎱ㄩ崒鐐寸厵妞ゆ梻鐡斿▓姗€鏌熼崣澶嬪唉鐎规洜鍠栭、妯款槼婵炲牆缍婂娲偂鎼达絼閭梺鍝勬噽婵炩偓鐎殿喛顕ч埥澶愬閻樻牑鏅犻弻鏇熷緞濡儤鐏堥梺鍛婃尫閸楀啿顫忛搹瑙勫珰闁炽儴娅曢悘宥呪攽閻愭彃绾фい顓炴川閸掓帒鈻庨幇顒傜獮婵犵數濮存鎼佸箖閹达附鈷戦柛娑橈梗缁堕亶鏌涢悩宕囧⒌闁糕斁鍋撳銈嗗笒鐎氼亪骞夋ィ鍐╃厸閻忕偠顕ф俊濂告煃閽樺妲搁摶锝夋煕椤垵娅樺ù鐓庡暣濮婄粯鎷呯粙娆炬闂佺粯鎸搁悧鎾崇暦閸︻厽宕夊〒姘煎灠濞堛劑姊鸿ぐ鎺擄紵缂佲偓娴ｈ櫣鐭嗛悗锝庡亖娴滄粓鏌″搴ｅ帥婵炲牊鏌ㄩ湁婵犲﹤鐗忛悾娲煛瀹€瀣埌閾伙絽顭块崜渚囩劸闁诡垰鐗嗛—鍐Χ閸涱垳顔囬悗瑙勬处閸撶喖宕洪妷锕€绶為柟閭﹀墰椤旀捇姊洪崨濠傚闁告稒婢橀崢顓熺節閻㈤潧袨闁搞劎鍘ч埢鏂库槈濮樿京鐓嬮梺鑽ゅ枛閸嬪﹪宕?ModelConfig
      if (provider && asset.modelId && model && model.modelName !== asset.modelId) {
        model = { ...model, modelName: asset.modelId } as any;
      }

      if (!provider || !model) {
        throw new Error(t('canvasPanelRetryNoProvider'));
      }

      let url = '';
      const sourcePrompt = customPrompt || asset.prompt || asset.name || '';
      const prompt = await optimizeCanvasMediaPrompt(cfg, sourcePrompt);
      const referenceImages = canvasNode
        ? connectedImageUrls(get().nodes, get().connections, canvasNode.id)
        : [];
      if (asset.kind === 'character') {
        // 闂傚倸鍊峰ù鍥х暦閻㈢绐楅柟鎵閸嬶繝鏌ㄩ弮鍌氫壕闁哄棙绮撻弻锝夊棘閹稿孩鍠愰梺缁樼箚濞夋盯鍩為幋锔藉亹闁圭粯宸婚崑鎾绘偨缁嬭儻鎽曢梺鎸庢礀閸婂綊鎮￠崘顔界厓閺夌偞澹嗛ˇ锕傛煛閸℃瑥浠х紒杈ㄥ浮閹晠宕橀崣澶庣檨闂備礁鎼張顒傜矙閹达絿浜介梻浣虹帛閹稿摜鈧稈鏅犻幃妤冩嫚瀹割喗瀵?char 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勯弸渚€鏌熼梻鎾闁逞屽厸閻掞妇鎹㈠┑瀣倞闁靛鍎冲Ο渚€姊绘担鍛婂暈婵炶绠撳畷褰掓焼瀹ュ懐鏌у銈嗗笒閸婄敻宕戦幘璇茬濠㈣泛锕ｆ竟鏇㈡⒒娓氣偓閳ь剛鍋涢懟顖涙櫠椤曗偓閹繝濡舵径瀣幈閻熸粌閰ｉ妴鍐川椤栨粈绗夐梺瑙勫劶婵倝鎮¤箛鎿冪唵閻犲洠鈧磭浠╅柣搴㈠嚬閸樺ジ鍩?prompt 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒閸ㄥ倸鈹戦悩瀹犲缂佹劖顨婇弻鐔兼偋閸喓鍑￠梺?
        url = await generatePropImage(prompt, provider, model, undefined, referenceImages);
      } else if (asset.kind === 'prop' || asset.kind === 'scene') {
        url = await generatePropImage(prompt, provider, model, undefined, referenceImages);
      } else if (asset.kind === 'storyboard') {
        url = await generateStoryboardImage(prompt, '', 'zh', '', referenceImages, provider, model, undefined);
      } else {
        throw new Error(t('canvasPanelRetryUnsupportedKind').replace('{0}', asset.kind));
      }

      // 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸嬨倝鏌曟繛鐐珔缂佲偓婢舵劖鐓涢柛銉㈡櫅閺嬫垿鏌涘▎蹇曠缂佺粯鐩獮瀣枎韫囨洑鐥梻浣告惈閹峰宕滃璺虹疄闁靛鍎哄銊╂煕閳╁喚娈旂紒鐘烘缁辨挻鎷呮ウ鎸庮€楅梺鎼炲妼閻栫厧顕?taskAssets + 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒閸ㄥ倸鈹戦崒姘棌闁轰礁顑囬幉姝岀疀閺囩偛鐏婇梺鍐叉惈閹冲繘宕愭繝姘厾闁诡厽甯掗崝姘箾閸垹鏋涙慨濠呮缁瑩骞愭惔銏″缂傚倷绶￠崰鏍嫉椤掑倻鐭?url + prompt
      const successAssets = get().taskAssets.map(a =>
        a.id === taskAssetId
          ? { ...a, failed: false, error: undefined, generating: false, url, prompt, providerId: provider!.id, providerName: provider!.name, modelId: model!.modelName }
          : a
      );
      get().setTaskAssets(successAssets);
      const successAsset = successAssets.find(a => a.id === taskAssetId);
      if (successAsset) void syncAssetUpdate(successAsset);
      if (canvasNode) {
        get().updateNode(canvasNode.id, {
          url,
          _assetFailed: false,
          _assetError: undefined,
          _assetPrompt: prompt,
          _assetSourcePrompt: sourcePrompt,
          _assetProviderId: provider!.id,
          _assetProviderName: provider!.name,
          _assetModelId: model!.modelName,
        } as Partial<CanvasNode>);
      }
    } catch (e: any) {
      // 婵犵數濮烽弫鍛婃叏娴兼潙鍨傛繛宸簻绾惧潡鏌ゅù瀣珔闁搞劍绻堥弻娑㈠箻濡も偓鐎氼剟寮搁崒鐐粹拺闁圭瀛╃粈鈧梺绋匡工缂嶅﹤顕ｉ弻銉晢濞达絿鎳撳鍨攽椤旂瓔娈旀俊顐ｎ殕缁傚秹鎮欓悽鐢碉紲闂佺粯顭堟禍顒勬儗濞嗘挻鐓?failed 闂傚倸鍊搁崐鐑芥嚄閸撲礁鍨濇い鏍亹閳ь剨绠撳畷濂稿Ψ閵夛附袣闂備礁鎼粙渚€宕㈡總鍛婂€块柛顭戝亖娴滄粓鏌熸潏鍓хɑ缁绢厼澧庣槐鎺戔槈濡偐顔婄紓浣介哺鐢顭囪箛娑樜╃憸蹇涙偪閸曨垱鍊垫繛鍫濈仢閺嬫稒銇勯弴銊ュ籍闁糕斁鍋撳銈嗗笂閼冲爼鍩婇弴銏″珔闂侇剙绉甸悡鐔兼煙缂併垹鐏犲ù婊堢畺濮婂宕掑顑藉亾閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲闁稿绻濋弻鏇熺箾閻愵剚鐝﹂梺杞扮椤戝寮婚弴銏犻唶婵犻潧娴傚Λ銈夋⒑瀹曞洦鍤€缂佸缍婂璇差吋婢跺﹦鍘告繛杈剧到閹测€斥枔閵娧呯＝?
      const errorMsg = e.message || t('canvasPipelineUnknownError');
      const failAssets = get().taskAssets.map(a =>
        a.id === taskAssetId
          ? { ...a, failed: true, error: errorMsg, generating: false }
          : a
      );
      get().setTaskAssets(failAssets);
      const failAsset = failAssets.find(a => a.id === taskAssetId);
      if (failAsset) void syncAssetUpdate(failAsset);
      if (canvasNode) {
        get().updateNode(canvasNode.id, {
          _assetError: errorMsg,
        } as Partial<CanvasNode>);
      }
    }
  },

  setNodes: (nodes) => set({ nodes }),
  setConnections: (connections) => set({ connections }),

  // AgentMode 闂?Canvas 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭紒瀣嚦濞戞鏃堝焵椤掑啰浜辨繝鐢靛仜濡瑩骞愰幖浣稿瀭闁稿本绋掗崣蹇斾繆椤栨氨浠㈤柣鎾村姍閺岋繝宕担绋款潽闂侀€涚┒閸斿矂锝炲鍫濆耿婵°倐鍋撶紒鐘茬秺閺?agent 婵犵數濮烽弫鎼佸磻濞戙垺鍋ら柕濞у懎鏆楅梺绋跨灱閸嬫稓绮堥崘顔界厪濠电姴绻愰々顒佷繆閸欏鑰挎慨濠勭帛閹峰懘宕烽鐔诲即闂備礁鎲￠弻銊╂儔婵傜鐒垫い鎺嶇閸ゎ剟鏌涢妸銉э紞闁告帗甯楃换婵嬪炊閼稿灚娅囬梻浣瑰缁诲倸霉閸屾娲箹娴ｇ懓浠┑鐘诧工閸燁偊顢楅姀銈嗙厵濞撴艾鐏濇慨鍌溾偓瑙勬礀閻栧ジ銆侀弮鍫濈＜婵炲棙鍔楀鏍⒒閸屾瑧顦﹂柟璇х節閵嗗啴宕奸妷銉э紱濠电偞鍨崹娲磻閸岀偞鐓曠€光偓閳ь剟宕戦悙鐑樺亗闁绘柨鍚嬮悡蹇涚叓閸ャ儱鍔ょ紒澶屾暬閺屾盯濡堕崱娆愬櫘缂備浇椴哥敮鈥愁嚕椤曗偓瀹曟帒顫濋鈧粻锝呪攽?
  //
  // 闂傚倸鍊峰ù鍥х暦閸偅鍙忛柟鎯板Г閸婂潡鏌ㄩ弴妤€浜鹃梺浼欑到閸㈡煡锝炲鍫濈劦妞ゆ帒瀚ㄩ埀顑跨椤粓鍩€椤掑嫮宓侀柡宥冨妽婵绱掔€ｎ亞浠㈠ù婊冪埣濮婄粯鎷呴搹鐟扮闂佸搫琚崝鎴濈暦閺屻儱钃熼柕澶涚畱閳ь剙鐖奸弻锝夊棘閸喗鍊梺缁樻尪閸庤尙鎹㈠☉銏犵闁绘劕鐏氶崳顖涚節閵忥綆娼愰拑閬嶆煏閸パ冾伃闁轰礁鍊块幃鍓т沪閽樺鍝楅梻鍌欐祰椤曟牠宕伴弴鐘插灊婵炲棙鍔掔换鍡樻叏濠靛棛鐒炬俊鑼跺吹缁辨挻鎷呴崫鍕戯綁鏌ｉ埡濠傜仸鐎殿喖顭烽弫鎾绘偐閺屻儱鏁规繝鐢靛Т閻忔岸宕濋弽顭戞婵?'image' 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕剝锚缁愭盯鏌ｈ箛鎾剁闁轰礁顭烽獮鍐亹閹烘垹鍊炲銈呯箰鐎氼喖袙閵忋倖鈷戦梺顐ゅ仜閼活垱鏅舵导瀛樼厱闊洦妫戦懓璺ㄢ偓娈垮櫘閸嬪嫰顢橀崗鐓庣窞濠电姴娲ら弫瑙勭節閻㈤潧孝闁挎洏鍊濋獮濠囧箛閺夎法鐤呴悷婊呭鐢鍩涢幋锔界厱婵犻潧妫楅鈺傘亜韫囨梹灏﹂柡灞剧洴婵℃悂濡堕崨顓犮偖闁诲氦顫夊ú锕傚垂閸洖鏄ラ柍褜鍓氶妵鍕箳閹存繍浠鹃梺鎶芥敱閸ㄥ爼濡甸崟顖氱疀闁宠桨璁查崑鎾诲即閵忊懇鍋撻悜鑺モ拻濞达絽婀卞﹢浠嬫煕婵犲啯绀€閾荤偞绻涢幋娆忕仼闁绘帒鐏氶妵鍕箳瀹ュ牆鍘￠梺鎰佸灡濞茬喖寮诲☉銏犳闁绘劕寮堕崳鐑樸亜椤愶絾绀冮柟渚垮妼铻ｉ柟绋挎捣閵嗘劙寮?
  // 'image' 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕剝锚椤庢盯姊洪崫銉ユ瀻闁硅櫕锕㈠濠氬Χ閸パ勭€抽梺鍛婎殘閸嬫盯锝為锔解拺婵懓娲ら崝姘舵煙閾忣偓鑰跨€殿喖顭烽弫鎾绘偐閼碱剙濮︽俊鐐€栫敮鎺斺偓姘卞厴瀵偄顓奸崱娆戭啎闂佺懓顕崕鎰版倿閼恒儰绻嗛柤纰卞墮閸樺瓨鎱ㄦ繝鍐┿仢妤犵偞鍔栭幆鏃堟晲閸屾凹娼撻梻鍌欑劍濡炲潡宕ｆ惔銊ョ獥婵ê宕崹婵囥亜閹惧崬鐏╃痪鎯у悑缁绘盯骞嬮悜鍥︾返闂佹悶鍊戦崐婵嗩潖閾忓湱纾兼慨妤€鐗呯欢鐢告⒑閸濄儱校閻㈩垪鈧磭鏆﹂柟杈剧畱缁犲鎮楀☉娅亪顢撻幘缁樷拺闁告稑锕︾紓姘舵煕鎼淬倕鐨虹紒杈╁仜閻ｆ繈鍩€椤掑倹顫曢柟鎯х摠婵挳鏌熺紒妯虹瑐濠㈣娲熷缁樻媴缁涘娈愰梺鍛婎焾濡嫰顢欒箛鏃傜瘈婵﹩鍓涢敍娑㈡⒑鐟欏嫬鍔ゆい鏇ㄥ弮閸┿垽寮埀顒勫Φ閸曨垱鏅柛鏇ㄥ幖閳牨e-to-Image 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒閸ㄥ倸鈹戦悩瀹犲缂佹劖顨婇弻鐔兼偋閸喓鍑￠梺鎼炲妼閸婂綊骞堥妸銉庣喖骞愭惔锝冣偓鎰板级閳哄倻绠栫紒缁樼洴楠炴﹢寮堕幋鐘插Р闂備胶顭堥鍡涘箲閸ヮ剙钃熸繛鎴欏灪閺呮煡鏌涘☉鍗炴灍闁哥姵鍔欏楦裤亹閹烘繃顥栨繝鐢靛亹閸嬫捇鎮楀▓鍨灍婵炲吋鐟ㄩ悘鎺楁倵閻熸澘顏い锝忛檮缁旂喖寮撮悢铏诡啎闁哄鐗嗘晶浠嬪箖閸忕浜滄い鎾跺仧婢с垻绱掗鑲╁缂佹鍠栭崺鈧い鎺嗗亾妞ゎ偄绻樺畷顐﹀礋閵婏妇鈧姊虹拠鈥崇€婚柛鏇ㄥ幒缁岸姊洪懡銈呮瀾缂侇喖绉撮…鍨熼懖鈺冪厠闂佽崵鍠愭竟鍡涘汲?
  // 闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻鐔兼倷椤掑倹鑿囬梺閫炲苯澧柛濠傛健瀹曟椽鏁撻悩鑼槰闂佸疇妗ㄩ悞锕傛倵?缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鎲搁悧鍫濈瑲闁稿顑夐弻锝夊箛椤掑倷绮靛?婵犵數濮烽弫鍛婃叏娴兼潙鍨傞柣鎾崇岸閺嬫牗绻涢幋鐐寸殤闁活厽鎹囬弻鐔虹磼閵忕姵鐏堥梺鍝勫閸庡弶绌辨繝鍋芥棃宕橀鍡樺枓L/婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熼梻瀵歌窗闁轰礁瀚伴弻娑㈩敃閿濆洩绌?闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佺粯鍔曢顓犵不妤ｅ啯鐓冪憸婊堝礈濮樿鲸宕叉繛鎴欏灩瀹告繃銇勯幘鍗炵仼鐎殿喕鍗冲鐑樻姜閹殿噮妲紓浣割樀濞佳囶敋閵夆晛绀嬫い鏍ㄥ哺閸炶泛鈹戦鏂や緵闁稿繑绋掔粩鐔煎即閻旇櫣顔曢柡澶婄墕婢т粙骞冩總鍛婄厸闁告粈绀佹禍鏉库攽閳ュ磭鍩ｆい銏℃礋閸╂稑顫濇潏銊ユ畬闂佸磭鎳撻崯鎾箖閳哄懎绠甸柟鐑樻尰椤斿嫰姊哄Ч鍥х労闁搞劑浜堕妴鍐╃節閸パ嗘憰闂佹枼鏅涢崯顖涘垔閹绢喗鐓曟繝闈涙椤忔挳鏌￠崱鈺佸籍闁诡喗顨堥幉鎾礋椤掆偓閻噣姊洪悡搴ｆ瀮闁糕晜鐗滅划瀣箳濡や焦娅囬梺绋挎湰閼规儳鐣甸崱娑欌拺缂備焦锕笟娑㈡煕閻樿櫕绀堥柛鎺撳浮閹粙宕ㄦ繛鐐?
  // 濠电姷鏁告慨鐢割敊閺嶎厼闂い鏍ㄧ矊缁躲倝鏌ｉ敐鍛拱鐎规洘鐓￠幃妤呮晲鎼粹剝鐏嶉梺?agent 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€广儱顦粈鍐┿亜椤撶喎鐏ｉ弶鈺偯埞?闂?婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熺紒銏犳灈缁炬儳顭烽弻鐔兼倷椤掍胶浼囧┑?'image' 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滄晥闂備礁鎼幏瀣礈濮樿鲸宕叉繛鎴欏灩缁狅綁鏌ｉ幇顒備粵闁革綆鍠栭埞鎴﹀灳瀹曞洦鍕鹃梺鍛婃煥閻倿宕?asset_kind 濠?闂?婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熺紒銏犳灈缁炬儳顭烽弻鐔兼倷椤掍胶浼囧┑?'prompt'
  // header 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滅瑧缂備焦鍎虫晶鐣屽垝椤栫偛绠為柕濞垮労濞笺劑鏌涢埄鍐炬當妞ゎ偀鏅犲铏规嫚閸欏鏀悗瑙勬礈閺佺危閹版澘绠虫俊銈咃攻閺呮繈姊洪棃娑氬婵炲眰鍊楃划顓㈡晸閻樻枼鎷虹紓鍌欑劍椤洦绔熼崟顓犵＜闁艰壈鍩栫涵鍫曟煕閹烘挸娴€规洖缍婇、鏇㈠Χ閸屾稒鏆ら梻鍌欒兌閹虫捇宕ラ埀顒傜磼閳ь剚鎷呴崷顓ф锤?
  //
  // 闂傚倸鍊烽悞锕傛儑瑜版帒鏄ラ柛鏇ㄥ灠閸ㄥ倸霉閸忓吋缍戦柣銈庡枟閵囧嫰骞囬崼鏇燁€嶉梺绋垮閸ㄥ爼濡甸崟顖氱闁瑰瓨绻嶆禒楣冩⒑閸濆嫭濯奸柛鎾村哺楠炲牓濡搁妷顔藉缓闂佺硶鍓濋〃鍛不鐠囨祴鏀介柍銉ョ－濠€鎾煕閺傝法鐒搁柛鈹垮劜瀵板嫰骞囬鍌ゅ晫闂備礁鎲￠崜顒勫川椤栨稒娅掗梻鍌氬€烽悞锕傚箖閸洖绀夐悘鐐电叓瑜版帗鍊婚柤鎭掑劚娴犲繘姊洪崨濠冨瘷闁告洦鍋掗埀顒佺洴閹鎲撮崟顒傤槬濠电偞娼欓崐鍦偓闈涖偢瀹曞爼顢楁担鍝勫箺?
  //   闂傚倸鍊搁崐椋庣矆娴ｅ搫顥氭い鎾卞灩缁犵娀鏌熼悙顒佺稇缂佸墎鍋ら弻娑㈠Ψ椤旂厧顫╃紓?Header (prompt, "闂傚倸鍊峰ù鍥х暦閻㈢绐楅柟鎵閸嬶繝鏌ㄩ弮鍌氫壕闁哄棙绮撻弻锝夊棘閹稿孩鍠愰梺?(3)")  闂?
  //                                  闂?image
  //                                  闂?image
  //                                  闂?image
  //   Header (prompt, "闂傚倸鍊搁崐椋庢濮橆剦鐒界紓浣姑肩换鍡涙煕閵夘喖澧痪鎯ф健閺屾洟宕煎┑鍥ф珴闂?(1)")  闂? image
  //   Header (prompt, "闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬫杸闁诲函缍嗘禍婵囨綇?(2)")  闂? image
  //                              闂? image
  //                              闂? image
  //
  // ID 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼唶闂佸憡绺块崕鎶芥儗閹剧粯鐓曢柟鎹愬皺閸斿秵銇勯锝嗙闁哄瞼鍠撻埀顒傛暩椤牆鏆╂繝纰樻閸嬫帡宕归崼鏇炶摕闁靛ň鏅涢崡铏繆閵堝倸浜炬繛瀛樼矒缁犳牕顫忛悜妯侯嚤婵炲棙鍨硅ⅵ缂傚倷鑳舵慨鐢告偋閻樺樊鍤曟い鎰╁焺閸氬顭跨捄鐚磋含闁哥偛鐖煎娲濞戞氨鐣鹃梺鍛婃尰缁诲倿鍩㈤幘璇差潊闁挎稑瀚?clearAgentNodes / relayoutAgentNodes 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻涢幋鐐╂（婵炲樊浜濋弲婵嬫煕鐏炵偓鐨戞い鏂挎嚇濮婃椽妫冨☉姘暫濡炪倧缂氶崡鍐差嚕閺屻儺鏁嗛柍褜鍓熼垾锕傚锤濡や礁娈濋梺姹囧灮閸嬶綁鍩€椤掍礁绗х紒?
  //   - image 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滄晥闂?  `agent-asset-{kind}-{projectId}-{assetId}`
  //   - header 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滄晥闂? `agent-cat-{kind}-{projectId}`
  //   婵犵數濮烽弫鎼佸磻濞戙埄鏁嬫い鎾跺枑閸欏繐螖閿濆懎鏋ら柡浣革工閳规垿鎮╅幓鎺濅紑缂備讲鍋?`id.startsWith('agent-')` 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒缁€澶屸偓鍏夊亾闁逞屽墴閸┾偓妞ゆ帊绀侀崵顒勬煕閵娿劑鍝虹紒宀冮哺缁绘繈宕堕懜鍨珝闂備線娼х换鍡涘焵椤掍焦鐏遍柛瀣尰椤︾増鎯旈姀鐘崇€鹃梻浣虹帛椤ㄥ懘鎮ч崱娆戠當闁圭儤顨嗛悡鏇熶繆椤栨粎甯涢悘蹇ョ畵閺岀喖顢欓悡搴⑿╅梺瀹狀嚙濮橈妇绮诲☉銏犵睄闁瑰鍎愬Λ銈夋⒒?agent 闂傚倸鍊搁崐鐑芥嚄閸洏鈧焦绻濋崶褎妲梺鍝勭▉閻忔劕煤椤忓嫬鍞ㄩ梺闈浤涢崶顭戔偓宥夋⒒娴ｅ憡鎯堢紒瀣╃窔瀹曘垺绂掔€ｎ亜鎯為悗骞垮劚椤︿即鎮￠弴銏″€堕柣鎰絻閳锋棃鏌ｉ鐑囧伐闂囧鏌ｅ▎灞戒壕闂佹悶鍔岄悥鐓庮嚕婵犳艾惟闁靛鍨洪～宥呪攽閳藉棗鐏犻柛姘儏閳绘挾绮╁姝況/relayout 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顕€鏌熼幆鐗堫棄闁哄嫨鍎甸弻鈥愁吋鎼粹€茬敖闂佸憡顨嗛懝楣冨煘閹达附鍋愰悗鍦Т椤ユ繄绱撴担鍝勑㈤柛鐔锋健閳ワ妇鎹勯妸锕€纾梺鎯х箳閹虫捇銆傞悽鍛娾拺?
  addAgentNodes: (input) => {
    const state = get();
    const { artifacts } = input;
    const projectId = state.projectId || 'global';

    // 1) 闂?artifacts 闂?asset_kind 濠电姷鏁告慨鐑姐€傛禒瀣婵犻潧顑冮埀顒€鍟鍕箾閻愵剛浜欐繝鐢靛仦閸垶宕硅ぐ鎺戝瀭闁稿瞼鍋涚粻褰掑级閸繂鈷旈柟顔笺偢閹?
    const buckets: { kind: string; label: string; items: ArtifactLite[] }[] = [];
    const kindOrder: string[] = ['character', 'prop', 'scene', 'storyboard', 'novel', 'script', 'other'];
    const kindLabel: Record<string, string> = {
      character: 'character',
      prop: 'prop',
      scene: 'scene',
      storyboard: 'storyboard',
      novel: 'novel',
      script: 'script',
      other: 'other',
    };
    for (const kind of kindOrder) {
      const arr = (artifacts as Record<string, ArtifactLite[] | undefined>)[kind];
      if (Array.isArray(arr) && arr.length > 0) {
        buckets.push({ kind, label: kindLabel[kind] || kind, items: arr });
      }
    }
    for (const k of Object.keys(artifacts || {})) {
      if (kindOrder.includes(k)) continue;
      const arr = (artifacts as Record<string, ArtifactLite[] | undefined>)[k];
      if (Array.isArray(arr) && arr.length > 0) {
        buckets.push({ kind: k, label: k, items: arr });
      }
    }

    // 2) 闂傚倸鍊烽悞锕傛儑瑜版帒鏄ラ柛鏇ㄥ灠閸ㄥ倸霉閸忓吋缍戦柣銈庡枟閵囧嫰骞囬崼鏇燁€嶉梺绋垮閸ㄥ爼濡甸崟顖氱闁瑰瓨绺鹃崑鎾广亹閹烘垶杈堝┑鐘诧工閻楀﹪鎮″▎鎾粹拻闁稿本鍑归崵鐔搞亜閿斿ジ妾紒?
    const HEADER_W = 220;
    const HEADER_H = 80;
    const IMG_W = 260;     // 婵犵數濮烽弫鍛婃叏娴兼潙鍨傞柣鎾崇岸閺嬫牗绻涢幋鐐寸殤闁活厽鎹囬弻娑㈩敃閿濆棛顦ラ梺?DEFAULT_NODE_SIZES.image.w
    const IMG_H = 178;     // 婵犵數濮烽弫鍛婃叏娴兼潙鍨傞柣鎾崇岸閺嬫牗绻涢幋鐐寸殤闁活厽鎹囬弻娑㈩敃閿濆棛顦ラ梺?DEFAULT_NODE_SIZES.image.h
    const ROW_GAP_Y = 32;  // 缂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т绾捐顭块懜闈涘Е闁轰礁顑囬幉鎼佸棘鐠恒劍娈惧┑鐐叉▕娴滄粓鐛姀鈥茬箚妞ゆ牗姘ㄥВ鐐烘煛鐎ｎ偆鎳囬柡宀嬬稻閹棃顢涘鍛咃綁姊洪崫銉バｆい銊ワ躬瀵偄顓兼径瀣簻闂佺绻楅崑鎰板储娴犲鈷戦梻鍫熶緱閻掗箖鏌涙惔銊ゆ喚妞ゃ垺妫冮崺锟犲川椤旀儳骞楅梺鐟板悑閹矂宕伴弽褜鍤曟い鏇楀亾闁哄瞼鍠栭、娑橆潩椤掑绱旀俊銈囧Х閸嬬偤鏁冮姀銈冣偓浣糕枎閹捐櫕顥濋梺闈涚墕濞层倝骞嗛悙鐑樷拻?
    const COL_GAP_X = 32;  // header 婵?image闂傚倸鍊搁崐椋庢濮橆剦鐒界憸宥堢亱闂佸搫鍊归娆撳疮閸涘瓨鐓ラ柡鍥╁仧閳瑰潛e 婵?image 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀閽冪喖鏌曟繛鐐珦闁轰礁瀚…璺ㄦ崉婵傝В鈧枼妲堥柕蹇曞█閺佹粌鈹戞幊閸婃挾绮堟笟鈧畷婊堫敇閵忊檧鎷洪梺鍛婄☉閿曘儲寰勯崟顖涚厱闁规儳鐡ㄩ惃鎴︽煃瑜滈崜娆撴倶濮樺崬鍨濈€广儱顦埀顒€鍟存俊鐑藉煛閸屾埃鍋撻悜鑺ョ厸濠㈣泛顑呴悘宥夋煛鐎ｎ偆鎳冮柍瑙勫灴閸┿儵宕卞鎯у毐婵犵數鍋涢ˇ鏉棵洪悢鑲╁祦?

    // 闂傚倸鍊搁崐宄懊归崶顒€违闁逞屽墴閺屾稓鈧綆鍋呭畷宀勬煛鐏炲墽娲存い銏℃礋閺佹劙宕卞▎妯恍為梻鍌欐祰婢瑰牏浜稿▎鎰闁逞屽墴閺屸€崇暆鐎ｎ剛鐦堥悗瑙勬礀閵堟悂銆侀弴銏狀潊闁绘瑢鍋撴繛鑹板Г娣囧﹪鎮欓鍕ㄥ亾閺嶎厼绀夐柡鍥ュ灩鍥撮梺褰掓？閼宠泛鐣垫笟鈧獮鏍庨鈧俊濂告煕濡や礁鈻曢柡宀嬬秮楠炲洭顢楁担鍙夌亞婵犵數鍋涢悧婊堝垂鐠轰警娼栭柛婵嗗珔瑜斿畷鎯邦槻妞ゎ剙鐗撻弻锝嗘償閵忕姴姣堥梺鎼炲妼绾绢參宕氶幒鎾剁瘈闁搞儴鍩栭弲婵嬫⒑閹稿海绠撴繛鏉戝€哥叅闁归棿鐒﹂崑鈩冪節婵犲倸鏆熼懖鏍р攽閳ュ啿绾ч柛鏃€鐟╁畷娲晸閻樻彃绐涘銈嗘濡法绱撻幘缈犵箚闁绘劦浜滈埀顑惧€濆畷銏ゆ偩鐏炵偓娈伴梺缁樺姉閺佹悂鎯岄崱妤婄唵闁兼悂娼ф慨鍫ユ煟閹捐泛鏋戦柕鍥у椤㈡洟顢曢姀鐙€娼诲┑鐘茬棄閵堝棭浠╃紓浣介哺鐢繝鍨鹃敃鍌氱婵犻潧妫岄幏顐︽煟鎼淬値娼愭繛鎻掔箻瀹曟洟鎼归銈庢祫闂佹寧鏌ㄦ晶鐣屽婵傚憡鐓忛煫鍥ㄦ礀瀛濈€圭绉瑰?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻鐔兼焽閿曗偓閺嬨倝鏌ｉ鐐靛闁靛洤瀚伴獮鍥礈娴ｇ懓浠规俊鐐€愰弲鐐典焊濞嗘挸绠熺紒瀣儥閸氬鏌涢妷顔荤盎鐏忓繘姊洪崫鍕垫Ц闁绘瀚板畷婵囨償閵婏箑浠梺闈╁瘜閸樹粙宕伴幇鏉跨婵烇綆鍓欐俊浠嬫煕鐎ｎ亶妲归柕鍥у瀵潙螖閳ь剚绂嶆ィ鍐┾拺?
    const newAssetRefs: TaskAssetRef[] = [];
    const t = getT();
    const assetTagMap: Record<string, string> = {
      character: 'assetTagCharacter',
      prop: 'assetTagProp',
      scene: 'assetTagBackground',
      storyboard: 'assetTagStoryboard',
      novel: 'canvasPanelAssetsNovel',
      script: 'canvasPanelAssetsScript',
    };

    // 3) 闂傚倸鍊风粈浣革耿闁秴鍌ㄧ憸鏃堝箖濞差亜惟闁靛鍠楃紞搴㈢節閻㈤潧校闁煎綊绠栧鍛婄瑹閳ь剟寮婚弴銏犻唶婵犲灚鍔栫瑧闂備礁鎲￠〃鍡樼箾婵犲洤绠栨俊銈傚亾闁宠棄顦埢宥夋惞椤愩垻浼岄梺璇″櫙缁绘繈宕洪埀顒併亜閹烘垵顏柍閿嬪灴閺岀喓绮欓幐搴㈠闯闂佹剚鍨卞ú鐔煎蓟閵堝牄浜归柟鐑樻⒒閺嗩偊鎮楃憴鍕８闁搞劌缍婇崺銉﹀緞婵炪垻鍠撻崠鏍即閻愭澘顥氶梻浣告贡閸庛倝銆冮崨顓у晠婵犻潧娲㈡禍婊堟煛閸愩劍鎼愬ù婊嗩潐閵囧嫯绠涘☉妤佸枤濠殿喖锕ュ钘夌暦閻戠瓔鏁囩憸搴⌒掑畝鍕拺缂佸顑欓崕鎰版煙閻熺増鍠樼€?agent 闂傚倸鍊搁崐鐑芥嚄閸洏鈧焦绻濋崶褎妲梺鍝勭▉閻忔劕煤椤忓嫬鍞ㄩ梺闈浤涢崶顭戔偓宥夋⒒娴ｅ憡鎯堢紒瀣╃窔瀹曘垺绂掔€ｎ亜鎯為悗骞垮劚椤︿即鎮￠弴銏″€堕柣鎰絻閳锋棃鏌ｉ鐑囧伐闂囧鏌ｅ▎灞戒壕闂佹悶鍔岄悥鐓庮嚕婵犳艾惟闁靛鍨洪～宥呪攽閳藉棗鐏ｉ柛妯犲毝鐑藉焵椤掑嫭鈷?id 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼唶闂佸憡绺块崕鎶芥儗閹剧粯鐓曢柟鎹愬皺閸斿秵銇勯锝嗙闁哄瞼鍠愬蹇斻偅閸愨晩鈧秹姊洪崫鍕闁告挻鐟╅垾锕傚锤濡や礁娈濋梺姹囧灮閸嬶綁鍩€椤掍礁绗х紒杈ㄥ浮閸┾偓妞ゆ帊绀佺欢鐐烘煙闁箑骞橀柛姗€浜跺楦裤亹閹烘垳鍠婇梺鍛婃尰缁嬫垿鎮洪鐐╂斀闁绘ɑ鍓氶崯蹇涙煕閻樺啿鍝虹€规洘鍨挎俊鍫曞椽娴ｅ憡顓挎俊鐐€栫敮鎺斺偓姘煎墰缁濡烽敂杞扮盎闂佸搫鍟崐鐟扳枍閺囥垺鐓?
    set((s) => {
      // 婵犵數濮烽弫鎼佸磿閹寸姴绶ら柦妯侯棦濞差亝鏅滈柣鎰靛墮鎼村﹪姊洪崨濠冨闁搞劍婢樻晥闁哄被鍎查悡鍐喐濠婂牆绀堥柣鏃傚帶閽冪喖鏌ｉ弬鎸庢儓闁哄鐗婃穱濠囶敍濠靛洢鈧啫顭跨憴鍕婵﹦绮幏鍛村川婵犲啫鍓甸梻浣虹帛椤ㄥ懎螞濠靛﹥顥ら梻鍌氬€搁悧濠冪瑹濡ゅ懏鍊?agent 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滄晥闂備礁鎼幏瀣礈閻旂厧钃熸繛鎴炵矤濡查箖姊虹拠鑼闁伙紕婀?drawn闂?
      const otherNodes = s.nodes.filter((n) => !n.id.startsWith('agent-'));
      const otherConns = s.connections.filter((c) => {
        const fromIsAgent = c.from.startsWith('agent-');
        const toIsAgent = c.to.startsWith('agent-');
        return !(fromIsAgent || toIsAgent);
      });
      const newAgentNodes: CanvasNode[] = [];

      // 闂傚倸鍊峰ù鍥х暦閸偅鍙忛柟顖嗏偓閺嬪秹鏌ㄥ┑鍡╂Ц缂佹劖顨婇弻锟犲炊閵夈儳浠鹃梺缁樻尭閸婂湱鎹㈠┑鍥╃瘈闁稿本绮岄。铏圭磽娴ｅ搫袨闁稿海鏁诲璇差吋閸偅顎囬梻浣告啞閹搁箖宕版惔顭戞晪?agent 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滄晥闂?id闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿孩鏌ㄩ埞鎴﹀磼濠婂海鍔搁梺鍝勵儎缁舵岸寮婚弴銏犻唶婵犻潧娴傚Λ銈咁渻閵堝倹娅嗛柣鎿勭節閻涱噣寮介‖銉ラ叄椤㈡鍩€椤掑嫬鐒垫い鎺嶇贰濞堟绱掗纰辩吋鐎殿喕绮欐俊姝岊槾闁?connection
      let runningY = 0;
      for (const bucket of buckets) {
        // 3.1) 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌滃闁稿绻濋弻鏇㈠醇濠垫劖效闂佺粯鎸搁崐鍦崲濠靛洨绡€闁稿本绮岄。铏圭磽娴ｆ彃浜鹃梺绯曞墲缁嬫帡鎮￠弴銏＄厓闁宠桨绀侀弳鐔兼煙閸愬弶顥為柕鍥у椤㈡洟顢楅崒婊勬闂?header (prompt 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒?
        const headerId = `agent-cat-${bucket.kind}-${projectId}`;
        const existingHeader = otherNodes.find((n) => n.id === headerId);
        const headerOverride = state.nodeOverrides[headerId] || { dx: 0, dy: 0 };
        // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬵潔濠殿喗锕╅崢鍏肩韫囨搩娓婚柕鍫濇婵呯磼閻樺啿鐏寸€规洘锕㈤崺鈧い鎺戝閳锋垿鏌熼懖鈺佷粶闁告梹鎸抽弻娑㈠箼閸曨厾鏆ら悗娈垮枟婵炲﹪銆佸☉姗嗘僵闁挎繂妫鏃堟⒒娴ｇ瓔娼愰柛搴＄－婢规洟顢橀悙鍨噧闂傚倸鍊风粈渚€骞楀鍫濈柈闁秆勵殔绾惧鏌熼崜褏甯涢柍閿嬪灴閺屾稑鈽夊鍫濅紣缂備焦顨嗗銊ф閹烘柡鍋撻敐搴′簻闁诲繆鏅濈槐鎺撴綇閵婏箑纾冲Δ鐘靛仦椤洨妲愰幒鎳崇喖鎮滃Ο鍏肩€梻鍌氬€烽懗鍫曗€﹂崼銉ュ珘妞ゆ帒鍊搁崹婵嬫倶閻愭彃鈷旀い鈺呮敱閵囧嫰寮介顫勃闂佺粯鎸堕崕鑼崲濞戙垹绠ｉ柣鎰仛閸ｎ喖顪冮妶搴″⒉闁稿鍔楀Σ鎰板箳閹惧墎鎳濋梺鎼炲劀閸屾粌鍤紓鍌氬€风粈渚€宕愰崫銉х煋闁绘垵澹欓崶鈹惧亾濞戞瑯鐒界紒鐘荤畺閺岀喓绱掑Ο铏圭懖闂佺顑冮崕鏌ャ€冮妷鈺傚€烽柡澶嬪灦鐠囩偞绻濈喊澶岀？闁稿繑蓱娣囧﹪鎮滅粵瀣櫓闂佸憡鐟崑鈧柡鍛Т椤繘宕崝鍊熸缁辨帒螣鐞涒剝鐎奸梻鍌欑閹诧繝寮婚妸褏鐭撻柟缁㈠枛閻撴繄鈧箍鍎遍幏瀣焽閵娾晜鐓冪憸婊堝礈閻斿鍤?image 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滅瑧闁?
        if (false) newAgentNodes.push({
          id: headerId,
          type: 'prompt' as const,
          x: 0 + headerOverride.dx,
          y: runningY + headerOverride.dy,
          w: HEADER_W,
          h: HEADER_H,
          title: `${bucket.label} (${bucket.items.length})`,
          text: `${bucket.label} items: ${bucket.items.length}`,
          // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸搫顦伴崵姘洪鍕幐闂佸憡绮堥悞锕傚疾閳哄懏鈷戦柟鑲╁仜閸旀挳鏌涢幘鏉戝摵鐎殿喗鐓￠、妤佹媴閻熸澘浼庢繝纰樻閸ㄦ澘顭囬敓鐘蹭紶婵炲樊浜濋悡娑㈡煕閳╁喚娈樼紒鐘卞嵆濡焦寰勭€ｎ剛鐦堟繝鐢靛Т閸婃悂寮抽敐鍡愪簻閹兼番鍩勫▓婊堟煙椤旂瓔鐒剧紒鐘崇洴閺佹劙宕ㄩ娆愵敇闂?agent header 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犳壆绱掔€ｎ偓绱╃憸鐗堝笚閸婂鏌﹀Ο渚Ч闁诲寒鍓熷娲濞戞艾顣哄銈忓瘜閸ㄥ磭鍒掓繝姘櫜闁告粈鐒︾€靛矂鏌ｆ惔顖滅У濞存粍绮撻、妤呭閵堝棛鍘搁梺绯曞墲濞叉牕鐣甸崱娑欑厸?prompt
          _agentLabel: bucket.label,
          _assetKind: bucket.kind,
          ...(existingHeader?.id ? {} : {}),
        } as CanvasNode);

        // 3.2) 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌滃闁稿绻濋弻鏇㈠醇濠垫劖效闂佺粯鎸搁崐鍦崲濠靛洨绡€闁稿本绮岄。铏圭磽娴ｆ彃浜鹃梺绯曞墲缁嬫帡鎮￠弴銏＄厓闁宠桨绀侀弳鐔兼煙閸愬弶顥為柕鍥у椤㈡洟顢楅崒婊勬闂備礁鐤囧Λ鍕囬悽鍝ュ祦婵せ鍋撴鐐叉处閹峰懐绮欓崹顕呮婵犵數濮烽弫鎼佸磻濞戙垺鍋嬪┑鐘叉搐閸ㄥ倸霉閿濆懎鏋ら柡鍡曞嵆濮婄粯绻濇惔鈥茬盎濠电偛鐪伴崐婵嬪蓟婵犲洦鏅插璺猴工閹?image 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒?
        const imageX = 0;
        bucket.items.forEach((item, i) => {
          const assetId = (item.id as string) || `${bucket.kind}-${i}`;
          const imgNodeId = `agent-asset-${bucket.kind}-${projectId}-${assetId}`;
          const existingImg = otherNodes.find((n) => n.id === imgNodeId);
          const imgOverride = state.nodeOverrides[imgNodeId] || { dx: 0, dy: 0 };
          const itemUrl = (item as any).url as string | undefined;
          const itemName = ((item as any).name as string) || (item.asset_kind as string) || bucket.label;
          const itemPrompt = ((item as any).prompt as string) || '';
          const itemProviderId = ((item as any).provider_id as string) || '';
          const itemProviderName = ((item as any).provider_name as string) || itemProviderId;
          const itemModelId = ((item as any).model_id as string) || '';
          newAgentNodes.push({
            id: imgNodeId,
            type: 'image' as const,
            x: imageX + imgOverride.dx,
            y: runningY + i * (IMG_H + 12) + imgOverride.dy, // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄闂佺粯鍔﹂崜娑㈡⒔閸曨垱鐓涢柛鎰╁妼閳ь剙顭峰畷鈥愁潩閼哥數鍘电紓鍌欓檷閸ㄥ綊寮稿☉姘辩＜闁逞屽墴瀹曞崬鈽夊▎鎴濆箞闂備焦鏋奸弲娑㈠疮娴兼潙绠犻柛鈩兦滄禍婊勩亜閹伴潧澧伴柣锝囨暬閺?images 闂傚倸鍊搁崐鐑芥倿閿曞倸绠栭柛顐ｆ礀缁€澶屸偓鍏夊亾闁告洦鍋嗛敍娆撴煟閻樺弶绌挎い銉ユ鐓ゆい蹇撳閺佹粌鈹戞幊閸婃劙宕戦幘缁樷拺闁告鍋為崰姗€鏌＄仦鍓ф创闁糕晛瀚板畷姗€鎮欓鍌涙缂?
            w: IMG_W,
            h: IMG_H,
            url: typeof itemUrl === 'string' ? itemUrl : '',
            name: itemName,
            generating: Boolean((item as any).generating),
            _assetFailed: Boolean((item as any).failed),
            _assetError: (item as any).error,
            // 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€广儱顦粈鍐┿亜椤撶喎鐏ｉ弶鈺偯埞鎴炲箠闁稿﹥顨嗛幈銊╁级閹炽劍妞介、姗€鎮欓崹顐ｎ啎婵犲痉鏉库偓鏇㈠箠鎼达絿鐭嗛柛鎰靛枟閻撳啴鏌涘┑鍡楊仼闁逞屽墮缂嶅﹪銆佸▎蹇ｅ悑濠㈣泛顑傞幏铏圭磼缂併垹骞栭柟宄邦儔瀹曠敻宕橀鐣屽幈闂佹寧绻傛鎼佹倶閿濆棔绻嗛柛娆忣槸婵洦銇勯鈧敃锕傚焵椤掆偓濠€閬嶅极濮掔€?闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滅瑧闂備胶顭堢悮顐﹀礉閹达箑钃熼柨婵嗩槸缁秹鏌涚仦鎹愬濠碘剝妞藉娲传閸曨剙娅ら梺璇″枛閸婂灝顕ｆ繝姘櫢闁绘灏欓崝锕€顪冮妶鍡楃瑨閻庢氨鍏樺顐㈩吋閸℃瑧顔曢梺鐟邦嚟閸庢劙鎮為懞銉ょ箚闁肩⒈鍓欓崢瀛樻叏?
            _assetPrompt: itemPrompt,
            _assetProviderId: itemProviderId,
            _assetProviderName: itemProviderName,
            _assetModelId: itemModelId,
            _assetKind: bucket.kind,
            // 婵犵數濮烽弫鎼佸磿閹寸姴绶ら柦妯侯棦濞差亝鏅滈柣鎰靛墮鎼村﹪姊洪崨濠冨闁搞劍婢樻晥闁哄被鍎查悡鍐喐濠婂牆绀堥柣鏃傚帶閽冪喖鏌ㄥ┑鍡╂缂傚秵鐗楅妵鍕箳閸℃ぞ澹曞┑鐘殿暯閳ь剝灏欓惌娆撴煛鐏炲墽娲撮柛鈺嬬節瀹曟帒顭ㄩ崟顐㈢仭濠德板€楁慨鐑藉磻濞戞碍宕叉俊顖欒閸ゆ洟鏌涙繝鍕珡婵℃彃顭烽幃璺侯潩閸楃偞鐏堥梺鍝勫閸撴繂顕ラ崟顖氬耿婵☆垵宕佃ぐ鍛節閻㈤潧浠滈柣顏冨嵆瀹曟繂鐣濋崟顐ゅ幒闂佽宕橀褏绮婚敐澶嬬叆闁哄洦顨呮禍鍓х磽娴ｆ彃浜鹃梺绋跨灱閸嬬偤鎮″☉銏＄厱妞ゆ劗濮撮悘顏堟煛閸″繑娅婃慨濠冩そ楠炲棜顦查柍褜鍓欏锟犵嵁閸愩剮鏃堝焵椤掑嫬鐓″璺号堥弸搴繆椤栨繂鍚归柡鍡檮娣?
            ...(existingImg ? { running: existingImg.running } : {}),
          } as CanvasNode);
          // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鎺嶇劍閸庢挾绱撻崒娆掝唹闁哄懐濞€瀵鈽夐姀鈺傛櫇闂佹寧绻傚Λ娑⑺囬妸鈺傗拺?assetRef闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿孩鏌ㄩ埞鎴﹀磼濠婂海鍔搁梺鍝勵儎缁舵岸寮婚弴銏犻唶婵犻潧娴傚Λ銈咁渻閵堝倹娅嗛柣鎿勭節閻涱噣寮介‖銉ラ叄椤㈡鍩€椤掑嫭鍊堕柍鍝勬噹缁?agent 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€广儱顦粈鍐┿亜椤撶喎鐏ｉ弶鈺偯埞鎴炲箠闁稿﹥顨嗛幈銊╁级閹炽劍妞介、姗€濮€閵忕姷銈﹂梻浣告贡閸庛倝銆冮崨顔煎姅闂傚倷绶氬褔藝椤撱垹纾块柛妤冨€?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻鐔兼焽閿曗偓閺嬨倝鏌ｉ鐐靛闁靛洤瀚伴獮鍥礈娴ｇ懓浠规俊鐐€愰弲鐐典焊濞嗘挸绠熺紒瀣儥閸氬鏌涢妷顔荤盎鐏忓繘姊洪崫鍕垫Ц闁绘瀚板畷婵囨償閵婏箑浠梺闈╁瘜閸樹粙宕伴幇鏉跨婵烇綆鍓欐俊浠嬫煕鐎ｎ亶妲归柕鍥у瀵潙螖閳ь剚绂嶆ィ鍐┾拺?
          const tagKey = assetTagMap[bucket.kind] || '';
          const tagLabel = tagKey ? t(tagKey) : bucket.kind;
          newAssetRefs.push({
            id: imgNodeId,
            kind: bucket.kind as TaskAssetKind,
            name: itemName,
            url: typeof itemUrl === 'string' ? itemUrl : '',
            tags: Boolean((item as any).failed) ? [tagLabel, t('canvasPanelAssetTagFailed')] : [tagLabel],
            prompt: itemPrompt,
            providerId: itemProviderId || undefined,
            providerName: itemProviderName || undefined,
            modelId: itemModelId || undefined,
            generating: Boolean((item as any).generating),
            failed: Boolean((item as any).failed),
            error: (item as any).error,
          });
        });

        // 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熼梻瀵歌窗闁轰礁瀚伴弻娑㈠即閵娿儱绠婚梺鍛婎殕瀹€鎼佸箖濡も偓閳藉鈻庡Ο鐓庡Ш闂備礁纾划顖氼潖瑜版帒桅闁告洦鍠氶悿鈧梺鍦亾閸撴碍绂掓總鍛娾拺閻犲洤寮堕崬澶屸偓瑙勬礈閺佺危閹版澘绠虫俊銈咃攻閺呮繈姊洪棃娑辨▓闁哥姵鐗犲顐︽偩瀹€鈧壕?(runningY + max(HEADER_H, items_count * IMG_H) + ROW_GAP_Y) 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍦劋椤ㄥ懐澹曟繝姘厵闁绘劦鍓氶悘閬嶆煛閳?
        const stackHeight = Math.max(HEADER_H, bucket.items.length * (IMG_H + 12));
        runningY += stackHeight + ROW_GAP_Y;
      }

      return {
        // AgentMode 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗楃粙鎾汇€呴崣澶岀瘈濠电姴鍊绘晶鏇㈡煕鐏炶濮傞柡宀€鍠撻埀顒傛暩椤牊鐗庡┑鐘愁問閸ㄤ即宕ョ€ｎ喖绠為柕濞垮劗閺€浠嬫煕閳╁啰鎳呭ù鐓庢喘濮婃椽妫冨☉姘拡闂佺顑呯€氭澘锕㈡担绯曟斀闁绘ɑ鐟ラ幊搴＄摥婵犵妲呴崑鍛矙閹捐泛鍨濈紓浣诡焽缁♀偓濠殿喗锕╅崢楣冨储闁秵顥婃い鎰╁灪閹兼劖銇勯幋婵囧殗鐎规洘绻堟俊鑸靛緞鐎ｎ剙骞愬┑鐐舵彧缁插潡鈥﹂崼銉ョ厱闁哄啫鐗婇悡娑樸€掑顒佹悙婵炲懎绉堕埀顒冾潐濞叉﹢鈥﹂崶顒€绠查柛鏇ㄥ灠鎯熼梺闈涱槶閸斿宕戦幘鍓佺处婵炴挸娼抧t 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻涢幋鐐╂（婵炲樊浜滄儫闂佸疇妗ㄩ懗鍫曞储閻戞绡€闂傚牊绋戦埀顒佹倐楠炲鏁撻悩鑼紱?ThoughtStream 闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箳濡も偓绾惧鏌ｉ幇顖ｆ⒖闁告繂瀚烽悡銉╂煕椤愶絾鍎曢柨鏃囧Г閸欏繑淇婇娑橆嚋缁绢厾鍋撳?
        nodes: [...otherNodes, ...newAgentNodes.filter((node) => node.type === 'image')],
        connections: otherConns,
      };
    });

    // 4) 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂?agent 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€广儱顦粈鍐┿亜椤撶喎鐏ｉ弶鈺偯埞鎴炲箠闁稿﹥顨嗛幈銊╁级閹炽劍妞介、姗€鎮欓崹顐ｎ啎?taskAssets闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻鐔稿閺夋垳鍠婇梺杞扮閿曨亪寮诲鍫闂佸憡鎸鹃崰鏍嵁閸愵亝鍏滈柛婊€鐒︿簺闂備浇顕х€涒晠宕欑憴鍕洸婵犻潧顑冮埀顒€鍟存俊鐑藉煛娴ｅ搫鈧偤姊洪棃娑辩叚缂佺姵鍨垮畷婵嬪川鐎涙ǚ鎷洪柣鐔哥懃鐎氼剟宕濋妶鍥ｅ亾濞堝灝鏋︽繛澶嬬洴閸┿垹顓兼径瀣汗缂傚倷鐒﹂…鍥储閹间焦鍊垫鐐茬仢閸旀岸鏌熼搹顐㈠缂侇喚绮€佃偐鈧稒顭囬崢浠嬫⒑闂堟稓澧曢柟鍐查叄椤㈡棃顢橀悩顐壕婵炲牆鐏濆▍姗€鏌涢敐蹇曠М妤犵偛锕ら…銊╁醇濠靛棛鈧厼顪冮妶鍡楀闁哥姵鍔欓幃姗€宕橀鍡欙紳闂佺鏈悷銊╊敊婢舵劖鐓曢悗锝庡亝瀹曞矂鏌″畝瀣埌妞ゎ偅绻堥、妤佸緞婵犲喚鍟€缂傚倸鍊风拋鏌ュ磻? 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄闂佽鍨奸悘鎰亹閹烘挸鈧崵绱掑☉姗嗗剱闁?
    //    濠电姷鏁告慨鐢割敊閺嶎厼闂い鏍ㄧ矊缁躲倝鏌ｉ敐鍛拱鐎规洘鐓￠弻鐔告綇閹呮В闂?agent event 闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т缁愭淇婇妶鍛櫣闁搞劌鍊圭换婵嬫濞戞艾顤€濡炪値鍋呭ú鏍箒闂佺粯鎸稿ù鐑藉箺閻樼粯鐓熼柟鎯у暱閳ь剙顭烽崺鈧い鎺嗗亾缂佺姴绉瑰畷鏇㈠础閻愬秵绋戦埢搴ㄥ箻瀹曞洭鐛撻柣鐔哥矌婢ф鏁Δ鍛亗婵炴垶鈼よぐ鎺撴櫜闁割偆鍣ユ禒鈺冪磽娴ｅ弶顎嗛柛瀣崌濮?artifacts 闂傚倸鍊搁崐鎼佲€﹂鍕；闁告洦鍊嬭ぐ鎺戠＜闁绘劘灏欓敍娑㈡⒑缁洖澧茬紒瀣灴閹苯螖閸涱厾顔愬┑鐑囩秵閸撴瑦淇婃禒瀣厸闁告粈绀佹晶鎾煙椤旀枻鑰块柟顔界懇瀵爼骞嬪┑鍠版垶淇婇悙顏勨偓褏寰婇幑鎰╀汗闁告劦鍠楃粻鎺楁⒒娴ｈ櫣甯涢柨鏇楁櫊瀹曚即寮介鐐殿槷濠殿喗顭堥崺鏍偂閺囩喍绻嗘い鏍ㄧ箓閸氬綊鏌嶉挊澶樻█闁哄本娲熷畷鍗炍熼悜妯跨檨闁诲氦顫夊ú蹇涘礉閹达负鈧礁鈻庨幘鏉戞異闂佸啿鎼敃锝囨濮椻偓濮婂宕掑▎鎴М闂佸湱鈷堥崑濠傜暦椤掑嫬钃熼柕澶堝劚缁愭稑顪冮妶鍡樷拻闁稿鎸搁埢?agent 闂傚倸鍊搁崐鐑芥嚄閸洏鈧焦绻濋崶褎妲梺鍝勭▉閻忔劕煤椤忓嫬鍞ㄩ梺闈浤涢崶顭戔偓宥夋⒒娴ｅ憡鎯堢紒瀣╃窔瀹曟垿宕ㄩ娆戝墾闁瑰吋鐣崝宥夋偂閺囥垺鐓涢柛銉ｅ劚婵℃椽姊洪褍鐏﹂柡宀嬬到閳藉鈻庨幇顒傦紦闂?
    //    闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼槷闂佸搫娲ㄦ慨鐑芥儗閹剧粯鐓欑紓浣靛灩閺嬫稓绱掗悩宕囧⒌妤犵偞鐗曡彁妞ゆ巻鍋撳┑陇娉曢埀顒冾潐閹搁娆㈠璺鸿摕闁靛牆娲ㄩ惌娆撴偣閹帒濡虹紒顔炬暬濮婅櫣绱掑Ο璇茬殤闂佺顑嗛幑鍥ь潖缂佹ɑ濯撮柛锔诲幗閼垮洭姊洪崨濠冪叆闁活剙銈搁崺鈧い鎺嶇閹兼悂鏌涢弮鈧崹鍨暦濞差亜鐒垫い鎺嶉檷娴滄粓鏌熺€涙绠栭柛瀣ㄥ劜缁绘盯鎳栭埡鍌氭殐ncAssetCreate 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗楃粙鎾汇€呴崣澶岀瘈濠电姴鍊绘晶閬嶆煛?闂?闂?url 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂佹寧娲栭崐褰掑疾椤忓牊鈷?闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒缁€澶屸偓鍏夊亾闁逞屽墴閸┾偓妞ゆ帊绀侀崵顒勬煕閵娿儳锛嶉柛鎺撳笚缁绘繈宕堕懜鍨珖闂備焦瀵х换鍌毭归崒姣椽骞栨担鐟颁画濠电姴锕ょ€氼剟鎮橀幘顔界厵妞ゆ牗鑹鹃弳锝夋煙椤斿搫鐏茬€规洘顨婇幃鈩冩償濠靛牏澶勬繝纰夌磿閸嬫垿宕愰妶澶婂偍闁伙絽鏈弳婊堟煟閹邦喗鏆╅柣顓炴椤潡鎳滈棃娑橆潔闂佹娊鏀遍崹鍫曞Φ閸曨垰绠抽柛鈩冦仦婢规洟姊绘担绛嬪殭缂佺粯鍨归幑銏ゅ醇濠靛牊娈鹃梺闈涚箞閸婃洖娲垮┑鐘灱濞夋盯顢栭崶顒€鍌ㄩ柟鐑橆殕閸婂灚顨ラ悙鑼虎闁告梹宀搁弻鐔风暋闁箑鍓伴柛妤€宕埞鎴︽偐瀹曞浂鏆￠梺缁樻尰濞茬喖寮婚悢鍏煎€绘俊顖濐嚙閺嗘姊虹€圭姵顥夋い锕佷含濡叉劙骞樼拠鑼紲濠电偞鍨堕悷銉у閹惰姤鍊甸悷娆忓绾炬悂鏌涙惔銏㈠弨妤犵偛妫濆顕€宕奸悢鍛婄彸闂佸湱鍘ч悺銊ф崲閸曨厼顥氬ù鐘差儐閳锋垿鏌ゆ慨鎰偓鏇炵毈闂備胶绮敮顏嗙不閹达腹鈧箓宕归銉у枛閹虫牠鍩￠崘鐐﹂梺璇查缁犲秹宕曢柆宓ュ洭顢涘┑鍫㈩啍?
    const prevAssets = get().taskAssets || [];
    const nonAgentAssets = prevAssets.filter((a) => !a.id.startsWith('agent-asset-'));
    get().setTaskAssets([...nonAgentAssets, ...newAssetRefs]);
    const prevById = new Map(prevAssets.map((a) => [a.id, a]));
    for (const ref of newAssetRefs) {
      const prev = prevById.get(ref.id);
      if (!prev || prev.url !== ref.url) {
        void syncAssetCreate(ref, get().projectId || undefined);
      }
    }
  },

  clearAgentNodes: () =>
    // 闂?id 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼唶闂佸憡绺块崕鎶芥儗閹剧粯鐓曢柟鎹愬皺閸斿秵銇勯锝嗙闁哄瞼鍠撻埀顒傛暩椤牊绂掗敃鈧湁婵犙冪仢閳ь剚绻堝璇测槈閵忕姈銊╂煥濠靛棙鍣规い顒€顦扮换婵嗏枔閸喗鐏侀梺鎼炲妺缁瑥顕ｆ繝姘╅柕澶堝灪椤秴鈹戦悙鍙夘棡闁糕晛鐗撳鎶藉焺閸愵亞鐦堥梺鍐茬殱閸嬫捇鏌涢幇纰樺亾椤栧棗鎳夐崑?'agent-' 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍦劋椤ㄥ懐澹曟繝姘厵闁绘劦鍓欐晶顖炴煟閺傛寧顥㈤柟顔款潐濞碱亪骞忓畝濠傚Τ闂備焦鎮堕崐妤呭窗閹邦喗宕叉繛鎴欏灩闁卞洭鏌ｉ弮鍫濞寸厧鐭傚娲偡閹殿噯绱為梺绋款儍閸婃洟鎮鹃悜钘夌闁规惌鍘鹃崣鍡涙⒑閸涘﹤澹冮柛鎰电厛閸ゆ瑩姊婚崒姘偓鎼佸磹妞嬪孩顐介柨鐔哄Т缁愭绻涢幋鐐垫噭闁告瑥绻橀弻鏇㈠醇濠靛洤鏅?agent 闂傚倸鍊搁崐鐑芥嚄閸洏鈧焦绻濋崶褎妲梺鍝勭▉閻忔劕煤椤忓嫬鍞ㄩ梺闈浤涢崶顭戔偓宥夋⒒娴ｅ憡鎯堢紒瀣╃窔瀹曘垽鎳栭埡鍐劶闂佸憡娲﹂崹閬嶆偂閻斿吋鐓欓悗鐢殿焾閳ь剚鐗犻獮瀣晜鐟欙絾瀵栭柣搴＄畭閸庨亶藝娴煎瓨鍋?
    // 闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻娑㈠焺閸愵亝鍠涢梺绋款儐閹瑰洤鐣疯ぐ鎺濇晝妞ゆ帒鍟犻崑鎾诲箰鎼搭喗顔?image / prompt header / 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧懜褰掓煛鐏炶鍔氱€瑰憡绻冮妵鍕籍閸屾矮澹曞┑?agent_node timeline闂?
    set((s) => {
      const removed = new Set(s.nodes.filter((n) => n.id.startsWith('agent-')).map((n) => n.id));
      return {
        nodes: s.nodes.filter((n) => !removed.has(n.id)),
        connections: s.connections.filter((c) => !removed.has(c.from) && !removed.has(c.to)),
        selected: new Set([...s.selected].filter((id) => !removed.has(id))),
        // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗幋婵愪紝闂佽桨绀佸Λ婵嬪蓟閿濆绠涙い鏃囧Г濮ｅ嫰姊哄ú璇插箺闁瑰憡鎮傞崺鐐哄箣閿旇棄浜归悗瑙勬礀濞村倿寮抽敓鐘斥拺?taskAssets 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犲綊鏌嶉崫鍕櫣闁稿被鍔岄埞鎴﹀磼濮橆剦妫岄梺杞扮椤戝棝濡甸崟顖氱睄闁搞儺鐏濋幘缁樼厱閹艰揪绲介弸娑㈡煛瀹€瀣瘈鐎规洘锕㈡俊鎼佸Ψ閵忕姳澹曢悷婊呭鐢宕?agent 闂傚倸鍊搁崐鐑芥嚄閸洏鈧焦绻濋崶褎妲梺鍝勭▉閻忔劕煤椤忓嫬鍞ㄩ梺闈浤涢崶顭戔偓宥夋⒒娴ｅ憡鎯堢紒瀣╃窔瀹曟垿宕ㄩ娆戝墾闁瑰吋鐣崝宥夋偂閺囥垺鐓涢柛銉ｅ劚婵℃椽姊洪褍鐏﹂柡宀嬬到閳藉鈻庨幇顒傦紦闂備礁鎼悮顐﹀礉瀹€鍕叀濠㈣泛谩閻斿吋鍋傞幖鎼枟濮ｅ棛绱撻崒姘偓鐑芥嚄閸撲礁鍨濇い鏍ㄦ皑閺嗗棝鏌熼梻纾嬪厡鐎规挷绶氶弻鐔兼焽閿曗偓楠炴鈹戦娑欏唉闁哄矉缍侀弫鎰板川闁附钑夐梻浣侯焾椤戝棛鏁Δ鍐╁床婵炴垶鍩冮崑鎾斥槈濞嗘鍔烽梺娲讳簷閸楁娊寮诲☉銏犵疀闁稿繐鎽滈崙褰掓⒑濮瑰洤濡介柛銊ュ閹广垹鈽夐姀鐘殿啋闁诲酣娼ч幉锟狀敊閸ヮ剚鈷戦柛娑橈攻婢跺嫰鏌涘Ο鎭掑仮闁诡喚鍋ら獮鎰償閿濆浂鍟庨梻浣烘嚀椤曨參宕戦悙鍏哥剨闁靛ň鏅滈悡鏇㈡倵閿濆骸浜濈€规洖鐭傞弻锛勪沪鐠囨祴鍋撳┑瀣畺闁秆勵殢閺佸秵绻涢幋鐐嗘垿鏌ㄩ鐘电＝?
        taskAssets: s.taskAssets.filter((a) => !a.id.startsWith('agent-asset-')),
      };
    }),

  // 闂傚倸鍊搁崐鐑芥倿閿曗偓椤啴宕归鍛姺闂佺鍕垫當缂佲偓婢跺备鍋撻獮鍨姎妞わ富鍨跺浼村Ψ閿斿墽顔曢梺鐟扮摠閻熴儵鎮橀埡鍐＜闁绘瑢鍋撻柛銊ョ埣瀵鍨惧畷鍥ㄦ濡炪倖姊婚崢褔寮?agent 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滅瑧缂傚倷绶￠崑鍕矓瑜版帒钃熼柣鏃傗拡閺佸秹鏌ｉ幇顖氱处闁哥姴锕娲传閵夈儰绮舵繝鈷€鍐弰妤犵偛顦甸獮鏍ㄦ媴閻熼缃曢梻浣稿閸嬪棝宕伴幘鍑板洭濡烽敂鍓ь啎闁诲孩绋掗…鍥儗婵犲洦鐓欓柤鎭掑劤閻矂鏌涢幒鎾虫诞鐎殿噮鍓熷畷顖炲礃閸曨偅鎼愰柣鎰躬閺屻劌鈹戦崱妯烘婵犮垼顫夊ú鐔奉潖閾忓湱鐭欓悹鎭掑妿娴煎洭姊虹粙娆惧剱闁告梹鐟ラ悾鐑藉箣閿曗偓缁犲鎮归崶顏勭毢闁挎稒绮岄埞鎴︽偐鐠囇冧紣闁诲孩鍑归崢濂稿煝閹捐顫呴柕鍫濇閹锋椽姊洪棃鈺佺槣闁告瑥閰ｅ鎶筋敍閻愬鍘遍柣搴秵閸嬪懎鐣峰畝鍕厸?id 婵?'agent-' 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍦劋椤ㄥ懐澹曟繝姘厵闁绘劦鍓欐晶顖炴煟閺傛寧顥㈤柟顔款潐濞碱亪骞忓畝濠傚Τ闂備焦鎮堕崐妤呭窗閹邦喗宕叉繛鎴欏灩闁卞洭鏌ｉ弮鍫濞寸厧鐭傚娲偡閹殿噯绱為梺绋款儍閸婃洟鎮鹃悜钘夌闁规惌鍘鹃崣鍡涙⒑閸涘﹤澹冮柛鎰电厛閸?
  // 闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熺€涙绠ラ柣鎺嶇矙閺岋綁骞掗弬鍨棃ge / prompt header / 闂?agent_node闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熷▎陇顕уú顓€佸鈧慨鈧柣姗€娼ф慨锔戒繆閻愵亜鈧牕顔忔繝姘；闁瑰墽绮悡鏇炩攽閻樻彃鈧崵绮斿ú顏呯厵妞ゆ柣鍔屽ú銈囩不缂佹ǜ浜滈柡鍐ㄦ搐娴滆銇勯弬娆炬Ц妞ゎ亜鍟存俊鍫曞幢濡厧寮抽梻浣筋嚙缁绘垹鎹㈤崱娑欏€堕柟鎵閳锋帒霉閿濆牊顏犻悽顖涚洴閺屾盯寮埀顒€煤閺嶎厽鏅濋柕蹇婂墲缂嶅洭鏌嶉崫鍕偓鍛婄韫囨搩娓婚柕鍫濇婵呯磼閻樺啿鐏寸€规洖缍婂畷鎺楁倷閺夋垟鍋撻悽鍛婄叆婵犻潧妫濋妤€顭胯閸ㄥ爼寮婚敓鐘插耿婵°倕鍟伴鎺楁⒑鐠団€虫灍妞ゃ劌锕獮鍐╃鐎ｎ亜鐎銈嗗姂閸ㄦ椽鎮鹃鍌滅＝闁稿本鐟╁鐑芥煕閺傝法效闁诡噯绻濋崹鎯х暦閸ャ劍顔曟繝鐢靛仜濡﹥绂嶅鍕嚤闁绘绮悡鏇㈡煛閸ャ儱濡煎ù婊勭箞閺岋絽鈹戦幇顒備桓闂佸搫鐭夌紞鈧紒鐘崇洴楠炴﹢宕滄笟鍥ф暪闂傚倷绀佸﹢閬嶅煕閸儱纾诲┑鐘叉储閳ь兛绀侀～婵囷紣濠靛洦娅嶉梻渚€娼х换鎺撴叏?
  /* legacy agent timeline drag handling removed */
  /* recordAgentNodeDrag: (nodeId, x, y) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node || !node.id.startsWith('agent-')) return s;
      // 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸婅埖鎱ㄥ鍡楀闁哄棴闄勯幈銊ヮ渻鐠囪弓澹曟俊鐐€戦崹娲嚌妤ｅ喛缍栨繝闈涱儐閸ゅ姊婚崼鐔衡姇闁汇倕鎳樺缁樻媴娓氼垳鍔搁梺鍝勭墱閸撴盯宕氶幒鏂炬勃闁告挆灞剧カ婵＄偑鍊栭悧婊堝磻閻愮儤鍋傛繛鍡樺灩濡垶鏌ｅΔ鈧悡顐︻敂閸涱垼娲告俊銈忕到閸燁垶鎮?"闂?闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻娑㈠焺閸愵亖妲堢紓浣哄У閻楃娀寮婚悢鐓庣畾鐟滄粓宕甸悢鍏肩厓缂備焦蓱椤ュ牓鏌?_groupId 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸嬨倝鏌曟繛鐐珕闁稿顑嗘穱濠囧Χ閸涱厽娈滈梺?y闂傚倸鍊搁崐鐑芥倿閿曞倸绀堟慨妯挎硾绾惧鏌涘☉鍗炴灍闁?闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉寸壕鍧楁煏閸繃澶勯柡鍡樼矒閺岀喖鎮滃Ο娲绘⒖婵犳鍠涘▍鏇㈠Φ閸曨垰绠婚柛妤冨仧娴犻箖姊?
      const peers = s.nodes
        .filter((n) => n.id.startsWith('agent-'))
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const idx = peers.findIndex((n) => n.id === nodeId);
      if (idx < 0) return s;
      // 闂傚倸鍊搁崐鐑芥倿閿曗偓椤啴宕归鍛姺闂佺鍕垫當缂佲偓婢舵劗鍙撻柛銉ｅ妽閻擄絿绱掔拠鍙夘棡闁靛洤瀚伴獮姗€宕￠悙鍏哥棯闂備胶顭堥敃锕傚礂濮椻偓瀵鏁愭径瀣簻缂備礁顑嗛娆徫涢崱娑欌拺闁告繂瀚峰Σ椋庣磼椤旂晫鎳冩い顐㈢箲缁绘繂顫濋鍌ゆЧ婵＄偑鍊栭崝褏寰婇挊澶嗘瀺闁挎繂顦伴埛鎴︽煕濠靛棗顏╂い蹇婃櫊閺屾稒绻濋崒銈囧悑闂佺硶鏂侀崑鎾愁渻閵堝棗绗掗悗姘煎幖閳藉顦归柡宀€鍠栭幊鐐哄Ψ瑜忛悡澶愭⒑鐠団€虫灓闁稿鎸鹃幑銏犫攽閸♀晜鍍靛銈嗗笂閻掞箒鈪查梻鍌氬€风粈渚€骞夐敍鍕床闁稿本澹曢崑鎾愁潩閻撳骸顫╅梺瀹狀嚙缁夋挳鍩㈡惔鈽嗗殫婵犻潧妫涚粔娲煛娴ｇ懓濮嶇€规洏鍔戦、娑㈠川椤愨懇鍋撳┑瀣摕?
      const baseX = node.x; // 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌涘┑鍕姢闁活厽鎹囬弻娑㈩敃閿濆棛顦ㄩ梺?dx/dy 闂?x 闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箛椤旇棄搴婂┑掳鍊撻梽宥嗙閸垻纾奸悗锝庡弾閸?base闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁搞倖鍔栭妵鍕冀椤垵娈ч梺鍛婄箓鐎氱兘鎮￠妷鈺傜厱闁哄洢鍔岄獮鎰版煛?set 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顕€鏌涢幇顓犮偞闁哄鐗楃换娑㈠箣濞嗗繒浠肩紓浣插亾闁告洦鍨遍悡銉︾箾閹寸伝顏堫敂椤愩倗妫柟顖嗕礁浠梺缁樻惄閸嬪﹤鐣烽崼鏇炍╅柨鏇楀亾缁炬澘绉撮—鍐Χ鎼粹€插缂傚倸绉崇粈渚€顢?
      const baseY = node.y;
      return {
        nodeOverrides: { ...s.nodeOverrides, [nodeId]: { dx: x - baseX, dy: y - baseY } },
      };
    }), */

  // 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊閵忊晝鍔搁梺钘夊暟閸犲酣鍩為幋锔藉亹闁告瑥顦伴幃娆撴⒑閸濆嫷鍎庣紒鑸靛哺楠炲啫螖閸涱噮妫冨┑鐐村灦閻熴儵寮抽崼銉︹拺?agent 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕剝锚椤︹晠姊洪崫鍕棡缂侇喗鎹囧璇测槈閵忕姷鐤€闂佸疇妗ㄧ粈渚€鈥栫€ｎ亖鏀介柣姗嗗亜娴滅偓绻涚€电甯堕柣掳鍔戦幃锟犲Ψ閿斿墽顔曢梺鐟邦嚟閸嬬喖骞婇崨顔轰簻闁挎繂妫涢崣鈧梺璇″枟椤ㄥ﹤鐣疯ぐ鎺濇晝闁靛牆娲ㄩ崢婊勪繆閵堝洤啸闁稿绋撶划鏃囥亹閹烘垶妲梺閫炲苯澧柕鍥у楠炴帡骞嬪┑鍐ㄤ壕鐎瑰嫭澹嬮弻?_groupId 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬵潔濠殿喗锕╅崜娆撴倶婵犲洦鍊垫鐐茬仢閸旀碍銇勯敂璇茬仴缂佺粯鑹鹃埞鎴︽倷閼搁潧娑х紓浣瑰絻濞硷繝鐛繝鍥х缂備焦锚閸?y闂傚倸鍊搁崐鐑芥倿閿曞倸绀堟慨妯挎硾绾惧鏌涘☉鍗炴灍闁?闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉寸壕鍧楁煏閸繃澶勯柡鍡樼矒閺岀喖鎮滃Ο娲绘⒖婵犳鍠涘▍鏇㈠Φ閸曨垰绠婚柛妤冨仧娴犲ジ寮堕埡鍌滅畺缂佺粯绋掑蹇涘礈瑜嶉崺灞解攽閻橆偄浜鹃梻渚囧墮缁嬩線寮崒鐐寸厱婵犻潧瀚崝銈囩棯?override
  /* relayoutAgentNodes: () =>
    set((s) => {
      const agentNodes = s.nodes.filter((n) => n.id.startsWith('agent-'));
      if (!agentNodes.length) return s;
      const HEADER_W = 220;
      const HEADER_H = 80;
      const IMG_W = 260;
      const IMG_H = 178;
      const ROW_GAP_Y = 32;
      const COL_GAP_X = 32;

      // 闂?_groupId 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬵潔濠殿喗锕╅崜娆撴倶婵犲洦鍊垫鐐茬仢閸旀碍銇勯敂鍨祮鐎殿喗鐓￠、妤佹媴閻熸澘浼庢繝鐢靛█濞佳囧疮椤栨埃鏋旀繝鏇熺摪er 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝Υ閸愨晜鍎熼柕蹇嬪焺濞茬鈹戦悩璇у伐闁瑰啿绻愰悾鐑藉箵閹规缍婇弫鎰板川椤旇法顢呴梻浣哥－缁垰螞閸愵喖钃熺€广儱鐗滃銊╂⒑閸涘﹥灏扮紒瀣尭鍗遍柟鐗堟緲缁犺櫕淇婇妶鍌氫壕缂備讲鍋撻悗锝庡枟閻撴洟鏌熼幑鎰敿闁稿繐鏈妵鍕晜閼姐倕寮甮roupId 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍌氫壕婵ê宕崢瀵糕偓瑙勬礉椤鈧絻鍋愰埀顒佺⊕閿氬ù鐘层偢濮婅櫣绱掑鍡欏姺缂備緡鍣崹璺虹暦閸偆绡€闁告劧缂氱花濠氭椤愩垺澶勯柟鍛婃倐椤㈡棃顢曢妶鍥╋紲闂佺粯锚閸熷灝霉椤曗偓閺?id闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熷▎鈥崇湴閸旀垿宕洪埀顒併亜閹烘垵鈧崵澹?
      // image 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕檧鏅滅瑧缂?_groupId 闂傚倸鍊搁崐宄懊归崶銊х彾闁割偆鍠嗘禒鍫ユ煙闂傚鍔嶉柛銈呰嫰铻栭柨婵嗘噹閺嗘瑩鏌￠崟鈺佸姢闁逞屽墮閸樻粓宕戦幘缁樼厓鐟滄粓宕滈悢鐓庢槬闁逞屽墯閵囧嫰骞掗幋婵冨亾瑜版帒姹查柍鍝勬噺閻撴瑩鏌ц箛锝呬簼閻忓繒鏁婚弻?header闂?
      const headers = agentNodes.filter((n) => n.type === 'prompt');
      const imagesByGroup = new Map<string, CanvasNode[]>();
      for (const img of agentNodes.filter((n) => n.type === 'image')) {
        const gid = (img._groupId as string) || '';
        if (!imagesByGroup.has(gid)) imagesByGroup.set(gid, []);
        imagesByGroup.get(gid)!.push(img);
      }

      const newAgentNodes: CanvasNode[] = [];
      let runningY = 0;
      for (const header of headers) {
        const images = imagesByGroup.get(header.id) || [];
        newAgentNodes.push({ ...header, x: 0, y: runningY, w: HEADER_W, h: HEADER_H });
        const imageX = HEADER_W + COL_GAP_X;
        images.forEach((img, i) => {
          newAgentNodes.push({
            ...img,
            x: imageX,
            y: runningY + i * (IMG_H + 12),
            w: IMG_W,
            h: IMG_H,
          });
        });
        const stackHeight = Math.max(HEADER_H, images.length * (IMG_H + 12));
        runningY += stackHeight + ROW_GAP_Y;
      }

      const otherNodes = s.nodes.filter((n) => !n.id.startsWith('agent-'));
      // 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌涘┑鍕姢闁活厽鎹囬弻鐔虹磼閵忕姵鐏堥梺鎼炲妼閸婂潡寮诲☉妯滄棃宕橀妸銉ヮ棊闂?agent 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀閽冪喖鏌曟繛鐐珦闁轰礁瀚…璺ㄦ崉婵傝В鈧枼妲堥柕蹇曞█閺佹粌鈹戞幊閸婃挾绮堟笟鈧畷婊堫敇閵忊檧鎷洪梺鍛婄☉閿曘儲寰勯崟顖涚厱闁绘娅曢惃鎴犵磼椤斿墽甯涢柕鍫秮瀹曟﹢鍩￠崘銊ョ闂傚倷娴囬鏍储閻ｅ本鏆滈柟鐑橆殔缁€澶愭煟閵忋垺鏆╃痪鎯с偢瀵爼宕煎☉妯侯瀷闂佺懓鍟块幊姗€寮婚悢铏圭煋闁糕剝顨嗛幖鎰磼閳ь剛鈧綆鍋佹禍婊堢叓閸ャ劍灏靛褋鍨婚埀顒冾潐濞叉鍒掑鍥ㄥ床婵炴垯鍨圭粻锝夋煟閹邦剦鍤熼柛娆忔椤啴濡堕崱妤冧淮濡炪倧瀵岄崹鐢告倶鐎ｎ喗鈷戠紒澶婃鐎氬嘲鈻撻弮鍌滅＜妞ゆ劑鍨绘晥闂佸搫鐭夌徊鍊熺亽闁荤姴娲╃亸娆戠矈妞嬪海纾藉ù锝囩摂閸炶櫣绱掗懜闈涘摵鐎殿喖顭烽弫鎾绘偐閼碱剦妲版俊鐐€栭幐楣冨窗閹捐违闁归偊鍠氱壕钘夈€掑顒佸窛闁告ɑ鐩弻娑樷枎韫囨挻娈婚悗?
      return {
        nodes: [...otherNodes, ...newAgentNodes],
        connections: s.connections,
        nodeOverrides: {},
      };
    }), */

  // 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝Υ閸愨晜鍎熼柕蹇嬪焺濞茬鈹戦悩璇у伐閻庢凹鍙冨畷锝堢疀濞戞瑧鍘撻梺鍛婄箓鐎氼剟寮抽悢铏规／闁告瑣鍎抽惌娆撴煛鐏炵晫效鐎规洦鍋婂畷鐔碱敃閻旇渹澹曢悷婊呭鐢帞鐥?viewport 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲︽刊濂告煛鐏炶鍔氶柣銈囧亾缁绘繈妫冨☉鍗炲壈闂佸搫顑勭欢姘跺蓟閺囥垹閱囨繝鍨姈绗戠紓鍌欒兌婵绱炴笟鈧鏄忣槻妞ゎ偅绻堥、妤呭焵椤掑嫬鐒垫い鎺嗗亾妞ゎ厾鍏橀妴渚€寮崼鐔哄姸閻庡箍鍎卞Λ娑㈠储閽樺娓婚柕鍫濇噽缁犵増绻涚仦鍌氣偓鏍矉瀹ュ洦鍠嗛柛鏇ㄥ幘閻﹀牓姊洪柅鐐茶嫰婢у鈧娲忛崝鎴濐嚕閸洖绠ｉ柣娆屽亾婵″弶鎸冲缁樻媴閸涘﹥鍎撳銈忕畱閸熷潡鍩㈤弮鍫濆嵆闁靛繒濮垫潏鍫濃攽椤旂瓔鐒鹃柛鈺傜墵閹?agent 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顔姐亜閹板爼妾柛瀣樀閺岋綁骞橀崘宸敨濠电偞鍨剁喊宥呯暦婢舵劖鐓忓┑鐐戝啫顏电紒?
  // 缂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柤绋跨仛閸欏繘鏌ｉ姀鈩冨仩闁逞屽墮閸熸潙鐣烽崡鐐╂瀻闁归偊鍓欓獮鎴︽⒒娴ｇ顥忛柛瀣噹鐓ゆ慨妞诲亾鐎殿喗鐓￠、妤佹媴閻熸澘浼庢繝娈垮枟椤ㄥ懎螞濡や焦娅犳い鏂垮⒔绾惧ジ鏌熺紒妯虹瑲闁稿鍎甸弻鈥崇暆閳ь剟宕伴幘璇茬獥濠电姴浼ｉ悢鍛婂闁哄顑欏Λ婊堟⒒?id 婵?'agent-' 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍦劋椤ㄥ懐澹曟繝姘厵闁绘劦鍓欐晶顖炴煟閺傛寧顥㈤柟顔款潐濞碱亪骞忓畝濠傚Τ闂備焦鎮堕崐妤呭窗閹邦喗宕叉繛鎴欏灩闁卞洭鏌ｉ弮鍫濞寸厧鐭傚娲偡閹殿噯绱為梺绋款儍閸婃洟鎮鹃悜钘夌闁规惌鍘鹃崣鍡涙⒑閸涘﹤澹冮柛鎰电厛閸ゆ瑩姊婚崒姘偓鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熺€涙绠ラ柣鎺嶇矙閺岋綁骞掗弬鍨棃ge 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€广儱顦粈鍐┿亜椤撶喎鐏ｉ弶鈺偯埞?+ prompt header闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熷▎陇顕уú顓炵暦閿熺姵鍊烽柍鍝勫€绘禍?
  // bbox 闂?缂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柤绋跨仛閸欏繘鏌ｉ姀鈩冨仩闁逞屽墮閸熸潙鐣烽妸鈺佺骇闁瑰濮烽弳顐︽⒑閻熸澘鎮戦柣锝庝邯瀹曟繂顓兼径瀣偓?scale 闂?缂?viewport xy 闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箳濡も偓绾剧粯绻涢幋娆忕仼缂佺姷濮烽埀顒€绠嶉崕閬嵥囨导鏉戝惞?
  // 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勭粻鐘绘煙閹冾暢缂佲偓婵犲倵鏀介柣妯哄级閹兼劙鏌＄€ｂ晝顦﹂柍瑙勫灴閹晠宕ｆ径濠庢П闂備礁鎼幏瀣礈濮樿泛绠為柕濞垮劗閺€浠嬫煕閵夈垺娅囬柟铏崒rdW/boardH 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂缁樻櫈闂佸憡娲﹂崢楣冩儗閸℃ぜ鈧帒顫濋敐鍛闂備浇顕栭崹浼村疮閹绢喓鈧礁螖閸涱厾顦板銈嗗姂閸婃顭囨径鎰拻濞达絽鎲￠幆鍫ユ煟濡も偓缁绘ê顕ｉ锕€绠瑰ù锝囨嚀閸撱劑鎮楅獮鍨姎妞わ缚鍗抽幃?fit闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻鐔兼倷椤掑倻鐛梺鎸庣箓濞诧妇鈧碍姘ㄩ埀顒傛嚀婢瑰﹪宕板Δ鈧々?div 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌涱棡闁瑰啿鐭傚缁樻媴閸︻厽鑿囬梺绋块叄娴滃爼鐛繝鍐╁劅闁靛鍎欓妷鈺傜厵闁绘垶锕╁▓鏃堟煟椤撶噥娈旀い顓℃硶閹瑰嫭銈﹂崹顕呬純闂佹眹鍩勯崹濂稿礈濮樿鲸宕叉繝闈涱儐椤ュ牊绻涢幋鐐冩岸宕戦幘缁樺殟闁靛绠戝鍧楁⒑闂堟稓澧曢柟宄邦儏閵嗘帗绻濆顓犲幈闁诲繒鍋涙晶浠嬫儗鐎ｎ喗鍊垫慨妯煎帶婢ф挳鏌＄仦鍓ф创妤犵偛娲畷妤呭传閵夈儱姣堥梻鍌欑閹碱偄螞濡ゅ啯宕叉慨妞诲亾鐎?
  fitAgentView: (boardW, boardH) => {
    const state = get();
    const agents = state.nodes.filter((n) => n.id.startsWith('agent-'));
    if (!agents.length) return;
    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭罕闂佸搫娲㈤崹鍦不閻樿绠圭紒顔炬嚀閻撴垶绻涘顔荤盎闂佽￥鍊栨穱濠囧Χ閸曨収妲梺?
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of agents) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 260));
      maxY = Math.max(maxY, n.y + (n.h || 178));
    }
    // padding闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熼悜姗嗘畷闁搞倕鐭傞弻鐔碱敍閿濆洣姹楀┑鐐叉▕娴滄粎绮绘繝姘仯闁搞儯鍔岀徊鑽ょ磼閹邦厾娲存慨濠冩そ濡啫鈽夋潏鈺佸Ъ闂備胶顭堢€涒晠鎮￠垾宕囨殾闁归偊鍎甸弮鍫濆窛妞ゆ梹鍎抽獮?32px
    const PADDING = 32;
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (bboxW <= 0 || bboxH <= 0) return;
    // 闂傚倸鍊搁崐鐑芥嚄閸洍鈧箓宕奸姀鈥冲簥闂佺懓顕慨鎾垂濠靛牃鍋撻崗澶婁壕闂侀€炲苯澧撮柟?board 闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箛椤旇棄搴婇梺鍦濠㈡绮荤憴鍕╀簻闁规媽娉涢惁婊堟煛娴ｅ壊鍎愰柕鍥у楠炴﹢宕￠悙鍏哥棯闂備礁鎼幏瀣礈閻旂厧钃熸繛鎴欏焺閺佸啴鏌ｅΟ璇茬祷濠殿喖绉剁槐鎾诲磼濮橆兘鍋撻幖浣€鍥偨缁嬭儻鎽?0 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柛婵勫劗閸嬫挸顫濋妷銉ヮ潎閻庤娲橀崝姗€藝鐎涙ü绻?
    const w = Math.max(boardW || 0, 600);
    const h = Math.max(boardH || 0, 400);
    // 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲﹂浠嬫煏閸繃澶勬い顐ｆ礋閺岋繝宕堕妷銉т痪闂佺顑傞弲娑㈠煘閹达附鍋愰悗鍦Т椤ユ繈鏌ｉ悢鍝ユ嚂缂佺姵鎹囧璇测槈閵忊晜鏅濋梺缁樕戣ぐ鍐╂叏婢舵劖鈷?scale闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熼悜姗嗘畷闁稿孩顨嗛妵鍕籍閸屾矮澹曢悗瑙勬礀瀵爼骞堥妸銉庣喖宕稿Δ鈧幗鐢告煟鎼淬垻顣查柤褰掔畺濠€渚€姊洪幐搴ｇ畵妞わ箒妫勮灋闁硅揪闄勯悡鐔兼煟閺傛寧鎲哥紒鐘靛仱閺屸€崇暆鐎ｎ剛鐦堥梺绯曟杹閸嬫挸顪冮妶鍡楃瑨閻庢凹鍓涚划璇差潩鏉堛劌鏋戦柣搴秵閸嬪棝銆呴弻銉︾叆婵犻潧妫Σ褰掓煟閹惧崬鍔滅紒缁樼洴楠炲鎮欓崱妯虹仼婵炲棎鍨归…鍐层€掓稊纾?闂?1闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熷▎陇顕уú顓€佸▎鎾崇畾鐟滃繒绮佃箛鏂剧箚闁靛牆绻掗崚浼存煕閻曚礁鐏︾€?fit 闂傚倸鍊搁崐宄懊归崶褜娴栭柕濞炬櫆閸婂潡鏌ㄩ弴妤€浜惧銈庡幖濞层倝鍩㈡惔銊ョ闁绘垵妫欑紞妤呮⒒娴ｇ顥忛柛瀣噹鐓ら柡宥庡亞鐏忕數鈧箍鍎遍ˇ浼存偂閺囩喆浜滈柟鏉垮缁嬭崵绱掗埀顒勫礃椤旂晫鍙嗗┑鐐村灦閼归箖寮搁弮鍌滅＜?
    const scaleX = (w - PADDING * 2) / bboxW;
    const scaleY = (h - PADDING * 2) / bboxH;
    let scale = Math.min(scaleX, scaleY, 1);
    scale = Math.max(scale, 0.5); // 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熼梻瀵歌窗闁轰礁瀚…璺ㄦ崉娓氼垳鍙曢梺璇叉唉閸╂牜鎹㈠☉姗嗗晠妞ゆ棁宕甸崙褰掓⒑閸濆嫭濯奸柛鎾村哺楠炲牓濡搁妷顔藉缓闂佺硶鍓濋妵鐐佃姳娴犲鈷戦柤濮愬€曢弸鎴犵磼鐠囪尙澧︽鐐插暣閹粓鎸婃径濠傜ギ婵犳鍠楅敋闁哥喎娼″畷銏ゆ晬閸曨厾锛濋梺绋挎湰閼归箖鍩€椤掍焦鍊愰挊婵嬫煛婢跺鍎ラ柛銈嗩殜閺屾盯寮撮妸銉т紘闂佽桨绀侀崐鍧楀蓟濞戙垹鍗抽柕濞垮劚缁犳椽姊烘导娆撴闁圭懓娲ら～蹇涘传閸斿€熸閹峰鐣烽崶鈺傛櫒濠碉紕鍋戦崐鏍垂閻㈢鍋撳鐓庢灓闁告帗甯￠、姗€鎮㈡搴ｇ嵁濠电姷鏁搁崑娑氳姳闁秴纾?
    // 闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箳濡も偓绾剧粯绻涢幋娆忕仼缂佺姷濮烽埀顒€绠嶉崕閬嵥囨导鏉戝惞?
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const x = w / 2 - cx * scale;
    const y = h / 2 - cy * scale;
    set({ viewport: { x, y, scale } });
  },

  // 闂?viewport 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾閽樻繈鏌熼崜浣烘憘闁轰礁顑囬幉鍛婃償閵娿儳鐤勯梺闈浥堥弲娑㈡偂濞戙垺鐓曟繛鎴濆船楠炴ɑ銇?(0, 0) 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭罕闂佸搫娲㈤崹鍦不鐟欏嫨浜滈柟鏉跨埣濡绢噣鏌涚€ｎ亜鈧湱鎹㈠☉銏犲耿婵☆垵顕ч棄宥夋⒑閸濆嫭濯奸柛鎾跺枛瀵鈽夊搴⑿╅柣搴ゎ潐濞诧箓寮查悮鐬?闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕剝锚椤︹晠姊洪崫鍕棡缂侇喗鎹囧璇测槈閵忕姷鐤€闂佸疇妗ㄧ粈渚€鈥栫€ｎ亖鏀介柣姗嗗亜娴滅偓绻涚€电甯堕柣掳鍔戦幃锟犲即閻斿墎绠氬銈嗙墬缁瞼鏁崼鏇熺厸閻庯綆鍋呴ˉ鍫ユ煛鐏炲墽銆掗柍褜鍓ㄧ徊鑺ユ櫠鎼达絿鐭撴い鏇楀亾闁哄备鍓濋幏鍛村传閵夋劧绲块埀顒€鐏氬妯尖偓姘煎墴閸┿儲寰勬繝搴㈠兊婵℃彃鏈悧妤€鏆╅梻鍌氬€搁崐鐑芥倿閿曗偓椤啴宕归鍛姺闂佺鍕垫當缂佲偓婢舵劖鍊甸柨婵嗛婢ф彃鈹?闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€撻懗鍫曞煘瀹ュ鐓ｉ煫鍥ㄥ嚬濞兼劗鈧娲栧鍫曞箞閵娿儺娓婚悹鍥紦婢规洟鏌?agent 濠电姷鏁告慨鐑姐€傞挊澹╋綁宕ㄩ弶鎴濈€銈呯箰閻楀棝鎮為崹顐犱簻闁瑰搫妫楁禍鍓х磼閸撗嗘闁告ɑ鍎抽埥澶愭偨缁嬭法鍔﹀銈嗗笒鐎氼參鎮″☉姗嗙唵閻犺櫣鍎らˉ鐐寸箾閸涱厽顥㈤柟閿嬪灴閺屽棗顓奸崱娆忓箺闂備線娼чˇ顓㈠磿閺屻儱鍚归柛銉㈡杹閸嬫挸鈻撻崹顔界亪闂佽绻戦懝楣冾敋閵夆晛绀嬫い鎺嶇閸斿懘姊洪幇浣稿箲闁稿氦灏欓幑銏ゅ醇閵夈儴鎽?闂?
  // 闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т缁€鍫熺箾閸℃ɑ灏伴柛濠呭煐缁绘繈妫冨☉鍗炲壈闂?viewport 婵犵數濮甸鏍窗濡ゅ啯鏆滄俊銈呭暟閻瑩鏌熼悜妯镐粶闁逞屽墾缁犳挸鐣锋總绋课ㄦい鏃囧Г濞呭秴鈹戦悩鍨毄濠殿喚鏁婚幊婵囥偅閸愩劎顔?(-1800, -1000) 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌涘櫣闁搞劍绻堥獮鏍庨鈧俊鐑芥煃瑜滈崜姘舵偋閻樿尙鏆﹂柛顐ｆ处閺佸棗霉閿濆懏鍟為柣銈呮嚇濮婄粯鎷呮笟顖滃姼闂佸搫鐗滈崜娑㈠礆閹烘柧娌柛鎾楀本绁俊鐐€栭悧妤咁敋閵忥絻浜归柟鐑樻尰濞呮粓姊洪崨濠佺繁闁搞劌绉规俊鑸靛緞鐎ｎ剙骞?
  resetViewportToAgentOrigin: (boardW, boardH) => {
    const w = Math.max(boardW || 0, 600);
    const h = Math.max(boardH || 0, 400);
    // 闂傚倸鍊搁崐鐑芥嚄閸洏鈧焦绻濋崒妤佺亙濠电偞鍨崹娲疾濠靛鐓ラ柡鍥╁仜閳ь剚鎮傚鍛婄瑹閳ь剟寮诲☉銏犵婵°倐鍋撻悗姘煎幖閳绘挻瀵肩€涙ǚ鎷洪梺鍛婄☉閿曘倖绔熼崘顔界厱闁斥晛鍠氬▓鏃傜磼閻樺啿鐏存慨濠勭帛缁绘繃鎯旈垾鑼泿婵犵數鍋涢惇浼村磹濠靛棛鏆︽い鏍剱閺佸秹鏌ｉ幇顒€绾фい銉︾箖缁绘盯骞橀弶鎴犲姲闂佺顑嗛幐楣冨焵?(0, 0) 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭罕闂佸搫娲㈤崹鍦不鐟欏嫨浜滈柟鏉跨埣濡绢噣鏌?
    set({ viewport: { x: w / 2, y: h / 2, scale: 1 } });
  },

  reset: () =>
    set({
      nodes: [],
      connections: [],
      selected: new Set(),
      undoStack: [],
      clipboard: [],
      assetPanelOpen: false,
      viewport: { x: -1800, y: -1000, scale: 1 },
      cascadeRunning: false,
      cascadeRunPath: [],
      cascadeNodeStatus: new Map(),
      nodeOverrides: {},
    }),

  loadProject: (projectId: string) => {
    const currentProjectId = get().projectId;
    if (currentProjectId === projectId) return;
    // 1) 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€搁拑鐔兼煏婵炵偓娅撻柡浣稿閺屾稑鈽夐崡鐐茬闂佸搫妫庨崐婵嬪蓟濞戙垹鐒洪柛鎰剁細缁姊洪柅鐐茶嫰婢ь垶鎮介妞诲亾瀹曞洦娈鹃梺闈浥堥弲鈺呭极瀹ュ棔绻嗛柕鍫濆閸斿秵绻涢崨顓犲ⅵ闁哄矉缍侀幃銏ゅ传閵壯呭帓濠电姭鎷冮崟鍨杹濡ょ姷鍋為崝娆忕暦閵婏妇绡€闁告劏鏅濊ぐ鍧楁⒒娴ｈ櫣甯涙い顓炴川閸掓帡顢涢悙鑼紱闂佽澹嗘晶妤呮偂閻樼粯鐓曟繝闈涘閸旀挳鏌￠崱鈺佺仸闁?
    set({
      projectId,
      nodes: [],
      connections: [],
      viewport: { x: -1800, y: -1000, scale: 1 },
      taskAssets: [],
      selected: new Set(),
      undoStack: [],
      clipboard: [],
      assetPanelOpen: false,
      composerOpen: false,
      cascadeRunning: false,
      cascadeRunPath: [],
      cascadeNodeStatus: new Map(),
    });
    // 2) 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍝勭▉閸樿偐澹曢崷顓熷枑闁绘鐗嗘穱顖炴煛娴ｅ憡顥㈤柡宀嬬秮楠炲洭顢楁径濠冾啀婵＄偑鍊愰弲婵嬪礂濮椻偓閻涱噣寮介銏犵亰闂佽崵鍠愬姗€鍩涙径鎰拺缂佸灏呴崝鐔兼煛娴ｅ憡鎲告俊鍙夊姍楠炴帒螖閳ь剛鐚惧澶嬬厵閻庢稒顭囩粻妯好归悪鈧崢鐣屾崲濠靛棌鏋旈柛顭戝枤娴狀厼鈹戦敍鍕哗婵☆偄瀚伴幃楣冩倻閼恒儲娅滄繝銏ｆ硾閿曘倝宕妸鈺傚仭婵犲﹤鍟崬澶愭煏閸ャ劌濮嶅┑锛勫厴閸╋繝宕掑鍐ㄧ?
    void (async () => {
      const data = await loadFromBackend(projectId);
      if (!data) return;
      const nodes = data.nodes || [];
      const taskAssets = (data.taskAssets && data.taskAssets.length > 0)
        ? data.taskAssets
        : rebuildTaskAssetsFromNodes(nodes);
      set({
        nodes,
        connections: data.connections || [],
        viewport: data.viewport || { x: -1800, y: -1000, scale: 1 },
        taskAssets,
      });
    })();
  },
}));

// Auto-save 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€愰崑鎾淬亜椤撶偟浠㈡い顐ｇ矒閸┾偓妞ゆ帒瀚畵渚€鏌涢幇鈺佸闁哄啫鐗嗙粈鍐┿亜韫囨挸顏╅悷娆欓檮娣囧﹪鎮欓鍕ㄥ亾閺嶎厽鍋嬮柟鎹愵嚙绾捐淇婇妶鍛殶闁活厼妫濋弻娑㈠即閵娿儳浠梺缁樻尰閻╊垶寮诲☉銏犖ㄩ柟瀛樼矋椤﹂绱掗銊ユ处閳?localStorage闂?
useCanvasStore.subscribe((state) => {
  if (!state.projectId) return; // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ょ€氼噣銆呴崣澶堜簻闊洦鎸炬晶鏇㈡煟閹烘垹浠涢柕鍥у楠炴帡宕卞鎯ь棜濠碉紕鍋戦崐褔姊介崟顒傜彾闁糕剝绋戦悞鍨亜閹哄秶顦﹂柟鍏兼倐閺屾盯寮捄銊愌冣攽閿涘嫭鏆€规洜鍠栭、娑橆潩椤撶偟銈跺┑锛勫亼閸婃牠骞愭ィ鍐ㄧ獥闁瑰墽绮崑姗€鏌曟径鍡樻珕闁抽攱鍨块弻娑樷攽閸℃浠奸梺鍝勬閸嬬偟鎹㈠┑瀣劦妞ゆ帒瀚幑鑸点亜閹捐泛啸闁伙綀鍩栫换婵嬪閿濆懐鍘梺鍛婃⒐濞叉粎鍒掓繝姘ㄩ柍鍝勫€婚崢鐢告⒑绾拋娼愰柛鏃€鐗犻幃鐢割敂閸喓鍘辨繝鐢靛Т鐎氼參寮抽埡鍐＜?
  scheduleSaveNodes(state.projectId, state.nodes);
  scheduleSaveConnections(state.projectId, state.connections);
  scheduleSaveViewport(state.projectId, state.viewport);
  saveApiConfig(state.apiConfig);
});

export function createNode(
  type: CanvasNode['type'],
  point: { x: number; y: number },
  extra: Partial<CanvasNode> = {}
): CanvasNode {
  const size = DEFAULT_NODE_SIZES[type] || { w: 260 };
  return {
    id: uid(type),
    type,
    x: point.x,
    y: point.y,
    w: size.w,
    h: size.h,
    ...extra,
  };
}
