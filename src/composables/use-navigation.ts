import { reactive } from 'vue';
import type { Router } from 'vue-router';
import { domains, capabilities } from '@/data';
import {
  aboutContent, allDomainsIntro, knowledgeCenterContent, moduleConfigs,
  phaseCapabilitiesNotice, scopeContent,
} from '@/data/module-content';
import { domainNames } from '@/data/domains';
import { iconPath } from '@/data/icon-paths';
import { esc } from '@/utils/export';
import type { Domain, NavName, ProfessionalCapability } from '@/data/types';
import { useTheme } from './use-theme';
import { focusAssistant } from './use-assistant';

/** 弹窗动作按钮 */
export interface DialogAction {
  label: string;
  primary?: boolean;
  run?: () => void;
}

/** 全局内容弹窗状态(原 dialog 元素) */
const dialog = reactive({
  open: false,
  eyebrow: '',
  title: '',
  badge: '',
  subtitle: '',
  body: '',
  actions: [] as DialogAction[],
});

const svg = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPath(name)}</svg>`;

const miniTools = (list: ProfessionalCapability[] = capabilities) =>
  `<div class="mini-tools">${list
    .map((c) => `<button data-capability="${c.id}">${svg(c.icon)}${c.name}</button>`)
    .join('')}</div>`;

const flow = (items: string[]) =>
  `<div class="module-flow">${items.map((item, i) => `<span>${i + 1}　${item}</span>`).join('')}</div>`;

const detailCards = (items: Array<[string, string]>) =>
  `<div class="detail-grid">${items
    .map(([title, text]) => `<div class="detail-card"><h4>${title}</h4><p>${text}</p></div>`)
    .join('')}</div>`;

const goHome = () => {
  closeDialog();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

export interface DialogOptions {
  /** 是否自动追加“返回首页”按钮（默认 true） */
  withHome?: boolean;
  /** 标题右侧小徽标（如“规划中”） */
  badge?: string;
  /** 标题下方副标题 */
  subtitle?: string;
}

export function showDialog(title: string, eyebrow: string, body: string, actions: DialogAction[] = [], opts: DialogOptions = {}) {
  dialog.title = title;
  dialog.eyebrow = eyebrow;
  dialog.badge = opts.badge ?? '';
  dialog.subtitle = opts.subtitle ?? '';
  dialog.body = body;
  dialog.actions = opts.withHome === false ? [...actions] : [...actions, { label: '返回首页', run: goHome }];
  dialog.open = true;
}

export function closeDialog() {
  dialog.open = false;
}

export function useDialog() {
  return dialog;
}

/** 当前主题下的首页路径参数 */
export function homeLocation() {
  return useTheme().value === 'dark' ? { path: '/', query: { theme: 'dark' } } : { path: '/' };
}

export function showDomain(id: string) {
  const d = domains.find((v) => v.id === id);
  if (!d) return;
  document.querySelectorAll<HTMLElement>('[data-domain]').forEach(
    (b) => b.classList.toggle('selected', b.dataset.domain === id),
  );
  const current = capabilities.filter((c) => c.domains.includes(id));
  const capText = current.length
    ? current.map((c) => `<span class="dom-cap">${c.name}</span>`).join('')
    : '暂未配置本期专业工具。';
  const scenes = d.plans
    .map(
      (x) => `<div class="dom-scene">
        <span class="dom-scene-icon">${svg(x.icon)}</span>
        <div class="dom-scene-main"><strong>${x.title}</strong><small>${x.desc}</small></div>
      </div>`,
    )
    .join('');
  showDialog(
    d.full,
    '全生命周期规划 / ' + domainNames[id],
    `<div class="dom-stats">
        <div class="dom-stat">
          <span class="dom-stat-label">规划场景</span>
          <span class="dom-stat-num">${d.count}<i>项</i></span>
          <small class="dom-stat-note">规划场景不代表已建成能力。</small>
        </div>
        <div class="dom-stat">
          <span class="dom-stat-label">本期关联能力</span>
          <p class="dom-stat-text">${capText}</p>
        </div>
      </div>
      <div class="dom-scenes-head"><h3>代表性规划场景</h3><span class="tag planned">规划拓展</span></div>
      <div class="dom-scenes">${scenes}</div>
      <p class="dom-foot">以上为代表性场景，后续按建设计划逐步拓展。</p>`,
    [{ label: '关闭', primary: true, run: closeDialog }],
    { withHome: false, badge: '规划中', subtitle: d.desc },
  );
}

export function showCapability(id: string) {
  const c = capabilities.find((x) => x.id === id);
  if (!c) return;
  showDialog(
    c.name,
    '本期建设 / 专业能力',
    `<p>${c.desc}。</p><div class="detail-grid"><div class="detail-card"><h4>输入要求</h4><p>${c.input}</p></div><div class="detail-card"><h4>专业输出</h4><p>${c.result}</p></div></div>${flow(
      c.flow,
    )}<h3>关联业务领域</h3><div class="mini-tools">${c.domains
      .map((domainId) => `<button data-domain="${domainId}">${domains.find((d) => d.id === domainId)?.name}</button>`)
      .join('')}</div>${
      c.id === 'thermal' ? '<div class="notice">热部图像的专业检测对象与算法目标，需要在业务确认后固化。</div>' : ''
    }`,
    [{ label: '带入智能视觉助手', primary: true, run: () => focusAssistant(c.prompt) }],
  );
}

export function showAllDomains() {
  showDialog(
    '七大领域 · 全生命周期规划',
    '全景规划 / 125 项业务场景',
    `<p>${allDomainsIntro}</p><div class="detail-grid">${domains
      .map(
        (d) =>
          `<div class="detail-card"><h4>${d.name}</h4><p>${d.desc}</p><button class="secondary" data-domain="${d.id}">查看领域规划</button></div>`,
      )
      .join('')}</div><p class="muted" style="margin-top:16px">125 项为全生命周期规划场景；本期建设聚焦六项专业能力与统一平台支撑。</p>`,
  );
}

export function showScope() {
  showDialog(
    '本期建设范围',
    scopeContent.eyebrow,
    `<p>${scopeContent.intro}</p>${miniTools()}${flow(scopeContent.flow)}${detailCards(scopeContent.items)}`,
  );
}

export function showUserCenter() {
  showDialog(
    '用户中心',
    '演示用户 / 通用身份',
    `<div class="empty-state">${svg('shield')}<h3>演示用户</h3><p>本页面使用通用身份展示。</p></div><div class="notice">正式接入平台后，此处显示授权用户的个人设置与访问权限。</div>`,
  );
}

export function showAbout() {
  showDialog(
    '关于此网页',
    aboutContent.eyebrow,
    `<p>${aboutContent.intro}</p><ul>${aboutContent.points.map((p) => `<li>${p}</li>`).join('')}</ul><p class="muted">${aboutContent.footnote}</p>`,
  );
}

/** 助手本地规则回复(带引用原文) */
export function replyAssistant(title: string, quoted: string, html: string, actions: DialogAction[] = []) {
  showDialog(
    title,
    '全生命周期智能视觉助手 / ',
    `<div class="quoted-prompt">${esc(quoted)}</div><div class="assistant-reply"><div class="reply-icon">${svg(
      'spark',
    )}</div><div class="reply-content">${html}</div></div>`,
    actions,
  );
}

/** 顶部导航 / 平台支撑入口 */
export function openModule(name: NavName, router?: Router) {
  const onHome = router ? router.currentRoute.value.path === '/' : true;
  if (name === '智能检测') {
    if (router) {
      router.push({ path: '/detection', query: useTheme().value === 'dark' ? { theme: 'dark' } : {} });
    } else {
      focusAssistant();
    }
    return;
  }
  if (name === '任务中心') {
    if (router) {
      router.push({ path: '/tasks', query: useTheme().value === 'dark' ? { theme: 'dark' } : {} });
    } else {
      focusAssistant();
    }
    return;
  }
  if (name === '知识中心') {
    if (router) {
      router.push({ path: '/knowledge', query: useTheme().value === 'dark' ? { theme: 'dark' } : {} });
    } else {
      focusAssistant();
    }
    return;
  }
  if (name === '工具服务中心') {
    if (router) {
      router.push({ path: '/tools', query: useTheme().value === 'dark' ? { theme: 'dark' } : {} });
    } else {
      focusAssistant();
    }
    return;
  }
  if (name === '后台管理') {
    if (router) {
      router.push({ path: '/admin', query: useTheme().value === 'dark' ? { theme: 'dark' } : {} });
    }
    return;
  }
  if (!onHome) {
    const query: Record<string, string> = { module: name };
    if (useTheme().value === 'dark') query.theme = 'dark';
    router!.push({ path: '/', query });
    return;
  }
  if (name === '首页') {
    closeDialog();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (name === '能力中心') {
    router!.push({ path: '/capabilities', query: useTheme().value === 'dark' ? { theme: 'dark' } : {} });
    return;
  }
  const m = moduleConfigs[name];
  if (m) {
    showDialog(
      name,
      m.eyebrow,
      `<p>${m.intro}</p>${detailCards(m.items)}${flow(m.flow)}<p class="muted">当前为首页导航与模块职责演示，业务管理功能待接入现有平台。</p>`,
    );
  }
}

/** 弹窗正文内按钮的事件代理(对应原 document click 中作用于 dialog 的部分) */
export function handleDelegatedClick(target: HTMLElement, router?: Router) {
  const button = target.closest<HTMLButtonElement>('button');
  if (!button) return false;
  if (button.dataset.nav) {
    openModule(button.dataset.nav as NavName, router);
    return true;
  }
  if (button.dataset.domain) {
    showDomain(button.dataset.domain);
    return true;
  }
  if (button.dataset.capability) {
    showCapability(button.dataset.capability);
    return true;
  }
  if (button.dataset.suggestion) {
    const kind = button.dataset.suggestion;
    if (kind === '规划') showAllDomains();
    else if (kind === '能力') openModule('能力中心', router);
    else focusAssistant(knowledgeCenterContent.assistantPrompt);
    return true;
  }
  return false;
}

/** 领域 id → 领域对象 */
export const findDomain = (id: string): Domain | undefined => domains.find((d) => d.id === id);
