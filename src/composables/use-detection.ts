import { computed, reactive, watch } from 'vue';
import { capabilities } from '@/data';
import type { ProfessionalCapability } from '@/data/types';
import { capabilityToSceneCode } from '@/data/scene-map';
import { deriveStageProgress, type StageProgress } from '@/data/inspection-stages';
import { pollDetail, taskDetailOf } from '@/composables/use-tasks';
import { ragflowEnabled } from '@/api/ragflow';
import * as agent from '@/api/agent';
import type { StreamFrame } from '@/api/agent';

/** 渲染条目:统一承载用户/助手气泡、思考行、工具调用行、生命周期卡片。 */
export interface DetItem {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'chain' | 'card';
  text: string;
  streaming: boolean;
  images: any[];
  // chain(工具行)
  name?: string;
  args?: any;
  result?: any;
  done?: boolean;
  isError?: boolean;
  doneAt?: number;
  // card(生命周期卡片)
  cardType?: string;
  taskId?: string;
  payload?: any;
  time: number;
}

export interface SessionVM {
  id: string;
  title: string;
  updatedAt: number;
  lastMessage: string;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const store = reactive({
  sessions: [] as SessionVM[],
  activeId: null as string | null,
  items: [] as DetItem[],
  loading: false,
  error: '' as string,
  sending: false,
  // 回合级"运行中"标记：从发出请求置位，直到本轮助手回复结束(或出错)才清零。
  // 用于覆盖"发送往返期间""工具调用间隙""首 token 到达前"等没有任何流式内容的静默窗口，
  // 让用户始终看到"智能体仍在运行"的反馈，并明确区分"结束"与"还在等"。
  turnPending: false,
  runPhase: '' as string,
  // 长时运行任务集：task_card(status=running/pending) 落卡时加入，
  // 对应 done_card / review_card / report_card 落卡时移除。
  // 这些卡片"只推不改"，因此助手文本回复结束后，后台任务可能仍在跑几分钟；
  // 用这个集合把"任务仍在执行"纳入运行中判定，避免用户误以为系统已停止。
  runningTaskIds: [] as string[],
  // 最近一次发送的参数快照，供"失败重试"重发（不区分来自首页还是检测页）。
  lastSend: null as { content: string; files: File[]; scene: string } | null,
});

/** 当前会话消息流的关闭句柄(切换会话/新建/卸载时调用)。 */
let closeStream: (() => void) | null = null;

export const isRemote = ragflowEnabled;

export const conversations = computed(() => store.sessions);
export const conversationCount = computed(() => store.sessions.length);
export const items = computed(() => store.items);
export const activeId = computed(() => store.activeId);
export const sending = computed(() => store.sending);
export const error = computed(() => store.error);
export const hasActive = computed(() => store.activeId !== null);

/** 是否还有"进行中"的活动项：流式文本/思考，或尚未返回结果的工具调用。 */
function anyWorking(): boolean {
  return store.items.some(
    (it) => it.streaming || (it.kind === 'chain' && it.done === false),
  );
}

/** 智能体是否仍在运行(用于驱动等待反馈指示器)。
 *  既覆盖消息流回合(发送/思考/工具/生成)，也覆盖回合结束后仍在后台执行的检测任务。
 *  注意：这是"能否再发起一次生成"的门禁口径，不因展示层拆分而放宽。 */
export const agentBusy = computed(
  () => store.sending || store.turnPending || anyWorking() || store.runningTaskIds.length > 0,
);

/** 本回合是否仍在生成（不含后台长任务）。
 *  驱动线程底部的三点工作条；后台任务改由独立的"任务舱"呈现，
 *  避免同一秒表在卡片与工作条里出现两份、语义还互相矛盾。 */
export const agentTurnBusy = computed(
  () => store.sending || store.turnPending || anyWorking(),
);

/** 正在后台跑的检测任务视图模型：供底部任务舱逐条呈现。
 *  startedAt 取派发卡（task_card）的落卡时间，多任务顺序跟随 runningTaskIds；
 *  不额外维护第二份状态，卡片被终态卡顶掉时自然从舱里消失。 */
export interface RunningTaskVM {
  taskId: string;
  scene: string;
  startedAt: number;
}
export const runningTaskCards = computed<RunningTaskVM[]>(() =>
  store.runningTaskIds.map((id) => {
    const card = store.items.find(
      (it) => it.kind === 'card' && it.cardType === 'task_card' && it.taskId === id,
    );
    return {
      taskId: id,
      scene: String(card?.payload?.scene ?? ''),
      startedAt: card?.time ?? Date.now(),
    };
  }),
);

/** 某任务当前是否仍在执行(running 卡未被终态卡覆盖)。 */
export function isTaskRunning(taskId: string): boolean {
  return !!taskId && store.runningTaskIds.includes(taskId);
}

/* ================= 后台任务阶段进度 =================
 * 节点级执行痕迹（append_step → steps_json）被会话流故意挡掉（on_task_step 只转发 chain），
 * 因此只能从 GET /tasks/{id} 的 steps + status 推导。详情快照复用 use-tasks 的
 * store.details：任务舱与详情弹窗读同一份数据，轮询一次两处同步刷新。 */
export function stageProgressOf(taskId: string): StageProgress | null {
  if (!taskId) return null;
  const d = taskDetailOf(taskId);
  if (!d) return null;
  return deriveStageProgress(d.steps, d.status);
}

/** 在跑任务的阶段进度（任务舱直读）；详情未到货则为 null（退化为无步骤条）。 */
export const taskProgress = computed<Record<string, StageProgress | null>>(() => {
  const m: Record<string, StageProgress | null> = {};
  for (const t of runningTaskCards.value) m[t.taskId] = stageProgressOf(t.taskId);
  return m;
});

const POLL_INTERVAL_MS = 5000;
let _pollTimer: ReturnType<typeof setInterval> | undefined;

function pollRunningTasks() {
  for (const id of [...store.runningTaskIds]) void pollDetail(id);
}

/* 有在跑任务就开轮询，清空即停；新任务落卡时立刻补一次拉取，不让首个阶段空等 5s。 */
watch(
  () => [...store.runningTaskIds],
  (ids, prev) => {
    const known = new Set(prev ?? []);
    for (const id of ids) if (!known.has(id)) void pollDetail(id);
    if (ids.length && !_pollTimer) _pollTimer = setInterval(pollRunningTasks, POLL_INTERVAL_MS);
    if (!ids.length && _pollTimer) { clearInterval(_pollTimer); _pollTimer = undefined; }
  },
);

/** 从线程内已落定的终态卡反查任务最终状态；未落定返回 null。
 *  done_card 取 payload.status；review_card 视为 awaiting_review；report_card 视为 completed。 */
export function taskFinalStatus(taskId: string): string | null {
  if (!taskId) return null;
  for (const it of store.items) {
    if (it.kind !== 'card' || it.taskId !== taskId) continue;
    if (it.cardType === 'done_card') return String(it.payload?.status || 'completed');
    if (it.cardType === 'review_card') return 'awaiting_review';
    if (it.cardType === 'report_card') return 'completed';
  }
  return null;
}

/** 根据生命周期卡片维护"在跑任务"集合。
 *  卡片只推不改：task_card(running/pending) 开跑；done/review/report 表示该任务已不再计算。 */
function trackRunningCard(cardType: string | undefined, taskId: unknown, status: unknown) {
  const id = String(taskId ?? '');
  if (!id) return;
  const has = store.runningTaskIds.includes(id);
  if (cardType === 'task_card') {
    const st = String(status ?? 'running');
    if (st === 'running' || st === 'pending') {
      if (!has) store.runningTaskIds.push(id);
    } else if (has) {
      store.runningTaskIds = store.runningTaskIds.filter((x) => x !== id);
    }
  } else if (cardType === 'done_card' || cardType === 'review_card' || cardType === 'report_card') {
    if (has) store.runningTaskIds = store.runningTaskIds.filter((x) => x !== id);
  }
}

/** 当前回合阶段文案；无明确阶段时给兜底文案。
 *  后台长任务不在此列——它的可见性由底部任务舱负责，这里只说"智能体本身在干什么"。 */
export const agentPhase = computed(() => store.runPhase || '智能体正在处理…');

/* 看门狗：若长时间(默认 60s)既无任何新帧、也没有进行中的活动项，
 * 则视为本轮已结束，防止 SSE 静默断开等异常导致"运行中"永远不消失。
 * 工具执行期间 chain.done=false 使 anyWorking 为真，不会被误清。 */
let _watchdog: ReturnType<typeof setTimeout> | undefined;
function armWatchdog() {
  if (_watchdog) clearTimeout(_watchdog);
  _watchdog = setTimeout(() => {
    if (store.turnPending && !store.sending && !anyWorking()) {
      store.turnPending = false;
      store.runPhase = '';
    }
  }, 60000);
}
function clearWatchdog() {
  if (_watchdog) { clearTimeout(_watchdog); _watchdog = undefined; }
}

function stopStream() {
  clearWatchdog();
  if (closeStream) { closeStream(); closeStream = null; }
}
/** 页面卸载：关消息流 + 停阶段进度轮询（没人看了就别接着打接口）。 */
export function teardownDetection(): void {
  stopStream();
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = undefined; }
}

