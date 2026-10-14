<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import {
  activeKbDocs, activeKbId, activeSession, ask, clearSession, connection,
  datasets, ensureLoaded, kbName, newSession, remote, removeSession,
  renameSession, selectSession, sending, sessions,
} from '@/composables/use-knowledge';

const input = ref('');
const draft = ref('');
const editing = ref(false);
const historyCollapsed = ref(false);
const traceCollapsed = ref(false);
const msgsEl = ref<HTMLElement | null>(null);

onMounted(() => { ensureLoaded(); });

/** 最近一条带引用的回答 → 知识引用面板 */
const lastTrace = computed(() => {
  const msgs = activeSession.value?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'assistant' && msgs[i].trace) return msgs[i].trace!;
  }
  return [];
});

const modeLabel = computed(() => {
  if (!remote) return '本地演示模式';
  if (connection.status === 'error') return '后端异常  已回退演示';
  return '已连接 quality-agent';
});

function scrollDown() {
  nextTick(() => { if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight; });
}
watch(() => activeSession.value?.messages.length, scrollDown);
watch(sending, (v) => { if (!v) scrollDown(); });

async function send() {
  if (!input.value.trim() || sending.value) return;
  const q = input.value;
  input.value = '';
  await ask(q);
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
function startRename() {
  draft.value = activeSession.value?.title ?? '';
  editing.value = true;
  nextTick(() => { document.getElementById('kb-title-input')?.focus(); });
}
function commitRename() {
  if (activeSession.value) renameSession(activeSession.value.id, draft.value);
  editing.value = false;
}
function create() {
  newSession();
  input.value = '';
  scrollDown();
}
function clear() {
  if (activeSession.value) { clearSession(activeSession.value.id); message.success(remote ? '已清空当前视图（远程记录以服务端为准）。' : '已清空当前会话（本地演示）。', 2.6); }
}
function del(id: string) {
  removeSession(id);
}
</script>

<template>
  <div class="kb-search">
    <div class="kb-search-head">
      <div>
        <h2>知识库检索</h2>
        <p>基于知识库的多轮问答，回答、引用、图片与原始文档全程可溯源</p>
      </div>
      <div class="kb-search-actions">
        <span class="kb-active-tag" :class="{ err: remote && connection.status === 'error' }">{{ modeLabel }} · {{ datasets.length }} 个知识库</span>
        <a-button size="small" @click="message.info('助手配置为本地演示入口，暂未开放。', 2.6)">助手配置</a-button>
      </div>
    </div>

    <div class="kb-banner">
      <span class="kb-banner-warn"><span class="kb-banner-ico">⚠</span> 未启用知识 ACL，检索结果为 <b>全库</b>，未做权限过滤 · 接口无 page/offset，会话按轮次续写而非翻页重检</span>
      <span class="kb-banner-meta">取回深度 top_k 1024 · 引用上限 top_n 3 · <span class="kb-kb-pill">{{ kbName }} · {{ activeKbDocs }} 篇</span></span>
    </div>

    <div class="kb-cols">
      <!-- 历史会话 -->
      <aside class="kb-history" :class="{ collapsed: historyCollapsed }">
        <div class="kb-history-head">
          <strong v-show="!historyCollapsed">历史会话</strong>
          <div class="kb-history-btns">
            <button type="button" aria-label="新建会话" @click="create">+</button>
            <button type="button" aria-label="折叠" @click="historyCollapsed = !historyCollapsed">{{ historyCollapsed ? '»' : '«' }}</button>
          </div>
        </div>
        <ul v-show="!historyCollapsed" class="kb-history-list">
          <li
            v-for="s in sessions"
            :key="s.id"
            :class="{ active: s.id === activeSession?.id }"
          >
            <button class="kb-history-item" type="button" @click="selectSession(s.id)">
              <strong>{{ s.title }}</strong>
              <small>{{ new Date(s.createdAt).toLocaleDateString() }}</small>
            </button>
            <button class="kb-history-del" type="button" aria-label="删除会话" @click.stop="del(s.id)">×</button>
          </li>
          <li v-if="!sessions.length" class="kb-history-empty">暂无历史会话</li>
        </ul>
      </aside>

      <!-- 对话 -->
      <section class="kb-chat">
        <header class="kb-chat-head">
          <div class="kb-chat-title">
            <template v-if="editing">
              <input
                id="kb-title-input"
                v-model="draft"
                class="kb-title-input"
                @blur="commitRename"
                @keydown.enter="commitRename"
              />
            </template>
            <template v-else>
              <h3>{{ activeSession?.title ?? '未选择会话' }}
                <button v-if="activeSession" type="button" class="kb-rename" aria-label="重命名" @click="startRename">✎</button>
              </h3>
              <small>已保存至服务端</small>
            </template>
          </div>
          <a-button size="small" :disabled="!activeSession" @click="clear">清空会话</a-button>
        </header>

        <div ref="msgsEl" class="kb-msgs">
          <div v-if="!activeSession" class="kb-chat-blank">
            <IconSvg name="book" />
            <p>选择或新建一个历史会话开始检索问答。</p>
            <a-button type="primary" size="small" @click="create">新建会话</a-button>
          </div>
          <div v-for="m in activeSession?.messages ?? []" :key="m.id" class="kb-msg" :class="'is-' + m.role">
            <template v-if="m.role === 'assistant'">
              <div class="kb-avatar ai">AI</div>
              <div class="kb-msg-main">
                <span class="kb-msg-name">知识助手</span>
                <div class="kb-bubble"><MarkdownView :text="m.text" /></div>
              </div>
            </template>
            <template v-else>
              <div class="kb-msg-main user">
                <span class="kb-msg-name right">你</span>
                <div class="kb-bubble user">{{ m.text }}</div>
              </div>
              <div class="kb-avatar me">我</div>
            </template>
          </div>
        </div>

        <div class="kb-input">
          <textarea
            v-model="input"
            rows="2"
            placeholder="输入问题，Enter 发送，Shift + Enter 换行"
            @keydown="onKeydown"
          ></textarea>
          <div class="kb-input-foot">
            <span>AI 可能产生错误，重要结论请核对原文</span>
            <a-button type="primary" :loading="sending" :disabled="!activeSession" @click="send">发送</a-button>
          </div>
        </div>
      </section>

      <!-- 知识引用 -->
      <aside class="kb-trace" :class="{ collapsed: traceCollapsed }">
        <div class="kb-trace-head">
          <button type="button" class="kb-trace-toggle" aria-label="展开/折叠" @click="traceCollapsed = !traceCollapsed">{{ traceCollapsed ? '«' : '»' }}</button>
          <div class="kb-trace-title"><strong>知识引用</strong><small>KNOWLEDGE TRACE</small></div>
          <span class="kb-trace-count">{{ lastTrace.length }} 条</span>
        </div>

        <div v-show="!traceCollapsed" class="kb-trace-body">
          <div v-if="!lastTrace.length" class="kb-trace-empty">
            <span class="kb-trace-dot"></span>
            <p>回答中的知识引用会在这里完整展开</p>
          </div>
          <div v-else class="kb-trace-list">
            <div v-for="(t, i) in lastTrace" :key="i" class="kb-trace-card">
              <div class="kb-trace-card-top">
                <span class="kb-trace-rank">{{ i + 1 }}</span>
                <strong>{{ t.source }}</strong>
                <span class="kb-trace-score">{{ (t.score * 100).toFixed(0) }}%</span>
              </div>
              <div class="kb-trace-snippet"><MarkdownView :text="t.snippet" /></div>
            </div>
          </div>

          <div class="kb-datasets">
            <h4>知识库概况 <span>DATASETS</span></h4>
            <ul>
              <li v-for="k in datasets" :key="k.id" :class="{ cur: k.id === activeKbId }">
                <span>{{ k.name }}</span><b>{{ k.docs }} 篇</b>
              </li>
            </ul>
            <p class="kb-datasets-note">来源 GET /ragflow/chat/datasets（名称与 document_count）；文档级解析 / 索引状态无接口，见资料入库页说明。</p>
          </div>

          <div class="kb-behavior">
            <h4>无依据时的行为</h4>
            <p>检索不到依据时，AI 解释区必须显式说明「未找到可引用依据」，<b>不得生成肯定结论</b>（方案 §7.3 异常处置）。</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
