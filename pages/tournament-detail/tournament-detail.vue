<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import {
  cancelTournament,
  cancelTournamentEntry,
  drawTournament,
  getTournament,
  RANK_TEXT,
  TOURNAMENT_FORMAT,
} from '../../common/api/tournament'
import { navigateTo, backOrHome } from '../../common/nav'
import { toastError } from '../../common/util'
import { useAuth } from '../../common/store/auth'

const { user } = useAuth()

const id = ref(null)
const detail = ref(null)
const loading = ref(false)
const acting = ref(false)

/** 当前登录用户在这个赛事里的参赛单位（可能报了多个组别） */
const myEntries = computed(() => detail.value?.myEntries || [])
const canJoin = computed(
  () => detail.value && detail.value.openForEntry && myEntries.value.length === 0,
)
const canDraw = computed(
  () =>
    detail.value &&
    detail.value.status === 0 &&
    (detail.value.admin || detail.value.id === user.value?.userId),
)

async function load() {
  loading.value = true
  try {
    detail.value = await getTournament(id.value)
    uni.setNavigationBarTitle({ title: detail.value.title || '赛事详情' })
  } catch (e) {
    toastError(e, '赛事加载失败')
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

onLoad((options) => {
  id.value = Number(options.id)
})
onShow(load)
onPullDownRefresh(load)

function goEntry() {
  if (!user.value) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    return
  }
  navigateTo(`/pages/tournament-entry/tournament-entry?id=${id.value}`)
}

function goBracket() {
  navigateTo(`/pages/tournament-bracket/tournament-bracket?id=${id.value}`)
}

function goMatches() {
  navigateTo(`/pages/tournament-matches/tournament-matches?id=${id.value}`)
}

function confirmDraw() {
  if (!detail.value) return
  const g = detail.value.groupSize
  const a = detail.value.advancePerGroup
  uni.showModal({
    title: '确认抽签分组',
    content: `将按每组 ${g} 队随机打散，每组前 ${a} 名晋级淘汰赛。\n抽签后不可再改报名，如需重来请先取消赛事。`,
    confirmText: '确认抽签',
    success: async (res) => {
      if (!res.confirm) return
      acting.value = true
      try {
        await drawTournament(id.value)
        uni.showToast({ title: '抽签完成', icon: 'success' })
        await load()
      } catch (e) {
        toastError(e, '抽签失败')
      } finally {
        acting.value = false
      }
    },
  })
}

function confirmCancelTournament() {
  uni.showModal({
    title: '取消赛事',
    content: '取消后所有球友都无法再查看该赛事的赛程，确定吗？',
    confirmText: '确定取消',
    success: async (res) => {
      if (!res.confirm) return
      acting.value = true
      try {
        await cancelTournament(id.value)
        uni.showToast({ title: '赛事已取消', icon: 'none' })
        await load()
      } catch (e) {
        toastError(e, '取消失败')
      } finally {
        acting.value = false
      }
    },
  })
}

function confirmWithdraw(entry) {
  uni.showModal({
    title: '撤回报名',
    content: `确定撤回「${entry.formatName}」的报名吗？`,
    success: async (res) => {
      if (!res.confirm) return
      try {
        await cancelTournamentEntry(id.value, entry.entryId)
        uni.showToast({ title: '已撤回', icon: 'none' })
        await load()
      } catch (e) {
        toastError(e, '撤回失败')
      }
    },
  })
}

function formatText(code) {
  return TOURNAMENT_FORMAT[code]?.text || '未知'
}
</script>

<template>
  <view class="page">
    <view v-if="loading && !detail" class="state">加载中…</view>
    <view v-else-if="!detail" class="state">赛事不存在或已被删除</view>

    <template v-else>
      <view class="head">
        <text class="title">{{ detail.title }}</text>
        <text class="status">{{ detail.statusText }}</text>
      </view>

      <view class="block">
        <view class="line">
          <text class="k">比赛日期</text>
          <text class="v">{{ detail.playDate || '待定' }}</text>
        </view>
        <view class="line">
          <text class="k">比赛地点</text>
          <text class="v">{{ detail.locationName || '待定' }}</text>
        </view>
        <view class="line">
          <text class="k">赛制</text>
          <text class="v">每组 {{ detail.groupSize }} 队 · 每组前 {{ detail.advancePerGroup }} 名晋级</text>
        </view>
        <view class="line">
          <text class="k">积分</text>
          <text class="v">本赛事不计入ELO积分</text>
        </view>
        <view v-if="detail.remark" class="remark">{{ detail.remark }}</view>
      </view>

      <view class="block">
        <view class="block-title">参赛组别</view>
        <view v-for="f in detail.formats" :key="f.format" class="fmt">
          <view class="fmt-head">
            <text class="fmt-name">{{ f.formatName }}</text>
            <text v-if="f.joined" class="chip mine">已报名</text>
            <text v-else-if="f.full" class="chip full">已满</text>
            <text v-else-if="f.groupCount" class="chip">已分 {{ f.groupCount }} 组</text>
          </view>
          <view class="fmt-meta">
            {{ f.entryCount }} / {{ f.maxEntries }} 队 · 上限 {{ f.maxPeople }} 人
          </view>
          <view class="bar">
            <view
              class="bar-in"
              :style="{ width: Math.min(100, Math.round((f.entryCount / f.maxEntries) * 100)) + '%' }"
            />
          </view>
        </view>
      </view>

      <view v-if="myEntries.length" class="block">
        <view class="block-title">我的参赛</view>
        <view v-for="m in myEntries" :key="m.entryId" class="mine">
          <view class="mine-main">
            <text class="mine-name">{{ m.name }}</text>
            <text class="chip">{{ m.formatName }}{{ m.groupNo ? ' ' + m.groupNo + ' 组' : '' }}</text>
          </view>
          <view class="mine-meta">
            <text>{{ m.statusText }}</text>
            <text v-if="m.eliminatedText"> · {{ m.eliminatedText }}</text>
            <text v-if="m.finalRank && m.finalRank <= 3"> · {{ RANK_TEXT[m.finalRank] }}</text>
          </view>
          <text
            v-if="detail.openForEntry"
            class="link"
            @click="confirmWithdraw(m)"
          >撤回</text>
        </view>
      </view>

      <view v-if="detail.podium && detail.podium.length" class="block">
        <view class="block-title">领奖台</view>
        <view v-for="p in detail.podium" :key="`${p.format}-${p.rank}`" :class="['podium', 'p' + p.rank]">
          <text class="p-rank">{{ RANK_TEXT[p.rank] }}</text>
          <view class="p-body">
            <text class="p-name">{{ p.name }}</text>
            <text class="p-meta">{{ p.formatName }}</text>
          </view>
        </view>
      </view>

      <view v-if="canDraw" class="block admin">
        <view class="block-title">赛务管理</view>
        <view class="admin-tip">
          抽签会把每个组别的参赛队随机打散，并生成小组赛组内循环赛程；抽签后不可再改报名。
        </view>
        <view class="admin-actions">
          <view class="btn primary" @click="confirmDraw">{{ acting ? '处理中…' : '抽签分组' }}</view>
          <view class="btn" @click="confirmCancelTournament">取消赛事</view>
        </view>
      </view>

      <view class="actions">
        <view v-if="canJoin" class="btn primary" @click="goEntry">我要报名</view>
        <view class="btn" :class="{ primary: !canJoin }" @click="goBracket">对阵图</view>
        <view class="btn" @click="goMatches">赛程录入</view>
      </view>

      <view class="back" @click="backOrHome()">返回赛事列表</view>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding: 14px 16px 40px;
}
.state {
  margin-top: 60px;
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  background: #0c3125;
  color: #faf7f0;
}
.title {
  flex: 1;
  font-size: 18px;
  font-weight: 800;
}
.status {
  padding: 3px 10px;
  border-radius: 20px;
  background: #e5c84b;
  font-size: 11px;
  font-weight: 700;
  color: #1a2e2a;
}
.block {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.block-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
}
.line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  font-size: 12px;
}
.k {
  color: #5a726d;
}
.v {
  flex: 1;
  text-align: right;
  color: #1a2e2a;
  font-weight: 600;
}
.remark {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f0f2f1;
  font-size: 12px;
  line-height: 18px;
  color: #5a726d;
}
.fmt {
  padding: 10px 0;
  border-bottom: 1px solid #f4f6f5;
}
.fmt:last-child {
  border-bottom: none;
}
.fmt-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fmt-name {
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.fmt-meta {
  margin-top: 4px;
  font-size: 11px;
  color: #5a726d;
}
.bar {
  margin-top: 6px;
  height: 4px;
  border-radius: 4px;
  background: #f0f2f1;
  overflow: hidden;
}
.bar-in {
  height: 100%;
  background: #14665b;
}
.chip {
  padding: 1px 7px;
  border-radius: 20px;
  background: #eef3f1;
  font-size: 10px;
  font-weight: 700;
  color: #14665b;
}
.chip.mine {
  background: #e5c84b;
  color: #1a2e2a;
}
.chip.full {
  background: #f0efea;
  color: #9aa8a4;
}
.mine {
  position: relative;
  padding: 10px 0;
  border-bottom: 1px solid #f4f6f5;
}
.mine:last-child {
  border-bottom: none;
}
.mine-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 36px;
}
.mine-name {
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.mine-meta {
  margin-top: 4px;
  font-size: 11px;
  color: #5a726d;
}
.link {
  position: absolute;
  right: 0;
  top: 10px;
  font-size: 11px;
  color: #b0483b;
}
.podium {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.p-rank {
  width: 44px;
  padding: 3px 0;
  border-radius: 6px;
  text-align: center;
  font-size: 11px;
  font-weight: 800;
  color: #1a2e2a;
}
.podium.p1 .p-rank {
  background: #e5c84b;
}
.podium.p2 .p-rank {
  background: #cfd8d5;
}
.podium.p3 .p-rank {
  background: #d8b48a;
}
.podium.p4 .p-rank {
  background: #f0efea;
  color: #5a726d;
}
.p-body {
  display: flex;
  flex-direction: column;
}
.p-name {
  font-size: 13px;
  font-weight: 700;
  color: #1a2e2a;
}
.p-meta {
  font-size: 11px;
  color: #5a726d;
}
.admin {
  border-color: #e5c84b;
}
.admin-tip {
  font-size: 11px;
  line-height: 17px;
  color: #5a726d;
}
.admin-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.btn {
  flex: 1;
  padding: 11px 0;
  border: 1px solid #14665b;
  border-radius: 8px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: #14665b;
  background: #ffffff;
}
.btn.primary {
  background: #e5c84b;
  border-color: #e5c84b;
  color: #1a2e2a;
}
.back {
  margin-top: 18px;
  text-align: center;
  font-size: 12px;
  color: #5a726d;
}
</style>