/* ================= 帧 reducer(仅远程模式) ================= */
function findIndex(id: string): number {
  return store.items.findIndex((it) => it.id === id);
}
function ensure(id: string, kind: DetItem['kind']): DetItem {
  const i = findIndex(id);
  if (i >= 0) return store.items[i];
  const it: DetItem = { id, kind, text: '', streaming: false, images: [], time: Date.now() };
  store.items.push(it);
  return store.items[store.items.length - 1]; // 取回 reactive 代理元素
}

function applyFrame(frame: StreamFrame) {
  switch (frame.type) {
    case 'message': {
      const role = frame.message?.role ?? 'assistant';
      const it = ensure(frame.message_id, role === 'user' ? 'user' : 'assistant');
      if (frame.phase === 'start') {
        it.streaming = true;
        if (role !== 'user') store.runPhase = '正在生成回复…';
      } else if (frame.phase === 'delta') {
        it.text += frame.delta ?? '';
        if (role !== 'user') store.runPhase = '正在生成回复…';
      } else {
        it.text = frame.message?.content ?? it.text;
        it.images = frame.message?.images ?? [];
        it.streaming = false;
        // 助手回复收尾：若已无其他进行中的活动项(工具/思考)，则本轮结束。
        if (role !== 'user' && !anyWorking()) {
          store.turnPending = false;
          store.runPhase = '';
        }
      }
      break;
    }
    case 'thinking': {
      const it = ensure(frame.message_id, 'thinking');
      if (frame.phase === 'start') { it.streaming = true; store.runPhase = '智能体正在思考…'; }
      else if (frame.phase === 'delta') { it.text += frame.delta ?? ''; store.runPhase = '智能体正在思考…'; }
      else { it.text = frame.text ?? it.text; it.streaming = false; }
      break;
    }
    case 'chain': {
      const it = ensure(frame.message_id, 'chain');
      it.name = frame.name ?? it.name;
      it.args = frame.args ?? it.args;
      it.taskId = frame.task_id ?? it.taskId;
      if (frame.event === 'tool_result') {
        it.result = frame.content; it.done = true; it.isError = !!frame.is_error; it.streaming = false; it.doneAt = Date.now();
        if (!anyWorking()) store.runPhase = '正在分析工具返回…';
      } else {
        it.done = false;
        store.runPhase = `正在调用「${frame.name || it.name || '工具'}」…`;
      }
      break;
    }
    case 'card': {
      const it = ensure(frame.message_id, 'card');
      it.cardType = frame.card_type;
      it.taskId = frame.task_id ?? undefined;
      it.payload = frame.payload;
      trackRunningCard(frame.card_type, frame.task_id ?? frame.payload?.task_id, frame.payload?.status);
      store.runPhase = '正在更新任务状态…';
      break;
    }
    case 'error':
      store.error = frame.message || '智能体返回错误';
      store.turnPending = false;
      store.runPhase = '';
      break;
  }
  // 任何增量都刷新会话排序时间(轻量:仅更新当前会话项)
  const s = store.sessions.find((x) => x.id === store.activeId);
  if (s) s.updatedAt = Date.now();
  // 有活动就重臂看门狗；回合已清空则撤销
  if (store.turnPending) armWatchdog();
  else clearWatchdog();
}

