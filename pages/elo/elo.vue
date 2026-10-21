<script setup>
import { computed, ref } from 'vue'
import { simulateElo } from '../../common/api/elo'
import { toastError } from '../../common/util'
import NavBack from '../../components/nav-back/nav-back.vue'

const maleCount = ref(4)
const femaleCount = ref(2)
const gamesPlayed = ref(0)
const roundRobin = ref(false)
const ratingsText = ref('1200,1300,1400,1250,1180,1320')
const result = ref(null)
const computing = ref(false)

/** 试算类别：1单打 2双打(同性别) 3混双 —— 未选具体编排方案时后端按类别预设赛制 */
const category = ref(1)
const CATEGORIES = [
  { value: 1, label: '单打' },
  { value: 2, label: '双打（同性别）' },
  { value: 3, label: '混双' },
]

function switchCategory(v) {
  if (category.value === v) return
  category.value = v
  schemeIndex.value = 0 // 类别决定默认赛制，清掉手动编排方案
}

/**
 * 编排方案：不传 = 按男女人数自动过滤（与线上编排一致）；
 * format 走「赛制」语义（单打 / 男双 / 女双 / 混双），schemeId 走 8 套编排方案
 */
const schemes = [
  { label: '自动（按人数）', value: 0 },
  { label: '全单打', value: 1, format: 1 },
  { label: '全混双', value: 2, format: 4 },
  { label: '全男双', value: 3, format: 2 },
  { label: '全女双', value: 4, format: 3 },
  { label: '混搭·混双优先', value: 5, schemeId: 5 },
  { label: '混搭·同性别优先', value: 6, schemeId: 6 },
]
const schemeIndex = ref(0)

const ratings = computed(() =>
  ratingsText.value
    .split(/[,，\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n)),
)

const countMismatch = computed(
  () => ratings.value.length && ratings.value.length !== Number(maleCount.value) + Number(femaleCount.value),
)

async function run() {
  if (countMismatch.value) {
    uni.showToast({
      title: `人数 ${Number(maleCount.value) + Number(femaleCount.value)} 与积分数量 ${ratings.value.length} 不一致`,
      icon: 'none',
    })
    return
  }
  computing.value = true
  try {
    const picked = schemes[schemeIndex.value] || schemes[0]
    const payload = {
      maleCount: Number(maleCount.value),
      femaleCount: Number(femaleCount.value),
      ratings: ratings.value,
      gamesPlayed: Number(gamesPlayed.value),
      roundRobin: roundRobin.value,
      category: category.value,
    }
    if (picked.format) payload.format = picked.format
    else if (picked.schemeId) payload.schemeId = picked.schemeId
    result.value = await simulateElo(payload)
  } catch (e) {
    toastError(e, '试算失败')
  } finally {
    computing.value = false
  }
}

function deltaText(delta) {
  return delta >= 0 ? `+${delta}` : String(delta)
}

function sideNames(sides) {
  return sides.map((s) => s.label).join(' / ')
}

function allSides(match) {
  return match.teamA.concat(match.teamB)
}
</script>

