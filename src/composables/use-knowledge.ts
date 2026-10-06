/** 知识中心状态中枢:检索会话、资料入库、跨标签页跳转。
 *  远程优先:VITE_QA_ENABLED=true 时调用 quality-agent 平台后端;任一步失败自动回退本地演示。 */
import { computed, reactive, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  activeKbId as defaultKbId,
  chunks,
  knowledgeBases,
  seedDocs,
  seedSessions,
  type IngestDoc,
  type KbMessage,
  type KbSession,
  type KnowledgeBase,
  type TraceItem,
} from '@/data/knowledge';
import * as rf from '@/api/ragflow';

export type KnowledgeTab = 'search' | 'ingest' | 'collect';

const SESSIONS_KEY = 'va-kb-sessions-v1';
const DOCS_KEY = 'va-kb-docs-v1';
const remote = rf.ragflowEnabled;

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const greeting = (): KbMessage => ({
  id: uid(),
  role: 'assistant',
  text: '你好！我是你的助理，有什么可以帮到你的吗？',
  time: Date.now(),
});

const store = reactive({
  activeTab: 'ingest' as KnowledgeTab,
  sessions: remote ? ([] as KbSession[]) : load<KbSession[]>(SESSIONS_KEY, seedSessions),
  activeId: remote ? '' : load<KbSession[]>(SESSIONS_KEY, seedSessions)[0]?.id ?? '',
  docs: remote ? ([] as IngestDoc[]) : load<IngestDoc[]>(DOCS_KEY, seedDocs),
});

// 仅演示模式持久化到本地;远程模式数据以服务端为准
if (!remote) {
  watch(() => store.sessions, (v) => localStorage.setItem(SESSIONS_KEY, JSON.stringify(JSON.parse(JSON.stringify(v)))), { deep: true });
  watch(() => store.docs, (v) => localStorage.setItem(DOCS_KEY, JSON.stringify(v)), { deep: true });
}

/* ---------- 连接状态 ---------- */
export interface KbConnection { mode: 'remote' | 'demo'; status: 'idle' | 'online' | 'error'; error: string }
export const connection = reactive<KbConnection>({ mode: remote ? 'remote' : 'demo', status: 'idle', error: '' });
export const sending = ref(false);
function setError(e: unknown) {
  connection.status = 'error';
  connection.error = e instanceof Error ? e.message : String(e);
}

/* ---------- 跨标签页 ---------- */
export const activeTab = computed({
  get: () => store.activeTab,
  set: (v) => { store.activeTab = v as KnowledgeTab; },
});
export function goTab(tab: KnowledgeTab) { store.activeTab = tab; }

/* ---------- 知识库列表 ---------- */
export const datasets = ref<KnowledgeBase[]>(remote ? [] : knowledgeBases);
export const activeKbId = ref<string>(remote ? '' : defaultKbId);
export async function loadDatasets() {
  if (!remote) { datasets.value = knowledgeBases; activeKbId.value = defaultKbId; return; }
  try {
    const list = await rf.listDatasets();
    datasets.value = list;
    if (!activeKbId.value || !list.some((k) => k.id === activeKbId.value)) {
      // 默认选中文档数最多的知识库(而非列表首个空库),首屏更能体现真实语料
      activeKbId.value = [...list].sort((a, b) => b.docs - a.docs)[0]?.id ?? '';
    }
    if (connection.status !== 'error') connection.status = 'online';
  } catch (e) {
    setError(e);
    datasets.value = knowledgeBases;
    activeKbId.value = defaultKbId;
  }
}
export const kbName = computed(() => datasets.value.find((k) => k.id === activeKbId.value)?.name ?? '知识库');
export const activeKbDocs = computed(() => datasets.value.find((k) => k.id === activeKbId.value)?.docs ?? 0);
export const docsInActiveKb = computed(() => store.docs.filter((d) => d.kbId === activeKbId.value));
const datasetForIngest = () => activeKbId.value || datasets.value[0]?.id || '';

/* ---------- 会话 ---------- */
export const sessions = computed(() => store.sessions);
export const activeSession = computed(() => store.sessions.find((s) => s.id === store.activeId) ?? null);