function openStreamFor(sessionId: string) {
  stopStream();
  store.items = [];
  store.runningTaskIds = []; // 历史回放会重新推卡片，先清空避免跨会话泄漏
  closeStream = agent.streamMessages(sessionId, {
    onFrame: applyFrame,
    onError: (e) => { store.error = e.message; store.turnPending = false; store.runPhase = ''; store.runningTaskIds = []; },
  });
}

/* ================= 会话操作 ================= */
export async function initDetection(): Promise<void> {
  if (!isRemote) { loadDemo(); return; }
  store.loading = true;
  try {
    const list = await agent.listSessions();
    store.sessions = list.map((s) => ({
      id: s.session_id,
      title: s.title || '新的检测对话',
      updatedAt: s.updated_at ? Date.parse(s.updated_at) : Date.now(),
      lastMessage: s.last_message || '',
    }));
  } catch (e: any) {
    store.error = e.message;
  } finally {
    store.loading = false;
  }
}

export function newConversation() {
  stopStream();
  clearWatchdog();
  store.activeId = null;
  store.items = [];
  store.error = '';
  store.turnPending = false;
  store.runPhase = '';
  store.runningTaskIds = [];
}

export function openConversation(id: string) {
  if (store.activeId === id) return;
  store.activeId = id;
  store.error = '';
  clearWatchdog();
  store.turnPending = false;
  store.runPhase = '';
  if (isRemote) openStreamFor(id);
  else store.items = (demoMap()[id] ?? []).slice();
}

