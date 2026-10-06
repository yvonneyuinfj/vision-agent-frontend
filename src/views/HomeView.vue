<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import AppDialog from '@/components/AppDialog.vue';
import ModelPicker from '@/components/ModelPicker.vue';
import SendButton from '@/components/SendButton.vue';
import { capabilities, domains, domainNames } from '@/data';
import {
  handleDelegatedClick, openModule,
  showAllDomains, showCapability, showDomain, showScope, showAbout,
} from '@/composables/use-navigation';
import { assistant, composerRef } from '@/composables/use-assistant';
import { useFilePicker } from '@/composables/use-file-picker';
import { error as detectionError, hasActive, isRemote, newConversation, sendRequest } from '@/composables/use-detection';
import { activeNav, setTheme, useTheme, type Theme } from '@/composables/use-theme';

const route = useRoute();
const router = useRouter();
const theme = useTheme();

const textareaEl = ref<HTMLTextAreaElement | null>(null);
const selectedDomain = ref<string | null>(null);

/* 输入框增强：左下加号菜单（添加文件 / 选择技能）；模型切换已抽为 <ModelPicker> */
const plusOpen = ref(false);
const selectedSkill = ref<string | null>(null);
const skillName = computed(() => capabilities.find((c) => c.id === selectedSkill.value)?.name ?? '');
function pickSkill(id: string) { selectedSkill.value = id; plusOpen.value = false; }

const dark = computed(() => theme.value === 'dark');
const prompt = computed({
  get: () => assistant.prompt,
  set: (value: string) => { assistant.prompt = value; },
});

/* 进入页面时按 URL 同步主题;深蓝样式的注入/卸载统一由 setTheme 处理(见 use-theme) */
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

/* 深链参数(?module=) */
onMounted(() => {
  activeNav.value = '首页';
  const queryModule = route.query.module;
  if (typeof queryModule === 'string') openModule(queryModule as never, router);
});

/* 页面级事件代理:弹窗外静态入口(能力网格 / 平台支撑 / 建议按钮) */
function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.capability) { showCapability(button.dataset.capability); return; }
  if (button.dataset.domain) { selectedDomain.value = button.dataset.domain; showDomain(button.dataset.domain); return; }
  if (button.dataset.suggestion) handleDelegatedClick(target, router);
}
onMounted(() => document.addEventListener('click', onDocumentClick));
onUnmounted(() => document.removeEventListener('click', onDocumentClick));

function onDomainClick(id: string) {
  selectedDomain.value = id;
  showDomain(id);
}

/* 附件：远程模式下随首条消息真实上传（见 goDetection → sendRequest），演示模式仅留在本地 */
const {
  inputEl: fileInput, onChosen: onFilesChosen, removeAt: removeFile,
  open: openFilePicker, clear: clearFiles,
} = useFilePicker(toRef(assistant, 'files'), {
  onAdded: (added) => { if (added.length && !isRemote) message.info('文件已添加到本地演示，未上传。', 3.6); },
});
function pickFiles() {
  plusOpen.value = false; // 先收起加号菜单，避免唤起原生文件框后菜单停留在打开态
  openFilePicker();
}

/* 开始对话 → 真实接口发送首条消息，跳转智能检测页继续对话(全局会话 store 接管流式回复) */
const sendingHome = ref(false);
async function goDetection() {
  const text = assistant.prompt.trim();
  if (!text && !assistant.files.length) {
    message.warning('请描述你的需求，或添加图像 / 文件。', 3.6);
    textareaEl.value?.focus();
    return;
  }
  if (!isRemote) { message.error('后端未启用，请前往智能检测使用本地演示。', 3.6); return; }
  if (sendingHome.value) return;
  // 首页入口语义 = 新对话：先重置残留的激活会话(上次访问检测页留下的 activeId)，
  // 否则 sendRequest 会把消息发进旧会话，看起来"没有创建对话"
  if (hasActive.value) newConversation();
  sendingHome.value = true;
  await sendRequest(text, [...assistant.files], selectedSkill.value || 'auto');
  sendingHome.value = false;
  if (detectionError.value) {
    message.error(detectionError.value, 3.6);
    return;
  }
  assistant.prompt = '';
  clearFiles();
  selectedSkill.value = null;
  void router.push({ path: '/detection', query: dark.value ? { theme: 'dark' } : {} });
}

function onPromptKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    goDetection();
  }
}

/* 首页布局数据 */
const sharedLinks: Array<[string, string]> = [
  ['智能检测', '智能检测'], ['任务中心', '结果复核'], ['任务中心', '报告归档'],
  ['知识中心', '知识增强'], ['模型工坊', '模型迭代'],
];

const thumbStyle = (c: (typeof capabilities)[number]) => ({
  backgroundImage: `url('${c.image}')`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
});

function toggleTheme() {
  const next: Theme = dark.value ? 'light' : 'dark';
  setTheme(next);
  router.replace({ path: '/', query: next === 'dark' ? { theme: 'dark' } : {} });
}

void showAllDomains;
void composerRef;
</script>