function mapRfMessages(raw: any[]): KbMessage[] {
  const out: KbMessage[] = [];
  for (const m of raw || []) {
    if (m && (m.role || m.content)) {
      out.push({ id: uid(), role: m.role === 'user' ? 'user' : 'assistant', text: String(m.content ?? m.answer ?? ''), time: Number(m.time) || Date.now() });
    } else if (m && (m.question || m.answer)) {
      if (m.question) out.push({ id: uid(), role: 'user', text: String(m.question), time: Date.now() });
      if (m.answer) out.push({ id: uid(), role: 'assistant', text: String(m.answer), time: Date.now() });
    }
  }
  return out;
}

export async function loadConversations() {
  if (!remote) return;
  try {
    const list = await rf.listSessions();
    store.sessions = await Promise.all(list.map(async (c) => {
      let msgs: KbMessage[] = [];
      try { msgs = mapRfMessages(await rf.getSessionMessages(c.id)); } catch { /* 单会话历史加载失败不阻断列表 */ }
      return { id: uid(), rfId: c.id, title: c.name, createdAt: c.createTime, messages: msgs } as KbSession;
    }));
    if (!store.activeId && store.sessions.length) store.activeId = store.sessions[0].id;
    if (connection.status !== 'error') connection.status = 'online';
  } catch (e) {
    setError(e);
    if (!store.sessions.length) { store.sessions = JSON.parse(JSON.stringify(seedSessions)); store.activeId = store.sessions[0]?.id ?? ''; }
  }
}

export function selectSession(id: string) { store.activeId = id; }

export function newSession(): KbSession {
  const s: KbSession = { id: uid(), rfId: '', title: '新的知识会话', createdAt: Date.now(), messages: [greeting()] };
  store.sessions.unshift(s);
  store.activeId = s.id;
  return s;
}

export function renameSession(id: string, title: string) {
  const s = store.sessions.find((x) => x.id === id);
  if (s && title.trim()) {
    s.title = title.trim();
    if (remote && s.rfId) rf.renameSession(s.rfId, s.title).catch(() => undefined);
  }
}

export function removeSession(id: string) {
  const s = store.sessions.find((x) => x.id === id);
  if (remote && s?.rfId) rf.deleteSession(s.rfId).catch(() => undefined);
  const idx = store.sessions.findIndex((x) => x.id === id);
  if (idx >= 0) {
    store.sessions.splice(idx, 1);
    if (store.activeId === id) store.activeId = store.sessions[0]?.id ?? '';
  }
}

export function clearSession(id: string) {
  const s = store.sessions.find((x) => x.id === id);
  if (s) s.messages = [greeting()];
}

/* ---------- 本地演示检索(回退用) ---------- */
function localAnswer(text: string): { text: string; trace: TraceItem[] } {
  const scored = chunks
    .filter((c) => c.kbId === activeKbId.value)
    .map((c) => {
      let hit = 0;
      for (const k of c.keywords) if (text.includes(k)) hit += 0.28 + k.length * 0.02;
      return { c, score: Math.min(0.98, hit) };
    })
    .filter((x) => x.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!scored.length) {
    return { text: `在「${kbName.value}」中未找到与该问题可引用的依据，因此不生成肯定结论。可换一种说法，或先在「资料入库」补充相关标准、手册与案例。`, trace: [] };
  }
  const body = scored.map((s) => `**${s.c.title}**：${s.c.text}`).join('\n');
  return {
    text: `# ${text}\n\n根据「${kbName.value}」检索到 ${scored.length} 条依据，整理如下：\n\n${body}\n\n（演示模式：本地关键词检索，接入 quality-agent 后为真实召回）`,
    trace: scored.map((s) => ({ chunkId: s.c.id, source: s.c.title, snippet: s.c.text, score: s.score })),
  };
}

