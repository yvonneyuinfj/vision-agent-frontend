/** 知识中心 · 本地演示数据(模拟 RAGFlow 检索,不接后端) */

export interface KnowledgeBase {
  id: string;
  name: string;
  docs: number;
}

/** 知识库文本块(检索命中的最小单元) */
export interface KbChunk {
  id: string;
  kbId: string;
  title: string;
  text: string;
  keywords: string[];
}

export interface TraceItem {
  chunkId: string;
  source: string;   // 知识库 / 文档
  snippet: string;
  score: number;    // 相关度 0~1
}

export interface KbMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: number;
  trace?: TraceItem[];
}

export interface KbSession {
  id: string;
  title: string;
  createdAt: number;
  messages: KbMessage[];
  /** 远程模式下对应的 RAGFlow conversation id */
  rfId?: string;
}

/** 入库资料(资料入库页) */
export interface IngestDoc {
  id: string;
  name: string;
  kbId: string;
  type: string;         // PDF / Word / 图片 …
  size: string;
  status: '已解析' | '解析中' | '索引中' | '待入库';
  updatedAt: string;
  /** 资料归类(演示用;远程无此字段时回退知识库名) */
  category?: string;
}

/** 当前激活知识库(截图右上角) */
export const activeKbId = 'ad1b9076afdd1f1b3c15bda763bd1b6';

/** 知识库概况 GET /ragflow/chat/datasets */
export const knowledgeBases: KnowledgeBase[] = [
  { id: 'kb-bank', name: '银行客服知识库', docs: 1 },
  { id: 'kb-bench', name: 'KB-Benchmark-20260915', docs: 5 },
  { id: 'kb-grok', name: '__grok_skill_pool_test_20260915__', docs: 1 },
  { id: activeKbId, name: '航发智能质检知识库', docs: 34 },
];

/** 演示检索语料(航空发动机主题) */
export const chunks: KbChunk[] = [
  {
    id: 'c-turbofan', kbId: activeKbId, title: '涡轮风扇发动机基本组成',
    keywords: ['原理', '涡扇', '组成', '结构', '发动机'],
    text: '航空发动机把燃料的化学能通过燃烧转化为热能，再经涡轮膨胀做功驱动压气机与风扇，最终以喷气动能产生推力。涡扇发动机主要由风扇、压气机、燃烧室、涡轮和喷管组成。',
  },
  {
    id: 'c-compressor', kbId: activeKbId, title: '压气机与总压比',
    keywords: ['压气机', '总压比', '增压', '效率'],
    text: '压气机对进气做功提高空气压力，其增压能力用总压比衡量。总压比越高，布雷顿循环热效率通常越高，但受材料耐温与失速裕度约束。',
  },
  {
    id: 'c-combustor', kbId: activeKbId, title: '燃烧室与涡轮前温度',
    keywords: ['燃烧室', '涡轮前温度', '燃烧', '高温'],
    text: '燃烧室将燃油与高压空气混合并近似等压燃烧，将工质加热到涡轮前温度。涡轮前温度是决定发动机推力与寿命的关键参数，依赖涡轮叶片冷却与高温合金。',
  },
  {
    id: 'c-turbine', kbId: activeKbId, title: '涡轮做功与能量分配',
    keywords: ['涡轮', '做功', '能量', '驱动'],
    text: '高温高压燃气在涡轮中膨胀做功，输出功率驱动风扇与压气机；剩余能量经喷管排出形成推力。涡轮与压气机的功率匹配决定发动机的工作点。',
  },
  {
    id: 'c-flaw', kbId: activeKbId, title: '叶片缺陷检测与判定',
    keywords: ['缺陷', '检测', '裂纹', '叶片', '质检', '荧光', '孔探'],
    text: '叶片常见缺陷包括裂纹、掉块、烧蚀与异物打伤。荧光渗透检出表面开口缺陷，孔探定位内部与可及表面损伤；检出结果需按标准进行人工复核后出具报告。',
  },
  {
    id: 'c-report', kbId: activeKbId, title: '检测报告与可溯源要求',
    keywords: ['报告', '溯源', '引用', '原始文档', '结论'],
    text: '智能质检报告应保留结论出处，可追溯至原始文档、图像与模型版本。检索不到依据时，回答必须显式说明未找到可引用依据，不得生成肯定结论。',
  },
];

/** 种子会话:还原截图中的「航空发动机原理」多轮问答 */
export const seedSessions: KbSession[] = [
  {
    id: 's-engine-principle',
    title: '航空发动机原理',
    createdAt: new Date('2026-09-23T09:12:00').getTime(),
    messages: [
      {
        id: 'm-greet', role: 'assistant', time: new Date('2026-09-23T09:12:00').getTime(),
        text: '你好！我是你的助理，有什么可以帮到你的吗？',
      },
      {
        id: 'm-user-1', role: 'user', time: new Date('2026-09-23T09:12:20').getTime(),
        text: '航航空发动机原理',
      },
      {
        id: 'm-ai-1', role: 'assistant', time: new Date('2026-09-23T09:12:25').getTime(),
        text:
          '用户查询“航航空发动机原理”，可能是指“航空发动机原理”（aviation engine principles）。“航航空”可能有重复汉字，我将其理解为“航空发动机原理”。用户可能想了解航空发动机的基本原理。我应该用中文提供相关解释。\n\n' +
          '# 航空发动机原理\n\n' +
          '“航航空发动机原理”应理解为航空发动机原理，即航空发动机如何将燃料的化学能转化为推进飞机前进的动能。以下从基本原理、主要类型和工作过程三个方面进行说明。',
        trace: [
          { chunkId: 'c-turbofan', source: '航发智能质检知识库 / 涡轮风扇发动机基本组成', snippet: '航空发动机把燃料的化学能通过燃烧转化为热能……最终以喷气动能产生推力。', score: 0.92 },
          { chunkId: 'c-turbine', source: '航发智能质检知识库 / 涡轮做功与能量分配', snippet: '高温高压燃气在涡轮中膨胀做功，输出功率驱动风扇与压气机……', score: 0.81 },
        ],
      },
    ],
  },
];

/** 资料入库清单 */
export const seedDocs: IngestDoc[] = [
  { id: 'D-2041', name: 'GB/T 6414 铸件尺寸公差.pdf', kbId: activeKbId, type: 'PDF', size: '2.4 MB', status: '已解析', updatedAt: '09-28 15:20', category: '标准规范' },
  { id: 'D-2038', name: '涡轮叶片荧光渗透作业指导书.docx', kbId: activeKbId, type: 'Word', size: '860 KB', status: '索引中', updatedAt: '09-28 11:04', category: '作业指导书' },
  { id: 'D-2030', name: '航空发动机原理（讲义）.pdf', kbId: activeKbId, type: 'PDF', size: '5.1 MB', status: '已解析', updatedAt: '09-25 09:30', category: '培训资料' },
  { id: 'D-2026', name: '断口形貌分类图谱.pdf', kbId: activeKbId, type: 'PDF', size: '3.7 MB', status: '待入库', updatedAt: '09-24 17:12', category: '图谱资料' },
  { id: 'D-2019', name: '孔探图像采集规范.md', kbId: activeKbId, type: 'Markdown', size: '42 KB', status: '已解析', updatedAt: '09-20 10:55', category: '技术规范' },
];
