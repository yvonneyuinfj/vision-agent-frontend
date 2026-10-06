/** 全站可用的线性图标名(对应 icon-paths 中的键) */
export type IconName =
  | 'home' | 'scan' | 'grid' | 'clipboard' | 'book' | 'box' | 'wrench'
  | 'spark' | 'paperclip' | 'design' | 'factory' | 'inspect' | 'assembly'
  | 'test' | 'material' | 'shield' | 'sun' | 'moon' | 'target' | 'heat' | 'xray'
  | 'fracture' | 'cells' | 'report' | 'settings' | 'user'
  | 'play' | 'clock' | 'check' | 'alert' | 'download'
  | 'engine-design' | 'engine-manufacturing' | 'engine-inspection' | 'engine-assembly'
  | 'engine-testing' | 'engine-materials' | 'engine-maintenance';

/** 领域代表性规划场景(带图标与描述,用于领域详情卡片) */
export interface DomainPlan {
  title: string;
  desc: string;
  icon: IconName;
}

/** 业务领域(全生命周期规划) */
export interface Domain {
  id: string;
  name: string;
  full: string;
  icon: IconName;
  desc: string;
  plans: DomainPlan[];
  count: number;
}

/** 专业能力(本期建设的检测能力；注册表驱动，id 为前端展示 id) */
export interface ProfessionalCapability {
  id: string;
  name: string;
  icon: IconName;
  desc: string;
  domains: string[];
  color: string;
  bg: string;
  input: string;
  result: string;
  flow: string[];
  prompt: string;
  image?: string;
  // ---- 注册表真实字段（接 /api/v1/capabilities 后回填；回退本地预设时缺省）----
  scene?: string;
  capability_id?: string;
  status?: 'enabled' | 'disabled' | 'maintenance';
  lifecycle_phase?: string;
  capability_type?: string;
  adapter_type?: string;
  endpoint?: string;
  tool_name?: string;
}

/** 通用能力 Agent(OCR / PPT) */
export interface GeneralCapability {
  id: 'ocr' | 'ppt';
  name: string;
  icon: IconName;
  en: string;
  desc: string;
  input: string;
  result: string;
  flow: string[];
  prompt: string;
  tags: string[];
}

export type AnyCapability = ProfessionalCapability | GeneralCapability;

/** 首页顶部导航名称 */
export type NavName =
  | '首页' | '智能检测' | '能力中心' | '任务中心'
  | '知识中心' | '模型工坊' | '工具服务中心' | '后台管理';

/** 模块弹窗的配置内容 */
export interface ModuleDialogConfig {
  eyebrow: string;
  intro: string;
  items: Array<[string, string]>;
  flow: string[];
}
