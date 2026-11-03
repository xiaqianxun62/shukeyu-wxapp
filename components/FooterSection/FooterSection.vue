<template>
  <view class="foot">
    <text class="foot-text">{{ displayText }}</text>
  </view>
</template>

<script setup>
/**
 * uni-app 页脚组件：页脚文案由 PC 官网「站点文案」页统一配置（GET /settings/footer）。
 *
 * - 拉取失败或未配置文案时，展示本地默认兜底文案，保证页脚不空
 * - 支持 props.text 覆盖，方便个别页面使用专属文案
 */
import { computed, onMounted, ref } from 'vue'
import { getFooter } from '../../common/api/settings'

/** 默认兜底文案：后端未配置时展示 */
const DEFAULT_TEXT = 'by 2026@千巽'

const props = defineProps({
  /** 外部指定文案；非空时优先于后台配置 */
  text: { type: String, default: '' },
})

/** 后台配置的页脚文案 */
const configuredText = ref('')

const displayText = computed(() => {
  if (props.text) return props.text
  return configuredText.value || DEFAULT_TEXT
})

onMounted(async () => {
  try {
    const data = await getFooter()
    if (data && typeof data.text === 'string') {
      configuredText.value = data.text.trim()
    }
  } catch {
    // 拉不动就用默认兜底文案，不影响页面
  }
})
</script>

<style scoped>
.foot {
  margin-top: 20px;
  text-align: center;
  font-size: 11px;
  color: #5a726d;
}
.foot-text {
  font-size: 11px;
  color: #5a726d;
}
</style>
