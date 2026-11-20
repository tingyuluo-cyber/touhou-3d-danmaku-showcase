请将 15 首东方正作原曲放入当前目录 (支持 .mp3 / .wav / .flac / .ogg / .m4a):

推荐文件命名 (只要文件名以 TH06 - TH20 开头即可自动识别, 后面可保留原曲名):
  TH06_月时钟.mp3          (或 TH06.flac)
  TH07_BorderOfLife.mp3
  TH08_千年幻想乡.mp3
  TH09_今昔幻想乡.mp3
  TH10_神圣庄严的古战场.mp3
  TH11_灵知的太阳信仰.mp3
  TH12_感情的摩天楼.mp3
  TH13_圣德传说.mp3
  TH14_ReverseIdeology.mp3
  TH15_PureFuries.mp3
  TH16_秘神摩多罗.mp3
  TH17_IdoratrizeWorld.mp3
  TH18_热闹的市场.mp3
  TH19_亡羊的王国.mp3
  TH20_StoneGoddess.mp3

放入后在项目根目录运行:
  pnpm run audio:build

脚本会自动使用本机 FFmpeg 完成:
  1. 全曲 -14 LUFS 响度标准化 (统一 TH06-TH20 跨年代音量)
  2. 按 src/audio/cueSheet.json 截取每首代表段落到 public/audio/clips/THxx.mp3 供网页实时对轨
  3. 带柔和混响尾音/干净转场桥拼接出完整总音轨 public/audio/master_mix.mp3