<template>
  <view class="page">
    <NavBack />

    <scroll-view class="body" scroll-y>
      <view class="intro">
        <view class="intro-title">ELO 试算实验室</view>
        <view class="intro-desc">
          调用后端真实编排与 ELO 计算器，按「先男后女」顺序传入初始积分，预演一场球局结束后的积分变化（不落库）。
        </view>
      </view>

      <view class="panel">
        <view class="col">
          <text class="row-label">试算类别</text>
          <view class="chips">
            <view
              v-for="c in CATEGORIES"
              :key="c.value"
              :class="['chip', { active: category === c.value }]"
              @click="switchCategory(c.value)"
            >
              {{ c.label }}
            </view>
          </view>
        </view>
        <view class="row">
          <text class="row-label">男生</text>
          <uni-number-box v-model="maleCount" :min="0" :max="12" />
        </view>
        <view class="row">
          <text class="row-label">女生</text>
          <uni-number-box v-model="femaleCount" :min="0" :max="12" />
        </view>
        <view class="row">
          <text class="row-label">历史场次</text>
          <uni-number-box v-model="gamesPlayed" :min="0" :max="60" />
        </view>
        <view class="row">
          <text class="row-label">循环赛</text>
          <switch :checked="roundRobin" color="#14665B" @change="roundRobin = $event.detail.value" />
        </view>
        <view class="col">
          <text class="row-label">编排方案</text>
          <view class="chips">
            <view
              v-for="s in schemes"
              :key="s.value"
              :class="['chip', { active: schemeIndex === s.value }]"
              @click="schemeIndex = s.value"
            >
              {{ s.label }}
            </view>
          </view>
          <text class="hint">
            混双要求男女人数相等；男双 / 女双各需至少 4 人
          </text>
        </view>
        <view class="col">
          <text class="row-label">初始积分（逗号分隔，先男后女）</text>
          <uni-easyinput type="textarea" v-model="ratingsText" placeholder="1200,1300,1400" />
          <text class="hint">已解析 {{ ratings.length }} 个积分</text>
        </view>
        <button class="run" type="button" :loading="computing" @click="run">开始试算</button>
      </view>

      <view v-if="result" class="panel">
        <view class="panel-title">方案：{{ result.schemeName }}</view>

        <view class="sub">积分变化</view>
        <view v-for="p in result.players" :key="p.id" class="player">
          <text class="player-label">{{ p.label }}</text>
          <text class="player-from">{{ p.rating }}</text>
          <text class="player-after">
            {{ p.finalRating == null ? p.rating : p.finalRating }}
          </text>
        </view>

        <view class="sub">对阵</view>
        <view v-for="(m, i) in result.matches" :key="i" class="match">
          <view class="match-head">
            <text class="format">{{ m.formatName }}</text>
            <text class="exp">A 胜率 {{ Math.round(m.expectedA * 100) }}%</text>
          </view>
          <view class="side">A：{{ sideNames(m.teamA) }}</view>
          <view class="side">B：{{ sideNames(m.teamB) }}</view>
          <view class="winner">胜方：{{ m.winner === 1 ? 'A 队' : 'B 队' }}</view>
          <view v-for="s in allSides(m)" :key="s.id" class="delta">
            {{ s.label }} {{ deltaText(s.delta) }} → {{ s.ratingAfter }}
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
}
.body {
  padding: 16px 16px 40px;
  box-sizing: border-box;
}
.intro {
  padding: 16px;
  border-radius: 12px;
  background: #0c3125;
  color: #faf7f0;
}
.intro-title {
  font-size: 18px;
  font-weight: 800;
}
.intro-desc {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.92;
}
.panel {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(20, 102, 91, 0.08);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f0efea;
}
.row-label {
  font-size: 13px;
  font-weight: 600;
  color: #0c3125;
}
.col {
  padding: 12px 0 0;
}
.hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: #5a726d;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.chip {
  padding: 4px 10px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #faf7f0;
  color: #5a726d;
  font-size: 11px;
}
.chip.active {
  background: #0c3125;
  border-color: #0c3125;
  color: #faf7f0;
  font-weight: 700;
}
.run {
  margin-top: 14px;
  height: 42px;
  line-height: 42px;
  border: none;
  border-radius: 10px;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 15px;
  font-weight: 700;
}
.panel-title {
  font-size: 14px;
  font-weight: 800;
  color: #1a2e2a;
}
.sub {
  margin: 14px 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: #5a726d;
}
.player {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  color: #1a2e2a;
}
.player-after {
  min-width: 60px;
  text-align: right;
  font-weight: 800;
  color: #0c3125;
}
.match {
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: #faf7f0;
}
.match-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.format {
  font-size: 12px;
  font-weight: 700;
  color: #0c3125;
}
.exp {
  font-size: 11px;
  color: #5a726d;
}
.side {
  font-size: 13px;
  color: #1a2e2a;
}
.winner {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #0c3125;
}
.delta {
  font-size: 11px;
  color: #5a726d;
}
</style>
