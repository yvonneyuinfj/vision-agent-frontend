import type { IconName } from './types';

/** 专业能力「展示预设」：按后端 scene（路由键）索引。
 *  注册表只承载 capability_id/name/scene/lifecycle_phase/... 等运行字段，
 *  图标/配色/输入输出/流程/提示词属展示层，集中在此维护；
 *  后端新增未预置的 scene 时，由 use-capabilities 走通用兜底。 */
export interface CapabilityPreset {
  id: string;                 // 前端能力 id（沿用旧命名，兼容详情/配置逻辑）
  name: string;               // 展示名（live 模式由注册表 name 覆盖；回退用此值）
  icon: IconName;
  color: string;
  bg: string;
  domains: string[];
  desc: string;
  input: string;
  result: string;
  flow: string[];
  prompt: string;
  image?: string;             // 专业大图（/assets/cap-*.png）；未预置场景为空，视图回退旧精灵图
}

export const capabilityPresets: Record<string, CapabilityPreset> = {
  fpi: {
    id: 'fluorescence', name: '荧光渗透', icon: 'sun', color: '#805ce4', bg: '#f0eaff', domains: ['IT'],
    desc: '表面开口缺陷识别与定位',
    input: '荧光单图；批量任务由平台组织',
    result: '缺陷框、置信度、标注图',
    flow: ['图像校验', '缺陷检测', '专业复核', '检测报告'],
    prompt: '对涡轮叶片荧光渗透图像进行缺陷检测',
    image: '/assets/cap-fpi.png',
  },
  borescope: {
    id: 'borescope', name: '孔探', icon: 'target', color: '#2e8bcb', bg: '#e7f5ff', domains: ['OM', 'IT'],
    desc: '叶片识别与损伤定位',
    input: '孔探单图；本期不强制视频流',
    result: '叶片类别、损伤类别与位置',
    flow: ['图像提交', '叶片识别', '损伤检测', '复核与报告'],
    prompt: '对孔探图像进行叶片识别与损伤定位',
    image: '/assets/cap-borescope.png',
  },
  infrared: {
    id: 'thermal', name: '热部图像', icon: 'heat', color: '#d1704b', bg: '#fff0e7', domains: ['TS'],
    desc: '试验图像分析与异常识别',
    input: '多图与时间顺序；专业对象需冻结',
    result: '按最终确认的业务对象定义结果',
    flow: ['多图提交', '输入确认', '专业检测', '复核与报告'],
    prompt: '分析热部试验图像中的异常情况',
    image: '/assets/cap-infrared.png',
  },
  dr: {
    id: 'xray', name: 'X 射线', icon: 'xray', color: '#b28a2c', bg: '#fff7e2', domains: ['TS'],
    desc: '试验结构识别与二维位移测量',
    input: '2–20 个 OPI 文件，明确参考与目标状态',
    result: '关键结构、关键点、二维位移',
    flow: ['成组文件', '状态对应', '结构与位移', '复核与报告'],
    prompt: '分析X射线OPI文件，比较参考状态与目标状态的二维位移',
    image: '/assets/cap-dr.png',
  },
  fracture: {
    id: 'fracture', name: '断口', icon: 'fracture', color: '#657994', bg: '#edf1f7', domains: ['MT', 'IT'],
    desc: '断口形貌分类与疲劳分析',
    input: '断口图像；依形貌选择适用分析分支',
    result: '形貌分类；适用疲劳图像可做分割与测量',
    flow: ['形貌分类', '适用分支', '定量分析', '复核与报告'],
    prompt: '对断口图像进行形貌分类和适用的疲劳分析',
    image: '/assets/cap-fracture.png',
  },
  metallography: {
    id: 'metallography', name: '金相', icon: 'cells', color: '#358c75', bg: '#e8f6f0', domains: ['MT', 'IT'],
    desc: '组织分割与定量统计',
    input: '显微组织图像，确认像素标定与前景相',
    result: '面积分数、颗粒尺寸与通道宽度',
    flow: ['标定确认', '组织分割', '定量统计', '复核与报告'],
    prompt: '对金相显微组织图像进行定量分析',
    image: '/assets/cap-metallography.png',
  },
  weld: {
    id: 'weld', name: '焊缝检测', icon: 'wrench', color: '#0f766e', bg: '#e6f4f1', domains: ['MF', 'IT'],
    desc: '焊缝/钎焊缺陷识别与判级',
    input: '焊缝/钎焊区域图像；成批由平台组织',
    result: '缺陷类型、位置与置信度、标注图',
    flow: ['图像校验', '焊缝检测', '缺陷判级', '复核与报告'],
    prompt: '对焊缝/钎焊图像进行缺陷检测与判级',
  },
  assembly: {
    id: 'assembly', name: '装配 FOD', icon: 'shield', color: '#475569', bg: '#eef2f7', domains: ['AS'],
    desc: '错漏装与多余物 FOD 识别',
    input: '装配现场/零部件图像；按工位组织',
    result: '错漏装与多余物 FOD 位置提示',
    flow: ['图像提交', '装配核对', 'FOD 识别', '复核与记录'],
    prompt: '检查装配图像中的错漏装与多余物 FOD',
  },
};

/** 通用兜底预设：注册表出现未预置 scene 时使用（配色按生命周期阶段区分）。 */
export function fallbackPreset(scene: string, phase: string | undefined): CapabilityPreset {
  const phaseColor: Record<string, [string, string]> = {
    design: ['#6366f1', '#eef0fe'], manufacturing: ['#0f766e', '#e6f4f1'],
    assembly: ['#475569', '#eef2f7'], testing: ['#d1704b', '#fff0e7'],
    in_service: ['#2e8bcb', '#e7f5ff'], maintenance: ['#657994', '#edf1f7'],
    retirement: ['#94a3b8', '#f1f5f9'],
  };
  const [color, bg] = phaseColor[phase ?? ''] ?? ['#2368e4', '#edf4ff'];
  return {
    id: scene, name: scene, icon: 'box', color, bg, domains: ['IT'],
    desc: '专业图像检测能力',
    input: '图像输入（详见算法工具规范）',
    result: '检测结果（缺陷/测量/分类）',
    flow: ['图像提交', '算法推理', '结果标准化', '复核与报告'],
    prompt: `对该场景图像执行专业检测`,
  };
}