export async function removeConversation(id: string) {
  const i = store.sessions.findIndex((s) => s.id === id);
  if (isRemote) {
    try { await agent.deleteSession(id); } catch (e: any) { store.error = e.message; }
  }
  if (i >= 0) store.sessions.splice(i, 1);
  if (isRemote) {
    if (store.activeId === id) newConversation();
  } else {
    delete demoMap()[id];
    persistDemo();
    if (store.activeId === id) newConversation();
  }
}

export async function renameConversation(id: string, title: string) {
  const s = store.sessions.find((x) => x.id === id);
  const clean = title.trim();
  if (!s || !clean) return;
  if (isRemote) {
    try { await agent.renameSession(id, clean); s.title = clean; } catch (e: any) { store.error = e.message; }
  } else {
    s.title = clean; persistDemo();
  }
}

/* ================= 能力中心一次性交接 =================
 * 卡片填好参数后跳转对话页并自动发起生成：文本经模块级变量单点交接，
 * 消费即清空（避免刷新/再次进入对话页重复发送）。 */
let pendingHandoff = '';
export function setDetectionHandoff(text: string) { pendingHandoff = text; }
export function consumeDetectionHandoff(): string {
  const t = pendingHandoff;
  pendingHandoff = '';
  return t;
}

/* ================= 发送 ================= */
export async function sendRequest(text: string, files: File[], forcedCapId: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed && !files.length) return;
  const content = buildContent(trimmed, forcedCapId);
  // 能力 id → 后端场景码：随请求结构化提交，后端命中候选池即直接采用（不依赖 VLM 看图路由，
  // 避免灰度热部图被误判为 dr）；文本里的「（指定方向：xxx）」前缀保留作展示与旧契约兜底
  const scene = forcedCapId && forcedCapId !== 'auto' ? capabilityToSceneCode(forcedCapId) : '';

  if (isRemote) {
    await sendRemote(content, files, scene);
  } else {
    sendDemo(trimmed, files, forcedCapId);
  }
}

function buildContent(text: string, forcedCapId: string): string {
  if (forcedCapId && forcedCapId !== 'auto') {
    const c = capabilities.find((x) => x.id === forcedCapId);
    if (c) return `（指定方向：${c.name}）${text}`;
  }
  return text;
}

async function sendRemote(content: string, files: File[], scene = '') {
  store.sending = true;
  store.runPhase = '正在发送请求…';
  store.error = '';
  store.lastSend = { content, files, scene }; // 快照供 retryLast 重发
  try {
    let id = store.activeId;
    if (!id) {
      const s = await agent.createSession(content.slice(0, 24) || '新的检测对话');
      id = s.session_id;
      store.sessions.unshift({ id, title: s.title || content.slice(0, 24), updatedAt: Date.now(), lastMessage: content });
      store.activeId = id;
      openStreamFor(id);
    }
    // 订阅就绪后再置"回合运行中"，避免 openStreamFor 清空，并覆盖发送往返后的静默窗口
    store.turnPending = true;
    store.runPhase = '正在发送请求…';
    armWatchdog();
    await agent.sendMessage(id, content, files, scene);
    // 用户消息与助手回复均由已打开的消息流回推(按 message_id 幂等)
  } catch (e: any) {
    store.error = e.message;
    store.turnPending = false;
    store.runPhase = '';
  } finally {
    store.sending = false;
  }
}

/** 失败重试：重发最近一条请求（仅在远程模式且有快照时）。 */
export async function retryLast(): Promise<void> {
  const l = store.lastSend;
  if (!isRemote || !l || store.sending) return;
  await sendRemote(l.content, l.files, l.scene);
}

/** 重新生成：重发最近一条请求，追加一条新回答。
 *  （后端无“替换上一条”/取消接口，故为“再次发问”语义；任一活动进行中则不触发。） */
