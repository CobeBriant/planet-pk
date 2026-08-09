/**
 * 天体数据库 — 真实天文数据
 * 数据来源: NASA, ESA, Wikipedia 天文条目
 * radius: 半径 (km)
 * mass: 质量 (kg)
 * category: 难度分级 (planet/moon/star/galaxy/blackhole)
 */

const CELESTIAL_DATA = [
  // ========== 行星 (难度: 简单) ==========
  { id: 'mercury', name: '水星', nameEn: 'Mercury', category: 'planet',
    radius: 2439.7, mass: 3.3011e23, color: '#8C7853',
    desc: '太阳系最小的行星，表面布满陨石坑，白天热到430°C！' },
  { id: 'mars', name: '火星', nameEn: 'Mars', category: 'planet',
    radius: 3389.5, mass: 6.4171e23, color: '#CD5C5C',
    desc: '红色的星球，因为土壤里有很多铁锈。人类正在计划去火星探险！' },
  { id: 'venus', name: '金星', nameEn: 'Venus', category: 'planet',
    radius: 6051.8, mass: 4.8675e24, color: '#FFC649',
    desc: '太阳系最热的行星，表面温度465°C，比水星还热！' },
  { id: 'earth', name: '地球', nameEn: 'Earth', category: 'planet',
    radius: 6371.0, mass: 5.972e24, color: '#4A90D9',
    desc: '我们的家园！唯一已知有生命存在的星球，71%被海洋覆盖。' },
  { id: 'neptune', name: '海王星', nameEn: 'Neptune', category: 'planet',
    radius: 24622, mass: 1.024e26, color: '#4166F5',
    desc: '太阳系最远的行星，风速可达2100公里/小时，是地球最强风暴的5倍！' },
  { id: 'uranus', name: '天王星', nameEn: 'Uranus', category: 'planet',
    radius: 25362, mass: 8.681e25, color: '#AFEEEE',
    desc: '侧着身子转的行星，它的自转轴几乎平躺在轨道平面上！' },
  { id: 'saturn', name: '土星', nameEn: 'Saturn', category: 'planet',
    radius: 58232, mass: 5.683e26, color: '#FAD5A5',
    desc: '戴着漂亮光环的行星！光环主要由冰块和岩石碎片组成。' },
  { id: 'jupiter', name: '木星', nameEn: 'Jupiter', category: 'planet',
    radius: 69911, mass: 1.898e27, color: '#C88B3A',
    desc: '太阳系最大的行星！大红斑是一个比地球还大的风暴，已经刮了300多年。' },

  // ========== 矮行星 ==========
  { id: 'pluto', name: '冥王星', nameEn: 'Pluto', category: 'planet',
    radius: 1188.3, mass: 1.303e22, color: '#C0A080',
    desc: '曾经是第九大行星，现在被归类为矮行星。它的表面有心形图案！' },
  { id: 'ceres', name: '谷神星', nameEn: 'Ceres', category: 'planet',
    radius: 469.7, mass: 9.393e20, color: '#A09080',
    desc: '小行星带中最大的天体，也是离太阳最近的矮行星。' },

  // ========== 卫星 ==========
  { id: 'moon', name: '月球', nameEn: 'Moon', category: 'moon',
    radius: 1737.4, mass: 7.342e22, color: '#C0C0C0',
    desc: '地球唯一的天然卫星，正在以每年3.8厘米的速度远离地球。' },
  { id: 'europa', name: '木卫二', nameEn: 'Europa', category: 'moon',
    radius: 1560.8, mass: 4.7998e22, color: '#D4A574',
    desc: '木星的卫星，表面覆盖厚厚的冰层，冰下可能有一个巨大的海洋！' },
  { id: 'io', name: '木卫一', nameEn: 'Io', category: 'moon',
    radius: 1821.6, mass: 8.929e22, color: '#E0D060',
    desc: '太阳系火山最多的天体，有400多座活火山！' },
  { id: 'callisto', name: '木卫四', nameEn: 'Callisto', category: 'moon',
    radius: 2410.3, mass: 1.0759e23, color: '#806040',
    desc: '木星的第二大卫星，表面陨石坑密度是太阳系最高的。' },
  { id: 'ganymede', name: '木卫三', nameEn: 'Ganymede', category: 'moon',
    radius: 2634.1, mass: 1.4819e23, color: '#9B8B7A',
    desc: '太阳系最大的卫星！比水星还大，还有自己的磁场。' },
  { id: 'titan', name: '土卫六', nameEn: 'Titan', category: 'moon',
    radius: 2574.7, mass: 1.3452e23, color: '#E09B30',
    desc: '太阳系唯一有浓厚大气层的卫星，表面有甲烷河流和湖泊！' },
  { id: 'triton', name: '海卫一', nameEn: 'Triton', category: 'moon',
    radius: 1353.4, mass: 2.14e22, color: '#A0B0D0',
    desc: '海王星最大的卫星，它是逆行轨道——和其他卫星方向相反！' },

  // ========== 恒星 (难度: 中等) ==========
  { id: 'sun', name: '太阳', nameEn: 'Sun', category: 'star',
    radius: 696340, mass: 1.989e30, color: '#FFD700',
    desc: '我们的恒星！每秒钟将6亿吨氢聚变成氦，已经燃烧了46亿年。' },
  { id: 'sirius_a', name: '天狼星A', nameEn: 'Sirius A', category: 'star',
    radius: 1192000, mass: 2.063e30, color: '#A4C8FF',
    desc: '夜空中最亮的恒星，比太阳亮25倍，距地球8.6光年。' },
  { id: 'pollux', name: '北河三', nameEn: 'Pollux', category: 'star',
    radius: 5988000, mass: 1.79e30, color: '#FFAA44',
    desc: '双子座最亮的恒星，是一颗橙色巨星，比太阳大9倍。' },
  { id: 'arcturus', name: '大角星', nameEn: 'Arcturus', category: 'star',
    radius: 17808000, mass: 1.08e30, color: '#FF8C00',
    desc: '北半球夜空中最亮的恒星，是一颗红色巨星，比太阳亮170倍。' },
  { id: 'aldebaran', name: '毕宿五', nameEn: 'Aldebaran', category: 'star',
    radius: 30589600, mass: 1.16e30, color: '#FF7F50',
    desc: '金牛座最亮的恒星，是一颗橙色巨星，直径是太阳的44倍。' },
  { id: 'rigel', name: '参宿七', nameEn: 'Rigel A', category: 'star',
    radius: 54762600, mass: 2.1e31, color: '#B0C4FF',
    desc: '猎户座最亮的恒星，蓝超巨星，比太阳亮12万倍！' },
  { id: 'antares', name: '心宿二', nameEn: 'Antares', category: 'star',
    radius: 419040000, mass: 1.2e31, color: '#FF4500',
    desc: '天蝎座最亮的恒星，红超巨星，如果放在太阳的位置会吞没火星！' },
  { id: 'betelgeuse', name: '参宿四', nameEn: 'Betelgeuse', category: 'star',
    radius: 617180000, mass: 1.17e31, color: '#FF6347',
    desc: '猎户座的红超巨星，直径是太阳的887倍，随时可能发生超新星爆发！' },
  { id: 'uy_scuti', name: 'UY Scuti', nameEn: 'UY Scuti', category: 'star',
    radius: 1188360000, mass: 5.7e31, color: '#FF6644',
    desc: '已知最大的恒星之一！如果放在太阳的位置，边缘会到达木星轨道！' },

  // ========== 星系/黑洞 (难度: 困难) ==========
  { id: 'sgr_a', name: '人马座A*', nameEn: 'Sagittarius A*', category: 'blackhole',
    radius: 12000000, mass: 8.55e36, color: '#1a1a2e',
    desc: '银河系中心的超大质量黑洞，质量是太阳的400万倍！' },
  { id: 'm87', name: 'M87黑洞', nameEn: 'M87 Black Hole', category: 'blackhole',
    radius: 19000000000, mass: 1.2768e40, color: '#0a0a1a',
    desc: '人类第一张拍到的黑洞照片！2019年发布的，质量是太阳的65亿倍！' },
  { id: 'ton618', name: 'TON 618', nameEn: 'TON 618', category: 'blackhole',
    radius: 130300000000, mass: 1.33e41, color: '#000000',
    desc: '已知最大的黑洞之一！质量是太阳的660亿倍，是宇宙中的巨兽！' },
  { id: 'milky_way', name: '银河系', nameEn: 'Milky Way', category: 'galaxy',
    radius: 52884600000000000, mass: 1.5e42, color: '#C0C0FF',
    desc: '我们的家园星系！包含约2000亿颗恒星，太阳只是其中普通的一颗。' },
  { id: 'andromeda', name: '仙女座星系', nameEn: 'Andromeda', category: 'galaxy',
    radius: 110000000000000000, mass: 2.0e42, color: '#B0B0FF',
    desc: '离银河系最近的大型星系，约45亿年后会和银河系碰撞合并！' },
  { id: 'ic1101', name: 'IC 1101', nameEn: 'IC 1101', category: 'galaxy',
    radius: 2000000000000000000, mass: 4.0e43, color: '#A0A0E0',
    desc: '已知最大的星系！直径约600万光年，是银河系的50倍大！' },
];

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CELESTIAL_DATA;
}
