<script setup>
import { ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { fetchRanking } from '../../common/api/ranking'
import { AVATAR_COLORS, toastError, resolveUrl } from '../../common/util'
import SmartImage from '../../components/SmartImage/SmartImage.vue'

const list = ref([])
const loading = ref(false)
/** 榜单类别：1单打 2双打(同性别) 3混双 */
const rankType = ref(1)
const RANK_TABS = [
  { value: 1, label: '单打榜' },
  { value: 2, label: '双打榜' },
  { value: 3, label: '混双榜' },
]

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
const navbarHeight = statusBarHeight + 44

async function load() {
  loading.value = true
  try {
    list.value = await fetchRanking(20, rankType.value)
  } catch (e) {
    toastError(e, '榜单加载失败')
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

/** 切换榜单类别并重载 */
function switchType(t) {
  if (rankType.value === t) return
  rankType.value = t
  load()
}

onShow(() => {
  load()
})

onPullDownRefresh(() => {
  load()
})

function colorOf(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

function medalText(rank) {
  if (rank === 1) return '冠'
  if (rank === 2) return '亚'
  if (rank === 3) return '季'
  return String(rank)
}

function winRate(item) {
  const total = item.win + item.loss
  if (!total) return '暂无战绩'
  return `胜率 ${Math.round((item.win / total) * 100)}%`
}
</script>

<template>
  <view class="page">
    <view class="navbar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-title">ELO 积分榜</view>
    </view>

    <view class="hero">
      <view class="hero-title">ELO 积分榜</view>
      <view class="hero-desc">每场对局自动结算，榜单实时更新</view>
      <!-- 榜单类别：单打 / 双打(同性别) / 混双 -->
      <view class="tabs">
        <view
          v-for="t in RANK_TABS"
          :key="t.value"
          :class="['tab', { on: rankType === t.value }]"
          @click="switchType(t.value)"
        >
          <text>{{ t.label }}</text>
        </view>
      </view>
    </view>

    <view v-if="loading && !list.length" class="state">加载中…</view>
    <view v-else-if="!list.length" class="state">还没有战绩数据</view>

    <view v-else class="board">
      <view
        v-for="(item, i) in list"
        :key="item.userId"
        :class="['row', { top: item.rank <= 3 }]"
      >
        <view :class="['rank', `r${Math.min(item.rank, 4)}`]">{{ medalText(item.rank) }}</view>
        <view v-if="item.avatar" class="avatar avatar-img-wrap">
          <SmartImage class="avatar-img" :src="item.avatar" mode="aspectFill" />
        </view>
        <view v-else class="avatar" :style="{ background: colorOf(item.userId) }">{{ item.name.charAt(0) }}</view>
        <view class="info">
          <text class="name">{{ item.name }}</text>
          <text class="meta">{{ winRate(item) }}</text>
        </view>
        <view class="score">
          <text class="rating">{{ item.rating }}</text>
          <text class="wins">{{ item.win }}胜 {{ item.loss }}负</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding-bottom: 30px;
}
.navbar {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0c3125;
  color: #faf7f0;
}
.nav-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 44px;
}
.hero {
  padding: 20px 16px;
  background: #0c3125;
  color: #faf7f0;
}
.hero-title {
  font-size: 20px;
  font-weight: 800;
}
.hero-desc {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.9;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.tab {
  flex: 1;
  height: 32px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.12);
  color: #cfdfd9;
  font-size: 13px;
  font-weight: 600;
}
.tab.on {
  background: #e5c84b;
  color: #1a2e2a;
}
.state {
  margin-top: 60px;
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
.board {
  padding: 14px 16px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 12px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.row.top {
  border-color: #cfdfd9;
  box-shadow: 0 2px 8px rgba(20, 102, 91, 0.1);
}
.rank {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  background: #f0efea;
  color: #5a726d;
}
.rank.r1 {
  background: #e5c84b;
  color: #1a2e2a;
}
.rank.r2 {
  background: #cfd8d5;
  color: #1a2e2a;
}
.rank.r3 {
  background: #d8b48a;
  color: #1a2e2a;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
}
.avatar-img-wrap {
  background: transparent;
}
.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.name {
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.meta {
  font-size: 11px;
  color: #5a726d;
}
.score {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.rating {
  font-size: 16px;
  font-weight: 800;
  color: #14665b;
}
.wins {
  font-size: 11px;
  color: #5a726d;
}
</style>