<template>
  <main>
    <section class="panorama" aria-labelledby="hero-title">
      <div class="panorama-art" role="img" :aria-label="dark ? '深蓝机库中的航空发动机全景' : '航空发动机与全生命周期七大业务领域的银白全景'"></div>

      <!-- 银白版标题 -->
      <div v-if="!dark" class="hero-heading">
        <!-- <div class="eyebrow">AEROSPACE · VISION · INTELLIGENCE</div>
        <h1 id="hero-title">看见全生命周期</h1>
        <p>让智能视觉助手连接规划与专业能力</p> -->
      </div>
      <!-- 深蓝版标题 -->
      <div v-else class="hero-heading">
        <div class="eyebrow">AEROSPACE · VISION · INTELLIGENCE</div>
        <h1 id="hero-title">全生命周期视界<br><span>从一次智能交互开始</span></h1>
        <p>连接七大业务领域，聚焦本期专业能力</p>
      </div>

      <div v-if="!dark" class="panorama-caption">
        <!-- <span>全生命周期规划</span><i></i><span>七大业务领域</span> -->
      </div>
      <div v-else class="domain-section-label">
        <strong>七大业务领域</strong><span>FULL LIFECYCLE</span>
      </div>

      <div class="domain-nav" aria-label="七大领域">
        <button v-for="d in domains" :key="d.id" class="domain-button" :data-domain="d.id"
          :class="{ selected: selectedDomain === d.id }" :aria-label="`查看${d.name}领域规划`" @click="onDomainClick(d.id)">
          <IconSvg :name="d.icon" />
          <strong>{{ d.name }}</strong>
          <small>{{ domainNames[d.id] }}</small>
        </button>
      </div>

      <section class="assistant" aria-label="全生命周期智能视觉助手">
        <div class="assistant-heading">
          <div>
            <span class="assistant-symbol">
              <IconSvg name="spark" />
            </span>
            <h2>全生命周期智能视觉助手</h2>
          </div>
        </div>
        <div ref="composerRef" class="composer composer-v2">
          <label class="sr-only" for="prompt">向智能视觉助手描述需求</label>
          <textarea id="prompt" ref="textareaEl" v-model="prompt" maxlength="3000"
            :placeholder="dark ? '今天帮你做些什么？描述需求，或发起专业图像分析…' : '今天帮你做些什么？添加上下文，或调用技能与指令…'"
            @keydown="onPromptKeydown"></textarea>

          <div v-if="assistant.files.length || selectedSkill" class="composer-chips">
            <span v-for="(f, i) in assistant.files" :key="`f-${f.name}-${f.size}-${f.lastModified}`" class="cchip">
              <IconSvg name="paperclip" /><em>{{ f.name }}</em>
              <button type="button" :aria-label="`移除 ${f.name}`" @click="removeFile(i)">×</button>
            </span>
            <span v-if="selectedSkill" class="cchip cchip-skill">
              <IconSvg name="spark" /><em>{{ skillName }}</em>
              <button type="button" aria-label="移除技能" @click="selectedSkill = null">×</button>
            </span>
          </div>

          <div class="composer-toolbar">
            <div class="toolbar-left">
              <a-dropdown v-model:open="plusOpen" :trigger="['click']" placement="topLeft"
                overlay-class-name="assistant-menu">
                <button class="tool-plus" type="button" aria-label="添加文件与技能">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item key="file" @click="pickFiles">
                      <IconSvg name="paperclip" /><span>添加文件</span>
                    </a-menu-item>
                    <a-menu-item-group title="选择技能">
                      <a-menu-item v-for="c in capabilities" :key="`sk-${c.id}`" @click="pickSkill(c.id)">
                        <IconSvg :name="c.icon" /><span>{{ c.name }}</span>
                        <svg v-if="selectedSkill === c.id" class="assistant-menu-check" viewBox="0 0 24 24"
                          aria-hidden="true">
                          <path d="m5 12 5 5 9-11" />
                        </svg>
                      </a-menu-item>
                    </a-menu-item-group>
                  </a-menu>
                </template>
              </a-dropdown>
              <input ref="fileInput" hidden type="file" multiple @change="onFilesChosen">
            </div>

            <div class="toolbar-right">
              <ModelPicker />
              <span class="char-count">{{ prompt.length }}/3000</span>
              <SendButton :loading="sendingHome" :disabled="sendingHome"
                label="开始对话" loading-label="正在启动会话" @click="goDetection" />
            </div>
          </div>
        </div>
        <div class="suggestions">
          <span>快捷技能</span>
          <button v-for="c in capabilities" :key="c.id" type="button" class="skill-chip"
            :class="{ 'skill-active': selectedSkill === c.id }" :aria-label="`选择技能${c.name}`" @click="pickSkill(c.id)">
            <IconSvg :name="c.icon" />{{ c.name }}
          </button>
        </div>
      </section>
    </section>

    <section class="current-scope" aria-labelledby="scope-title">
      <div class="scope-title">
        <span class="scope-eyebrow">PHASE 01</span>
        <h2 id="scope-title">本期建设</h2>
        <p>六项专业能力</p>
        <button type="button" @click="showScope">查看建设范围</button>
      </div>
      <div class="capability-grid">
        <button v-for="(c, i) in capabilities" :key="c.id" class="capability" :data-capability="c.id"
          :aria-label="`查看${c.name}专业能力`" @click="showCapability(c.id)">
          <div class="capability-head">
            <h3>{{ c.name }}</h3><small>0{{ i + 1 }}</small>
          </div>
          <span class="capability-desc">{{ c.desc }}</span>
          <div class="thumb" :style="thumbStyle(c)"></div>
        </button>
      </div>
      <div class="shared-capabilities">
        <span>统一平台支撑</span>
        <template v-for="(item, i) in sharedLinks" :key="i">
          <b v-if="i > 0">/</b>
          <button type="button" :data-nav="item[0]" @click="openModule(item[0] as never, router)">{{ item[1] }}</button>
        </template>
      </div>
    </section>
  </main>

  <footer>
    <!-- <span>全生命周期规划 · 本期专业能力 · 统一智能入口</span> -->
    <div class="footer-links">
      <!-- <a href="#" @click.prevent="toggleTheme">{{ dark ? '切换银白版 ↗' : '切换深蓝版 ↗' }}</a>
      <button type="button" @click="showAbout">演示说明</button> -->
    </div>
  </footer>

  <AppDialog />
</template>
