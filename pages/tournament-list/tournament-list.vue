<script setup>
import { ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { listTournaments, TOURNAMENT_STATUS } from '../../common/api/tournament'
import { navigateTo } from '../../common/nav'
import { toastError } from '../../common/util'

const list = ref([])
const loading = ref(false)
const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

async function load() {
  loading.value = true
  try {
    list.value = await listTournaments()
  } catch (e) {
    toastError(e, '赛事加载失败')
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

onShow(load)
onPullDownRefresh(load)

function open(item) {
  navigateTo(`/pages/tournament-detail/tournament-detail?id=${item.id}`)
}

function statusOf(item) {
  return TOURNAMENT_STATUS[item.status] || { text: '未知', color: '#5A726D' }
}

function dateText(playDate) {
  return playDate ? String(playDate).replace(/-/g, '/') : '待定'
}
</script>

<template>
  <view class="page">
    <view class="navbar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-title">大型比赛</view>
    </view>

    <view class="hero">
      <view class="hero-title">随机抽签 · 分组淘汰 · 角逐冠军</view>
      <view class="hero-desc">小组赛出十六强，再一路打到决赛，不看积分，胜负只由签运和手感决定</view>
    </view>

    <view v-if="loading && !list.length" class="state">加载中…</view>
    <view v-else-if="!list.length" class="state">
      <view>还没有正在报名的比赛</view>
    </view>

    <view v-else class="list">
      <view v-for="item in list" :key="item.id" class="card" @click="open(item)">
        <view class="card-top">
          <text class="title">{{ item.title }}</text>
          <text class="badge" :style="{ background: statusOf(item).color }">{{ statusOf(item).text }}</text>
        </view>

        <view class="tags">
          <text v-for="(name, i) in item.formatNames" :key="i" class="tag">{{ name }}</text>
          <text v-if="item.joined" class="tag joined">已报名</text>
        </view>

        <view class="meta">
          <text>{{ dateText(item.playDate) }}</text>
          <text v-if="item.location"> · {{ item.location }}</text>
        </view>

        <view class="foot">
          <text class="count">{{ item.entryCount }} 队已报名</text>
          <text v-if="item.championName" class="champ">冠军 · {{ item.championName }}</text>
          <text v-else class="limit">上限 {{ item.maxEntries }} 队 / 组</text>
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
  line-height: 18px;
  opacity: 0.9;
}
.state {
  margin-top: 60px;
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
.list {
  padding: 14px 16px;
}
.card {
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(20, 102, 91, 0.08);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.title {
  flex: 1;
  font-size: 15px;
  font-weight: 700;
  color: #1a2e2a;
}
.badge {
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  color: #1a2e2a;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.tag {
  padding: 2px 8px;
  border: 1px solid #cfdfd9;
  border-radius: 20px;
  font-size: 11px;
  color: #14665b;
}
.tag.joined {
  border-color: #e5c84b;
  background: #e5c84b;
  font-weight: 700;
}
.meta {
  margin-top: 10px;
  font-size: 12px;
  color: #5a726d;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f0f2f1;
  font-size: 11px;
}
.count {
  color: #14665b;
  font-weight: 700;
}
.limit {
  color: #9aa8a4;
}
.champ {
  color: #e5a800;
  font-weight: 700;
}
</style>