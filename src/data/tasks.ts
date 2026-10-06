/** 任务中心 · 本地演示数据(不接后端;数字与截图对齐) */

export type TaskStatus = 'done' | 'reviewing' | 'pending' | 'running' | 'failed';
export type ReportType = 'single' | 'joint' | 'agent';

export interface DetectionTask {
  id: string;
  kind?: 'inspection' | 'document'; // 任务类型：检测 / 文档生成（PPT）；缺省视作检测
  scene: string;            // 场景简称:荧光 / 孔探 / 热部 / X射线 / 断口 / 金相
  capabilityId: string;     // 对应 capabilities.id
  object: string;           // 业务对象
  status: TaskStatus;
  submitter: string;
  createdAt: string;        // MM-DD HH:mm
  reportType?: ReportType;  // 已出报告的任务才有
  imageCount?: number;      // 参与推理的输入图像数（真实接口 image_count）
}

export interface ReviewFinding {
  label: string;
  confidence: number;       // 0~1
  location: string;
  verdict: 'suspect' | 'confirmed' | 'dismissed';
}

export interface TaskResult {
  taskId: string;
  model: string;
  summary: string;
  findings: ReviewFinding[];
}

export interface FeedbackSample {
  id: string;
  sourceTask: string;
  scene: string;
  issue: string;
  status: '待标注' | '已标注' | '已入数据集';
  createdAt: string;
}

export const statusMeta: Record<TaskStatus, { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' | 'red' }> = {
  done: { label: '已完成', tone: 'green' },
  reviewing: { label: '复核中', tone: 'blue' },
  pending: { label: '待复核', tone: 'amber' },
  running: { label: '检测中', tone: 'blue' },
  failed: { label: '失败', tone: 'red' },
};

export const reportTypeLabel: Record<ReportType, string> = {
  single: '单场景报告',
  joint: '联合综合研判',
  agent: '智能体报告',
};

/** 场景 → 能力 id(用于取图标) */
export const sceneCapability: Record<string, string> = {
  荧光: 'fluorescence', 孔探: 'borescope', 热部: 'thermal',
  'X射线': 'xray', 断口: 'fracture', 金相: 'metallography',
};

/** 任务列表(含已出报告的 9 条 + 若干进行态,用于列表页展示状态分布) */
export const seedTasks: DetectionTask[] = [
  { id: 'T49743317020739909', scene: '荧光', capabilityId: 'fluorescence', object: '涡轮叶片 A 批 · #07', status: 'done', submitter: 'qadmin', createdAt: '09-30 16:49', reportType: 'agent' },
  { id: 'T29543793560095555', scene: '荧光', capabilityId: 'fluorescence', object: '涡轮叶片 A 批 · #12', status: 'done', submitter: 'qadmin', createdAt: '09-30 16:47', reportType: 'single' },
  { id: 'T34759581294958405', scene: '荧光', capabilityId: 'fluorescence', object: '导向器 · #03', status: 'done', submitter: 'qadmin', createdAt: '09-30 10:32', reportType: 'agent' },
  { id: 'T58868119538408525', scene: '荧光', capabilityId: 'fluorescence', object: '涡轮盘 · R-118', status: 'done', submitter: 'qadmin', createdAt: '09-29 22:31', reportType: 'single' },
  { id: 'T9384324169700429', scene: '荧光', capabilityId: 'fluorescence', object: '机匣 · C-22', status: 'done', submitter: 'qadmin', createdAt: '09-29 22:11', reportType: 'agent' },
  { id: 'T42198543335244877', scene: '断口', capabilityId: 'fracture', object: '断裂试件 · F-09', status: 'done', submitter: 'qadmin', createdAt: '09-23 11:30', reportType: 'single' },
  { id: 'T5913624116458452', scene: '荧光', capabilityId: 'fluorescence', object: '涡轮叶片 B 批 · #05', status: 'done', submitter: 'qadmin', createdAt: '09-20 16:56', reportType: 'agent' },
  { id: 'T6764220795393908', scene: '荧光', capabilityId: 'fluorescence', object: '压气机盘 · #14', status: 'done', submitter: 'qadmin', createdAt: '09-20 15:30', reportType: 'single' },
  { id: 'T71200934812773061', scene: '孔探', capabilityId: 'borescope', object: '一级叶片 · BS-31', status: 'done', submitter: 'qadmin', createdAt: '09-19 09:42', reportType: 'agent' },
  { id: 'T88301742095531277', scene: '热部', capabilityId: 'thermal', object: '燃烧室 · TH-07', status: 'pending', submitter: 'qadmin', createdAt: '10-01 09:15' },
  { id: 'T15590283746120933', scene: 'X射线', capabilityId: 'xray', object: '焊缝试件 · XR-12', status: 'reviewing', submitter: 'qadmin', createdAt: '10-01 08:50' },
  { id: 'T60017324859102274', scene: '金相', capabilityId: 'metallography', object: '母材试样 · MG-04', status: 'running', submitter: 'qadmin', createdAt: '10-01 08:20' },
  { id: 'T23984710572843016', scene: '断口', capabilityId: 'fracture', object: '疲劳试件 · F-15', status: 'failed', submitter: 'qadmin', createdAt: '09-30 20:05' },
];

/** 结果复核:按任务给出演示检测结论(仅覆盖待复核 / 复核中的任务) */
export const seedResults: Record<string, TaskResult> = {
  T88301742095531277: {
    taskId: 'T88301742095531277',
    model: '热部图像分析 v1.3',
    summary: '共 6 帧热部试验图像,识别到 2 处温度异常区,建议人工确认是否涂层脱落导致。',
    findings: [
      { label: '局部高温异常', confidence: 0.86, location: '帧 3 · 区域 (412,180)', verdict: 'suspect' },
      { label: '纹理连续性中断', confidence: 0.71, location: '帧 5 · 区域 (220,360)', verdict: 'suspect' },
      { label: '边缘正常过渡', confidence: 0.32, location: '帧 1 · 区域 (60,90)', verdict: 'dismissed' },
    ],
  },
  T15590283746120933: {
    taskId: 'T15590283746120933',
    model: 'X 射线 OPI 位移测量 v2.0',
    summary: '参考态与目标态比对完成,关键点最大二维位移 1.84 px,结构识别无缺漏。',
    findings: [
      { label: '气孔', confidence: 0.91, location: '关键点 K7 · (508,240)', verdict: 'confirmed' },
      { label: '未熔合迹象', confidence: 0.64, location: '关键点 K12 · (300,410)', verdict: 'suspect' },
    ],
  },
};

/** 反馈样本管理:问题样本回流清单 */
export const seedSamples: FeedbackSample[] = [
  { id: 'S-2026-0142', sourceTask: 'T23984710572843016', scene: '断口', issue: '形貌分类误判为韧性断裂', status: '待标注', createdAt: '09-30 20:12' },
  { id: 'S-2026-0138', sourceTask: 'T9384324169700429', scene: '荧光', issue: '弱显示缺陷漏检', status: '已标注', createdAt: '09-29 22:30' },
  { id: 'S-2026-0131', sourceTask: 'T71200934812773061', scene: '孔探', issue: '叶片编号识别偏移', status: '已入数据集', createdAt: '09-19 10:02' },
  { id: 'S-2026-0127', sourceTask: 'T42198543335244877', scene: '断口', issue: '疲劳条纹边界不清晰', status: '已标注', createdAt: '09-23 12:00' },
  { id: 'S-2026-0119', sourceTask: 'T58868119538408525', scene: '荧光', issue: '背景噪点触发虚检', status: '已入数据集', createdAt: '09-29 23:00' },
];
