import type { SpellCardInstance, SpellMetadata } from './types';
import { TH06_METADATA, TH06TheWorldSpell } from './th06-the-world';
import { TH07_METADATA, TH07SaigyoujiParinirvanaSpell } from './th07-saigyouji-parinirvana';
import { TH11_METADATA, TH11SubterraneanSunSpell } from './th11-subterranean-sun';
import { TH13_METADATA, TH13SeventeenLasersSpell } from './th13-seventeen-lasers';

export interface SpellRegistryEntry {
  metadata: SpellMetadata;
  factory?: () => SpellCardInstance;
}

/**
 * Full TH06 - TH20 roadmap synced from "东方正作符卡3D化选卡方案 (TH06-TH20)".
 * New spell cards plug directly into `factory` as each prototype is crafted.
 */
export const SPELL_REGISTRY: SpellRegistryEntry[] = [
  {
    metadata: TH06_METADATA,
    factory: () => new TH06TheWorldSpell(),
  },
  {
    metadata: TH07_METADATA,
    factory: () => new TH07SaigyoujiParinirvanaSpell(),
  },
  {
    metadata: {
      id: 'th08-astronomical-entombing',
      gameCode: 'TH08',
      gameName: '东方永夜抄',
      spellName: '秘术 "天文密葬法"',
      character: '八意永琳',
      bgm: '千年幻想乡 ~ History of the Moon',
      prototype: 'InstancedMesh粒子系统',
      spatialForm: '天体轨道 + 宏观深空',
      visualHighlight: '多层倾斜3D行星公转轨道与宏观拉远运镜.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th09-flowering-gensokyo',
      gameCode: 'TH09',
      gameName: '东方花映冢',
      spellName: '花符 "幻想乡的开花"',
      character: '风见幽香',
      bgm: '今昔幻想乡 ~ Flower Land',
      prototype: '体积激光与拖尾条带',
      spatialForm: '高明度立体绽放',
      visualHighlight: '暖金明亮色调, 立体花苞层层剥开.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th10-mountain-of-faith',
      gameCode: 'TH10',
      gameName: '东方风神录',
      spellName: '"Mountain of Faith" / "风神之神德"',
      character: '八坂神奈子',
      bgm: '神圣庄严的古战场 ~ Suwa Foughten Field',
      prototype: 'InstancedMesh粒子系统',
      spatialForm: '立体符札瀑布 + 交错几何山壁',
      visualHighlight: '海量红蓝白3D符札薄片沿斜向交错倾泻成山壁, 随音乐加速发狂, 镜头从仰视转为缝隙穿行.',
      implemented: false,
    },
  },
  {
    metadata: TH11_METADATA,
    factory: () => new TH11SubterraneanSunSpell(),
  },
  {
    metadata: {
      id: 'th12-devils-recitation',
      gameCode: 'TH12',
      gameName: '东方星莲船',
      spellName: '大魔法 "魔神复诵"',
      character: '圣白莲',
      bgm: '感情的摩天楼 ~ Cosmic Mind',
      prototype: '体积激光与拖尾条带',
      spatialForm: '同轴法阵隧道',
      visualHighlight: '沿Z轴多层旋转法阵光环与弯曲彩带激光.',
      implemented: false,
    },
  },
  {
    metadata: TH13_METADATA,
    factory: () => new TH13SeventeenLasersSpell(),
  },
  {
    metadata: {
      id: 'th14-this-side-down',
      gameCode: 'TH14',
      gameName: '东方辉针城',
      spellName: '逆符 "天地有用" / 逆符 "天下翻覆"',
      character: '鬼人正邪',
      bgm: '逆转的意识形态 / Reverse Ideology',
      prototype: '后期Shader特效',
      spatialForm: '视错觉 + 摄像机反转',
      visualHighlight: '镜头随音乐节拍180度滚转, 重力倒置与镜像撕裂空间.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th15-pristine-danmaku-hell',
      gameCode: 'TH15',
      gameName: '东方绀珠传',
      spellName: '纯符 "纯粹的弹幕地狱"',
      character: '纯狐',
      bgm: 'Pure Furies ~ 心之所在',
      prototype: 'InstancedMesh粒子系统',
      spatialForm: '极简主义高密度矩阵',
      visualHighlight: '数万级红蓝白高密度实心发光球体几何压迫.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th16-hidden-god',
      gameCode: 'TH16',
      gameName: '东方天空璋',
      spellName: '后符 "绝对秘神的后光"',
      character: '摩多罗隐岐奈',
      bgm: '秘匿的四季 / 秘神摩多罗 ~ Hidden Star in All Seasons',
      prototype: '后期Shader特效',
      spatialForm: '非欧几里得传送门',
      visualHighlight: '模板测试悬浮后门, 四季弹幕倾泻而出.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th17-geometric-creature',
      gameCode: 'TH17',
      gameName: '东方鬼形兽',
      spellName: '"几何造物"',
      character: '埴安神袿姬',
      bgm: '将世界托付给偶像 ~ Idoratrize World',
      prototype: '特定3D模型实例化',
      spatialForm: '霓虹线框 + 赛博雕塑',
      visualHighlight: 'Wireframe线框着色器与锐利多面体数字雕塑.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th18-rainbow-ring',
      gameCode: 'TH18',
      gameName: '东方虹龙洞',
      spellName: '"虹人环"',
      character: '天弓千亦',
      bgm: '那热闹的市场今在何处 ~ Immemorial Marketeers',
      prototype: '体积激光与拖尾条带',
      spatialForm: '多层彩虹光环阵列 + 棱镜色散',
      visualHighlight: '七彩弹幕交织成多层旋转立体彩虹光环与星环轨道, 镜头穿梭叠加轻度色散.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th19-kingdom-of-nothingness',
      gameCode: 'TH19',
      gameName: '东方兽王园',
      spellName: '"亡羊的王国"',
      character: '日白残无',
      bgm: '越轨者们的无碍光 ~ Kingdam of Nothingness',
      prototype: 'InstancedMesh粒子系统',
      spatialForm: '极高对比度 + 虚无波纹',
      visualHighlight: '极暗虚空中猩红与纯白涟漪向外扩散吞噬空间.',
      implemented: false,
    },
  },
  {
    metadata: {
      id: 'th20-danmaku-fossil',
      gameCode: 'TH20',
      gameName: '东方锦上京',
      spellName: '"弹幕的化石"',
      character: '磐永阿梨夜',
      bgm: '最后一人也早已习惯 ~ Stone Goddess',
      prototype: '特定3D模型实例化',
      spatialForm: '地质层理 / 结晶化石感',
      visualHighlight: '晶簇结晶, 岩层裂隙或静态凝固的琥珀弹幕收尾.',
      implemented: false,
    },
  },
];

export function getImplementedSpellIds(): string[] {
  return SPELL_REGISTRY.filter((e) => e.metadata.implemented && e.factory).map((e) => e.metadata.id);
}

export function createSpellById(id: string): SpellCardInstance {
  const entry = SPELL_REGISTRY.find((item) => item.metadata.id === id);
  if (!entry || !entry.factory) {
    throw new Error(`Spell card "${id}" is not implemented yet.`);
  }
  return entry.factory();
}
