import type { SpellCardInstance, SpellMetadata } from './types';
import { TH06_METADATA, TH06TheWorldSpell } from './th06-the-world';
import { TH07_METADATA, TH07SaigyoujiParinirvanaSpell } from './th07-saigyouji-parinirvana';
import { TH08_METADATA, TH08AstronomicalEntombingSpell } from './th08-astronomical-entombing';
import { TH09_METADATA, TH09FloweringGensokyoSpell } from './th09-flowering-gensokyo';
import { TH10_METADATA, TH10MountainOfFaithSpell } from './th10-mountain-of-faith';
import { TH11_METADATA, TH11SubterraneanSunSpell } from './th11-subterranean-sun';
import { TH12_METADATA, TH12DevilsRecitationSpell } from './th12-devils-recitation';
import { TH13_METADATA, TH13SeventeenLasersSpell } from './th13-seventeen-lasers';
import { TH14_METADATA, TH14ThisSideDownSpell } from './th14-this-side-down';
import { TH15_METADATA, TH15PristineDanmakuHellSpell } from './th15-pristine-danmaku-hell';
import { TH16_METADATA, TH16HiddenGodSpell } from './th16-hidden-god';
import { TH17_METADATA, TH17GeometricCreatureSpell } from './th17-geometric-creature';
import { TH18_METADATA, TH18RainbowRingSpell } from './th18-rainbow-ring';
import { TH19_METADATA, TH19KingdomOfNothingnessSpell } from './th19-kingdom-of-nothingness';
import { TH20_METADATA, TH20DanmakuFossilSpell } from './th20-danmaku-fossil';

export interface SpellRegistryEntry {
  metadata: SpellMetadata;
  factory: () => SpellCardInstance;
}

/**
 * Complete TH06 - TH20 Mainline Touhou 3D Spell Card Anthology (All 15 Implemented!).
 */
export const SPELL_REGISTRY: SpellRegistryEntry[] = [
  { metadata: TH06_METADATA, factory: () => new TH06TheWorldSpell() },
  { metadata: TH07_METADATA, factory: () => new TH07SaigyoujiParinirvanaSpell() },
  { metadata: TH08_METADATA, factory: () => new TH08AstronomicalEntombingSpell() },
  { metadata: TH09_METADATA, factory: () => new TH09FloweringGensokyoSpell() },
  { metadata: TH10_METADATA, factory: () => new TH10MountainOfFaithSpell() },
  { metadata: TH11_METADATA, factory: () => new TH11SubterraneanSunSpell() },
  { metadata: TH12_METADATA, factory: () => new TH12DevilsRecitationSpell() },
  { metadata: TH13_METADATA, factory: () => new TH13SeventeenLasersSpell() },
  { metadata: TH14_METADATA, factory: () => new TH14ThisSideDownSpell() },
  { metadata: TH15_METADATA, factory: () => new TH15PristineDanmakuHellSpell() },
  { metadata: TH16_METADATA, factory: () => new TH16HiddenGodSpell() },
  { metadata: TH17_METADATA, factory: () => new TH17GeometricCreatureSpell() },
  { metadata: TH18_METADATA, factory: () => new TH18RainbowRingSpell() },
  { metadata: TH19_METADATA, factory: () => new TH19KingdomOfNothingnessSpell() },
  { metadata: TH20_METADATA, factory: () => new TH20DanmakuFossilSpell() },
];

export function getImplementedSpellIds(): string[] {
  return SPELL_REGISTRY.filter((e) => e.metadata.implemented).map((e) => e.metadata.id);
}

export function createSpellById(id: string): SpellCardInstance {
  const entry = SPELL_REGISTRY.find((item) => item.metadata.id === id);
  if (!entry) {
    throw new Error(`Spell card "${id}" not found.`);
  }
  return entry.factory();
}
