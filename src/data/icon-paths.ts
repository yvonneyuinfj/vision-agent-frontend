import type { IconName } from './types';

/**
 * 全站线性图标的 SVG 内部路径(24x24 viewBox)。
 * 由原 data.js 的 paths 迁移而来。
 */
export const iconPaths: Record<IconName, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  scan: '<path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4"/><circle cx="12" cy="12" r="4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6m-6 4h6"/>',
  book: '<path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5m-9 5v10m-4-17 9 5"/>',
  wrench: '<path d="M14 3a6 6 0 0 0-6 7L3 15a3 3 0 0 0 4 4l5-5a6 6 0 0 0 7-8l-4 4-3-3 4-4Z"/>',
  settings: '<path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4m-2-2h4"/>',
  paperclip: '<path d="m9 14 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L14 3m-4 12 7-7"/>',
  design: '<path d="m3 18 15-15 3 3L6 21H3Zm8-13 8 8M6 9l3 3m3 3 3 3"/>',
  factory: '<path d="M3 21V10l6 4V8l6 4V3h5v18Zm4-3h1m4 0h1m4 0h1"/>',
  inspect: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  assembly: '<path d="m8 3 4 3v5l-4 3-4-3V6Zm8 7 4 3v5l-4 3-4-3v-5ZM8 6v5m8 2v5"/>',
  test: '<path d="M4 19a9 9 0 1 1 16 0Zm8-6 5-5M6 12H4m8-6V4m6 8h2"/><circle cx="12" cy="13" r="1.5"/>',
  material: '<path d="M9 3h6m-5 0v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10"/>',
  shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4a7 7 0 1 0 9.5 9.5Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  heat: '<path d="M10 14V4a2 2 0 0 1 4 0v10a5 5 0 1 1-4 0Zm2-5v9m6-12h3m-3 4h2"/>',
  xray: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 7 8 10M16 7 8 17"/>',
  fracture: '<path d="M3 4h7l-3 6 4 3-4 7H3Zm18 0h-7l-3 6 4 3-4 7h10Z"/>',
  cells: '<path d="m7 3 4 2v5l-4 2-4-2V5Zm10 0 4 2v5l-4 2-4-2V5Zm-5 10 4 2v5l-4 2-4-2v-5Z"/>',
  report: '<path d="M5 2h9l5 5v15H5Zm9 0v6h5M8 12h8m-8 4h8m-8 3h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  play: '<polygon points="6,4 20,12 6,20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-5" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<path d="M12 3 2.2 20.2h19.6Z"/><path d="M12 10v4m0 3v.01"/>',
  download: '<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  /* ===== 七大领域专属图标(航空发动机主题重设计) ===== */
  // 设计仿真:翼型剖面 + 气流流线(CFD)
  'engine-design':
    '<path d="M4 14c4-6 12-6 16-2-4 1.5-11 4-15 3-1-.3-1.6-2.4-1-4z"/><path d="M3 5.5c5-2 12-2 18 0"/><path d="M3 3c5-2 12-2 18 0"/>',
  // 加工制造:CNC 立铣刀 + 工件铣槽
  'engine-manufacturing':
    '<path d="M9 3h6v3.5H9z"/><path d="M10.5 6.5v6.5l1.5 2.5 1.5-2.5v-6.5"/><path d="M4 15.5h16v4H4z"/><path d="M7 14l-1.6-1.1M17 14l1.6-1.1"/>',
  // 检验检测:放大镜 + 内部裂纹(缺陷检出)
  'engine-inspection':
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M7.5 12l1.6-2.2 1.6 1.6L12.5 9"/>',
  // 装配:六角螺母 + 中心孔(模块紧固)
  'engine-assembly':
    '<path d="M12 4 18.9 8 18.9 16 12 20 5.1 16 5.1 8Z"/><circle cx="12" cy="12" r="4"/>',
  // 试验:试验台仪表表盘 + 指针
  'engine-testing':
    '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M4 19.5h16"/><path d="M12 15.6L15.8 10.4"/><circle cx="12" cy="17" r="1.2"/><path d="M12 8.6v1.3M6.7 10.8l.9.9M17.3 10.8l-.9.9"/>',
  // 材料设计与加工:晶体点阵(单晶高温合金微观组织)
  'engine-materials':
    '<path d="M5 5h14v14H5z"/><path d="M12 5v14M5 12h14"/><circle cx="5" cy="5" r="1.3"/><circle cx="19" cy="5" r="1.3"/><circle cx="5" cy="19" r="1.3"/><circle cx="19" cy="19" r="1.3"/>',
  // 运维和保障:盾牌 + 风扇面(发动机健康保障)
  'engine-maintenance':
    '<path d="M12 3l7 2.6v5.3c0 4.6-3 7.6-7 9.1-4-1.5-7-4.5-7-9.1V5.6z"/><circle cx="12" cy="10.5" r="3.4"/><circle cx="12" cy="10.5" r="1"/><path d="M12 7.4v1.2M12 12.4v1.2M8.9 10.5h1.2M14 10.5h1.2"/>',
};

export const iconPath = (name: string): string => iconPaths[name as IconName] ?? iconPaths.grid;
