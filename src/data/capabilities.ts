import type { GeneralCapability, ProfessionalCapability } from './types';

/** 首页能力缩略图的精灵图横向裁剪位置(px,基于 1502px 宽的参考图) */
export const capabilityCropX = [354, 570, 785, 1000, 1216, 1432];

export const capabilities: ProfessionalCapability[] = [
  {
    id: 'fluorescence', name: '荧光渗透', icon: 'sun',
    desc: '表面开口缺陷识别与定位', domains: ['IT'],
    color: '#805ce4', bg: '#f0eaff',
    input: '荧光单图；批量任务由平台组织',
    result: '缺陷框、置信度、标注图',
    flow: ['图像校验', '缺陷检测', '专业复核', '检测报告'],
    prompt: '对涡轮叶片荧光渗透图像进行缺陷检测',
    image: '/assets/cap-fpi.png',
  },
  {
    id: 'borescope', name: '孔探', icon: 'target',
    desc: '叶片识别与损伤定位', domains: ['OM', 'IT'],
    color: '#2e8bcb', bg: '#e7f5ff',
    input: '孔探单图；本期不强制视频流',
    result: '叶片类别、损伤类别与位置',
    flow: ['图像提交', '叶片识别', '损伤检测', '复核与报告'],
    prompt: '对孔探图像进行叶片识别与损伤定位',
    image: '/assets/cap-borescope.png',
  },
  {
    id: 'thermal', name: '热部图像', icon: 'heat',
    desc: '试验图像分析与异常识别', domains: ['TS'],
    color: '#d1704b', bg: '#fff0e7',
    input: '多图与时间顺序；专业对象需冻结',
    result: '按最终确认的业务对象定义结果',
    flow: ['多图提交', '输入确认', '专业检测', '复核与报告'],
    prompt: '分析热部试验图像中的异常情况',
    image: '/assets/cap-infrared.png',
  },
  {
    id: 'xray', name: 'X 射线', icon: 'xray',
    desc: '试验结构识别与二维位移测量', domains: ['TS'],
    color: '#b28a2c', bg: '#fff7e2',
    input: '2–20 个 OPI 文件，明确参考与目标状态',
    result: '关键结构、关键点、二维位移',
    flow: ['成组文件', '状态对应', '结构与位移', '复核与报告'],
    prompt: '分析X射线OPI文件，比较参考状态与目标状态的二维位移',
    image: '/assets/cap-dr.png',
  },
  {
    id: 'fracture', name: '断口', icon: 'fracture',
    desc: '断口形貌分类与疲劳分析', domains: ['MT', 'IT'],
    color: '#657994', bg: '#edf1f7',
    input: '断口图像；依形貌选择适用分析分支',
    result: '形貌分类；适用疲劳图像可做分割与测量',
    flow: ['形貌分类', '适用分支', '定量分析', '复核与报告'],
    prompt: '对断口图像进行形貌分类和适用的疲劳分析',
    image: '/assets/cap-fracture.png',
  },
  {
    id: 'metallography', name: '金相', icon: 'cells',
    desc: '组织分割与定量统计', domains: ['MT', 'IT'],
    color: '#358c75', bg: '#e8f6f0',
    input: '显微组织图像，确认像素标定与前景相',
    result: '面积分数、颗粒尺寸与通道宽度',
    flow: ['标定确认', '组织分割', '定量统计', '复核与报告'],
    prompt: '对金相显微组织图像进行定量分析',
    image: '/assets/cap-metallography.png',
  },
];

export const generalCapabilities: GeneralCapability[] = [
  {
    id: 'ocr', name: 'OCR 识别', icon: 'scan', en: 'TEXT RECOGNITION',
    desc: '提取图片与扫描文档中的文字和表格，整理为可编辑内容。',
    input: '图片、扫描版 PDF',
    result: '可编辑文本、表格内容与识别结果',
    flow: ['导入资料', '识别版面', '文字与表格提取', '校对导出'],
    prompt: '识别资料中的文字和表格',
    tags: ['文字提取', '表格识别', '版面分析'],
  },
  {
    id: 'ppt', name: 'PPT 制作', icon: 'report', en: 'PRESENTATION AGENT',
    desc: '围绕主题与参考资料组织汇报结构，生成可编辑的演示文稿。',
    input: '主题说明、文档资料、参考模板',
    result: '汇报大纲、页面内容与演示文稿',
    flow: ['明确主题', '确认大纲', '组织页面', '审阅导出'],
    prompt: '根据参考资料制作一份汇报PPT',
    tags: ['大纲编排', '页面生成', '模板适配'],
  },
];