/* ---------- 提问(远程优先) ---------- */
export async function ask(text: string) {
  const trimmed = text.trim();
  if (!trimmed || sending.value) return;
  let s = activeSession.value;
  if (!s) s = newSession();
  s.messages.push({ id: uid(), role: 'user', text: trimmed, time: Date.now() });
  if (s.title === '新的知识会话' || s.title === '新会话') s.title = trimmed.slice(0, 16);

  if (!remote) {
    const a = localAnswer(trimmed);
    s.messages.push({ id: uid(), role: 'assistant', text: a.text, time: Date.now(), trace: a.trace });
    return;
  }

  sending.value = true;
  // 先落一条空的 assistant 气泡,流式回填(取回 reactive 元素引用以保证更新可见)
  s.messages.push({ id: uid(), role: 'assistant', text: '', time: Date.now(), trace: [] });
  const bot = s.messages[s.messages.length - 1];
  try {
    if (!s.rfId) {
      const c = await rf.createSession(s.title);
      s.rfId = c.id;
    }
    await rf.streamCompletion(s.rfId, trimmed, uid(), {
      onDelta: (t) => { bot.text += t; },
      onTrace: (trace) => { bot.trace = trace; },
    });
    if (!bot.text) bot.text = '（未返回内容）';
    connection.status = 'online';
  } catch (e) {
    setError(e);
    const a = localAnswer(trimmed);
    bot.text = `⚠️ quality-agent 调用失败，已回退演示回答：${connection.error}\n\n${a.text}`;
    bot.trace = a.trace;
  } finally {
    sending.value = false;
  }
}

/* ---------- 资料入库 ---------- */
export const docs = computed(() => store.docs);

export async function loadDocs() {
  if (!remote) { store.docs = load<IngestDoc[]>(DOCS_KEY, seedDocs); return; }
  try {
    store.docs = await rf.listDocuments(datasetForIngest());
    if (connection.status !== 'error') connection.status = 'online';
  } catch (e) {
    setError(e);
    store.docs = load<IngestDoc[]>(DOCS_KEY, seedDocs);
  }
}

function addDocsLocal(files: { name: string; size: number }[]) {
  const kbId = datasetForIngest();
  const stamp = now().slice(5, 16);
  const created: IngestDoc[] = files.map((f) => ({
    id: uid(),
    name: f.name,
    kbId,
    type: (f.name.split('.').pop() || '文件').toUpperCase(),
    size: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
    status: '待入库',
    updatedAt: stamp,
  }));
  store.docs.unshift(...created);
}

export async function uploadDocs(files: File[]) {
  if (!files.length) return;
  if (!remote) { addDocsLocal(files.map((f) => ({ name: f.name, size: f.size }))); message.success(`已登记 ${files.length} 条资料（演示）`); return; }
  try {
    await rf.uploadDocuments(datasetForIngest(), files);
    await loadDocs();
    message.success(`已上传 ${files.length} 个文件到知识库`);
  } catch (e) {
    setError(e);
    addDocsLocal(files.map((f) => ({ name: f.name, size: f.size })));
    message.warning(`上传失败，已本地登记：${connection.error}`);
  }
}

export async function parseDoc(id: string) {
  if (!remote) { advanceLocal(id); return; }
  try { await rf.parseDocuments(datasetForIngest(), [id]); await loadDocs(); }
  catch (e) { setError(e); message.warning(`解析请求失败：${connection.error}`); }
}

const FLOW: IngestDoc['status'][] = ['待入库', '解析中', '索引中', '已解析'];
function advanceLocal(id: string) {
  const d = store.docs.find((x) => x.id === id);
  if (d) {
    d.status = FLOW[Math.min(FLOW.indexOf(d.status) + 1, FLOW.length - 1)];
    d.updatedAt = now().slice(5, 16);
  }
}

/* ---------- 文档预览 / 解析文本 / 下载 ---------- */
export function docPreviewUrl(d: IngestDoc): string {
  return rf.buildPreviewUrl(d.id, d.name);
}
export function docImageUrl(imageId: string): string {
  return rf.buildImageUrl(imageId);
}
export async function fetchDocChunks(d: IngestDoc): Promise<rf.DocChunk[]> {
  if (!remote) return [];
  return rf.fetchDocumentChunks(d.kbId || datasetForIngest(), d.id);
}
export async function downloadDoc(d: IngestDoc): Promise<boolean> {
  if (!remote) { message.info('演示模式无原始文件可下载'); return false; }
  try { await rf.downloadDocument(d.kbId || datasetForIngest(), d.id, d.name); return true; }
  catch (e) { setError(e); message.warning(`下载失败：${connection.error}`); return false; }
}

/* ---------- 首屏加载 ---------- */
let loaded = false;
export async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!remote) return;
  await loadDatasets();  // 先解析出 activeKbId,再列文档;避免 datasetForIngest() 取到空 id 而回退演示
  await Promise.all([loadConversations(), loadDocs()]);
  if (connection.status !== 'error') connection.status = 'online';
}

export { remote };