export async function regenerateLast(): Promise<void> {
  const l = store.lastSend;
  if (!isRemote || !l || store.sending || store.turnPending || anyWorking() || store.runningTaskIds.length) return;
  await sendRemote(l.content, l.files, l.scene);
}

/* ================= 任务详情弹窗（卡片点击就地查看，不跳出本页） ================= */
const detailModal = reactive({ open: false, taskId: '' });
export function openTaskDetail(taskId: string) {
  if (!taskId) return;
  detailModal.taskId = taskId;
  detailModal.open = true;
}
export function closeTaskDetail() { detailModal.open = false; }
export const detailModalOpen = computed(() => detailModal.open);
export const detailModalTaskId = computed(() => detailModal.taskId);

/* ================= 演示模式(离线兜底) ================= */
const DEMO_KEY = 'va-detection-threads-v2';

function matchCapability(text: string): ProfessionalCapability[] {
  return capabilities.filter((c) =>
    c.id === 'fluorescence' ? /荧光|渗透/.test(text)
      : c.id === 'borescope' ? /孔探/.test(text)
        : c.id === 'thermal' ? /热部/.test(text)
          : c.id === 'xray' ? /X\s*(射线|光)|Xray|OPI/i.test(text)
            : c.id === 'fracture' ? /断口/.test(text)
              : /金相/.test(text));
}

function demoReply(text: string, files: File[]): { text: string; capabilityId?: string } {
  const matches = matchCapability(text);
  const fileNote = files.length ? `已接收 ${files.length} 个本地文件（仅演示，未上传）。` : '尚未添加图像或文件。';
  if (matches.length === 1) {
    const c = matches[0];
    return {
      capabilityId: c.id,
      text:
        `我理解你想进行「${c.name}」相关检测：${c.desc}。\n` +
        `· 输入要求：${c.input}\n· 预期输出：${c.result}\n· 处理流程：${c.flow.join(' → ')}\n` +
        `${fileNote}\n当前仅演示需求理解与工具选择，不执行检测；专业结论需人工复核。`,
    };
  }
  if (matches.length > 1) {
    return { text: `识别到多个可能的专业方向：${matches.map((m) => m.name).join('、')}。请确认本次任务使用的能力。\n${fileNote}` };
  }
  return { text: '我还不能确定这属于哪一项专业能力。你可以补充成像方式或检测目标，' + `或从以下方向选择：${capabilities.map((c) => c.name).join('、')}。\n${fileNote}` };
}

function demoMap(): Record<string, DetItem[]> {
  const m: Record<string, DetItem[]> = {};
  for (const s of store.sessions) m[s.id] = (s as any)._items ?? [];
  return m;
}

function loadDemo() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    const threads: any[] = raw ? JSON.parse(raw) : [];
    store.sessions = threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt, lastMessage: t.lastMessage || '' }));
    for (const t of threads) { const s = store.sessions.find((x) => x.id === t.id); if (s) (s as any)._items = t.items ?? []; }
  } catch { /* ignore */ }
}

function persistDemo() {
  try {
    const map = demoMap();
    const threads = store.sessions.map((s) => ({ ...s, items: map[s.id] ?? [] }));
    localStorage.setItem(DEMO_KEY, JSON.stringify(threads));
  } catch { /* 隐私模式忽略 */ }
}

function sendDemo(text: string, files: File[], forcedCapId: string) {
  if (!store.activeId) {
    const id = uid();
    store.sessions.unshift({ id, title: text.slice(0, 20) || (files[0]?.name ?? '新的检测对话'), updatedAt: Date.now(), lastMessage: text });
    (store.sessions[0] as any)._items = [];
    store.activeId = id;
  }
  const s = store.sessions.find((x) => x.id === store.activeId)!;
  const arr: DetItem[] = ((s as any)._items ??= []);
  const forced = forcedCapId !== 'auto' ? capabilities.filter((c) => c.id === forcedCapId) : [];
  const matches = forced.length ? forced : matchCapability(text);
  const built = matches.length === 1
    ? { text: demoReply(text, files).text, capabilityId: matches[0].id }
    : demoReply(text, files);

  const userItem: DetItem = { id: uid(), kind: 'user', text, streaming: false, images: files.map((f) => ({ name: f.name, uri: '' })), time: Date.now() };
  const botItem: DetItem = { id: uid(), kind: 'assistant', text: built.text, streaming: false, images: [], time: Date.now() };
  arr.push(userItem, botItem);
  store.items = arr.slice();
  s.updatedAt = Date.now();
  s.lastMessage = text;
  store.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  persistDemo();
}
