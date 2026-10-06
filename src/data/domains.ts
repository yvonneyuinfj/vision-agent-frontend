import type { Domain } from './types';

/** 七大业务领域英文标识(领域卡片副标题) */
export const domainNames: Record<string, string> = {
  DS: 'DESIGN',
  MF: 'MANUFACTURING',
  IT: 'INSPECTION',
  AS: 'ASSEMBLY',
  TS: 'TESTING',
  MT: 'MATERIALS',
  OM: 'MAINTENANCE',
};

export const domains: Domain[] = [
  {
    id: 'DS', name: '设计仿真', full: '设计仿真', icon: 'engine-design',
    desc: '全量判读、报告自动化与研发迭代',
    plans: [
      { title: 'CFD 流场结果智能判读', desc: '流场特征识别与结果辅助解读。', icon: 'design' },
      { title: '传热仿真热点识别', desc: '热点区域定位与温度分布分析。', icon: 'heat' },
      { title: '结构仿真危险部位筛选', desc: '高应力区域识别与重点部位筛查。', icon: 'box' },
    ],
    count: 14,
  },
  {
    id: 'MF', name: '加工制造', full: '加工制造', icon: 'engine-manufacturing',
    desc: '在线全检、过程透视与制造质量受控',
    plans: [
      { title: '叶片型面加工在线测量', desc: '型面轮廓在线测量与偏差监控。', icon: 'target' },
      { title: '叶片表面缺陷检测', desc: '表面缺陷在线检出与分级预警。', icon: 'scan' },
      { title: '榫头 / 榫槽轮廓度检测', desc: '榫接部位轮廓度合规判定。', icon: 'inspect' },
    ],
    count: 22,
  },
  {
    id: 'IT', name: '检验检测', full: '检验检测', icon: 'engine-inspection',
    desc: '专业检测、结果复核与质量依据追溯',
    plans: [
      { title: 'CT 三维缺陷智能提取', desc: '内部缺陷三维定位与量化提取。', icon: 'xray' },
      { title: '增材制造件 CT 判读', desc: '孔隙 / 未熔合等缺陷智能判读。', icon: 'cells' },
    ],
    count: 26,
  },
  {
    id: 'AS', name: '装配', full: '装配', icon: 'engine-assembly',
    desc: '防错防呆防遗漏与装配过程追溯',
    plans: [
      { title: '零部件型号防错核对', desc: '装配件型号与位置防错校验。', icon: 'shield' },
      { title: '螺栓装配状态检测', desc: '螺栓拧紧与缺失状态识别。', icon: 'wrench' },
      { title: '保险丝 / 锁片安装检测', desc: '保险丝与锁片安装到位检测。', icon: 'check' },
    ],
    count: 18,
  },
  {
    id: 'TS', name: '零部件与整机试验', full: '零部件与整机试验', icon: 'engine-testing',
    desc: '试验图像分析与瞬态证据提取',
    plans: [
      { title: '超转 / 破裂试验高速影像分析', desc: '高速影像关键帧提取与破坏分析。', icon: 'play' },
      { title: '包容试验碎片轨迹分析', desc: '碎片轨迹追踪与包容性评估。', icon: 'target' },
      { title: '鸟撞 / 落冰试验影像分析', desc: '冲击过程影像与损伤评估。', icon: 'alert' },
    ],
    count: 16,
  },
  {
    id: 'MT', name: '材料设计与加工', full: '材料设计与加工', icon: 'engine-materials',
    desc: '定量金相、失效分析与材料知识沉淀',
    plans: [
      { title: 'EBSD 取向成像分析', desc: '晶粒取向成像与组织定量分析。', icon: 'material' },
      { title: '材料工艺与组织关联分析', desc: '工艺-组织-性能关联挖掘。', icon: 'cells' },
    ],
    count: 15,
  },
  {
    id: 'OM', name: '运维和保障', full: '运维和保障', icon: 'engine-maintenance',
    desc: '孔探损伤判读与历史检查对比',
    plans: [
      { title: '孔探视频结构化', desc: '孔探视频损伤标注与结构化归档。', icon: 'scan' },
      { title: '历次检查对比分析', desc: '跨周期损伤演变趋势对比。', icon: 'clock' },
      { title: '维修知识问答', desc: '维修手册与案例智能问答。', icon: 'book' },
    ],
    count: 14,
  },
];
