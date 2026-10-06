<script setup lang="ts">
import IconSvg from '@/components/IconSvg.vue';
</script>

<template>
  <div class="task-panel">
    <div class="kb-planned">
      <span class="kb-planned-ico"><IconSvg name="box" /></span>
      <h3>内网采集任务</h3>
      <p>该子功能在原型中标记为「建」（规划中），本期未建设页面。</p>
      <div class="kb-planned-items">
        <div class="kb-planned-card"><strong>采集范围</strong><span>在授权范围内从内网系统采集、解析、分类资料。</span></div>
        <div class="kb-planned-card"><strong>来源追溯</strong><span>采集记录保留来源、版本与采集时间，供知识库检索引用。</span></div>
        <div class="kb-planned-card"><strong>调度与状态</strong><span>定时任务、增量采集与失败重试，需接入采集服务后开放。</span></div>
      </div>
      <p class="kb-planned-note">当前页面不展示虚构的采集任务或运行状态；正式接入后在此呈现。</p>
    </div>
  </div>
</template>
