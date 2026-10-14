<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { getTournamentBracket, RANK_TEXT } from '../../common/api/tournament'
import { toastError } from '../../common/util'

const id = ref(null)
const board = ref(null)
const loading = ref(false)
const activeFormat = ref(null)

const formats = computed(() => board.value?.formats || [])
const current = computed(
  () => formats.value.find((f) => f.format === activeFormat.value) || formats.value[0] || null,
)

async function load() {
  loading.value = true
  try {
    board.value = await getTournamentBracket(id.value)
    if (!activeFormat.value && board.value.formats.length) {
      activeFormat.value = board.value.formats[0].format
    }
  } catch (e) {
    toastError(e, '对阵图加载失败')
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

/** 比分有填才展示成「21:19」，没填就只标谁赢 */
function scoreText(m) {
  if (m.scoreA == null || m.scoreB == null) return ''
  return `${m.scoreA}:${m.scoreB}`
}

function sideClass(m, side) {
  const team = side === 'a' ? m.teamA : m.teamB
  if (!m.winner) return ''
  return m.winner === (side === 'a' ? 1 : 2) ? 'win' : 'lose'
}

function topThree(ranking) {
  return ranking.filter((r) => r.rank <= 3)
}

function others(ranking) {
  return ranking.filter((r) => r.rank > 3)
}
</script>

<template>
  <view class="page">
    <view v-if="loading && !board" class="state">加载中…</view>
    <view v-else-if="!board" class="state">对阵图暂无数据</view>

    <template v-else>
      <view class="head">
        <text class="title">{{ board.title }}</text>
        <text class="sub">{{ board.statusText }} · 不计入ELO积分</text>
      </view>

      <view v-if="formats.length > 1" class="tabs">
        <view
          v-for="f in formats"
          :key="f.format"
          :class="['tab', { on: current && current.format === f.format }]"
          @click="activeFormat = f.format"
        >
          {{ f.formatName }}
        </view>
      </view>

      <template v-if="current">
        <view v-if="topThree(current.ranking).length" class="block">
          <view class="block-title">最终名次</view>
          <view v-for="r in topThree(current.ranking)" :key="r.entryId" :class="['podium', 'p' + r.rank]">
            <text class="p-rank">{{ RANK_TEXT[r.rank] }}</text>
            <view class="p-body">
              <text class="p-name">{{ r.name }}</text>
              <text v-if="r.groupNo" class="p-meta">{{ r.groupNo }} 组</text>
            </view>
          </view>
        </view>

        <view v-if="current.knockouts.length" class="block">
          <view class="block-title">淘汰赛</view>
          <view v-for="(round, ri) in current.knockouts" :key="ri" class="round">
            <view class="round-head">
              <text class="round-name">{{ round.roundName }}</text>
              <text v-if="round.finished" class="round-done">已完赛</text>
              <text v-else class="round-live">进行中</text>
            </view>
            <view
              v-for="m in round.matches"
              :key="m.id"
              :class="['match', { mine: m.involved }]"
            >
              <text :class="['side', 'a', sideClass(m, 'a')]">{{ m.teamA ? m.teamA.name : '待定' }}</text>
              <text class="score">
                <text v-if="scoreText(m)" class="score-num">{{ scoreText(m) }}</text>
                <text v-else class="score-vs">VS</text>
              </text>
              <text :class="['side', 'b', sideClass(m, 'b')]">{{ m.teamB ? m.teamB.name : '待定' }}</text>
            </view>
          </view>
        </view>

        <view v-for="g in current.groups" :key="g.groupId" class="block">
          <view class="round-head">
            <text class="round-name">{{ g.groupNo }} 组</text>
            <text class="round-meta">{{ g.entryCount }} 队</text>
          </view>

          <view class="stand">
            <view class="stand-row th">
              <text class="c-rank">名次</text>
              <text class="c-name">队伍</text>
              <text class="c-num">胜</text>
              <text class="c-num">负</text>
              <text class="c-num">净胜</text>
            </view>
            <view
              v-for="s in g.standings"
              :key="s.entryId"
              :class="['stand-row', { up: s.advance }]"
            >
              <text class="c-rank">{{ s.rank || '-' }}</text>
              <text class="c-name">{{ s.name }}</text>
              <text class="c-num">{{ s.win }}</text>
              <text class="c-num">{{ s.loss }}</text>
              <text class="c-num">{{ s.pointDiff > 0 ? '+' + s.pointDiff : s.pointDiff }}</text>
            </view>
          </view>

          <view class="matches">
            <view v-for="m in g.matches" :key="m.id" :class="['row-match', { mine: m.involved }]">
              <text class="r-tag">{{ m.roundName }}</text>
              <text :class="['side', 'a', sideClass(m, 'a')]">{{ m.teamA ? m.teamA.name : '待定' }}</text>
              <text class="score">
                <text v-if="scoreText(m)" class="score-num">{{ scoreText(m) }}</text>
                <text v-else class="score-vs">VS</text>
              </text>
              <text :class="['side', 'b', sideClass(m, 'b')]">{{ m.teamB ? m.teamB.name : '待定' }}</text>
            </view>
          </view>
        </view>

        <view v-if="others(current.ranking).length" class="block">
          <view class="block-title">其他名次</view>
          <view v-for="r in others(current.ranking)" :key="r.entryId" class="other">
            <text class="o-rank">第 {{ r.rank }}</text>
            <text class="o-name">{{ r.name }}</text>
            <text class="o-out">{{ r.eliminatedText }}</text>
          </view>
        </view>

        <view class="tip-note">
          赛制说明：小组赛组内单循环，按胜场、净胜分排名；每组前 N 名进入淘汰赛，
          之后每轮随机配对，直到四强，再打季军赛与决赛。
        </view>
      </template>
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
  padding: 16px;
  border-radius: 12px;
  background: #0c3125;
  color: #faf7f0;
}
.title {
  display: block;
  font-size: 17px;
  font-weight: 800;
}
.sub {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.9;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.tab {
  flex: 1;
  padding: 8px 0;
  border: 1px solid #e3e8e6;
  border-radius: 8px;
  background: #ffffff;
  text-align: center;
  font-size: 12px;
  color: #5a726d;
}
.tab.on {
  border-color: #14665b;
  background: #14665b;
  color: #ffffff;
  font-weight: 700;
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
.podium {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.p-rank {
  width: 46px;
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
.round {
  margin-bottom: 14px;
}
.round:last-child {
  margin-bottom: 0;
}
.round-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.round-name {
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
}
.round-done {
  padding: 1px 7px;
  border-radius: 20px;
  background: #eef3f1;
  font-size: 10px;
  color: #5a726d;
}
.round-live {
  padding: 1px 7px;
  border-radius: 20px;
  background: #e5c84b;
  font-size: 10px;
  font-weight: 700;
  color: #1a2e2a;
}
.round-meta {
  font-size: 11px;
  color: #5a726d;
}
.match {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: #f7f9f8;
}
.match:last-child {
  margin-bottom: 0;
}
.match.mine,
.row-match.mine {
  outline: 1px solid #e5c84b;
  background: #fdf9ec;
}
.side {
  flex: 1;
  font-size: 12px;
  color: #1a2e2a;
}
.side.b {
  text-align: right;
}
.side.win {
  font-weight: 800;
  color: #14665b;
}
.side.lose {
  color: #9aa8a4;
  text-decoration: line-through;
}
.score {
  width: 48px;
  text-align: center;
  flex-shrink: 0;
}
.score-num {
  font-size: 13px;
  font-weight: 800;
  color: #1a2e2a;
}
.score-vs {
  font-size: 11px;
  color: #9aa8a4;
}
.stand {
  margin-bottom: 10px;
}
.stand-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-bottom: 1px solid #f4f6f5;
  font-size: 12px;
}
.stand-row.th {
  font-size: 10px;
  color: #9aa8a4;
  border-bottom-color: #e3e8e6;
}
.stand-row.up {
  background: #f4f8f6;
}
.c-rank {
  width: 30px;
  font-weight: 700;
  color: #14665b;
}
.c-name {
  flex: 1;
  color: #1a2e2a;
}
.c-num {
  width: 30px;
  text-align: right;
  color: #5a726d;
}
.matches {
  padding-top: 4px;
  border-top: 1px dashed #e3e8e6;
}
.row-match {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 6px;
  border-radius: 6px;
}
.r-tag {
  width: 42px;
  flex-shrink: 0;
  font-size: 10px;
  color: #9aa8a4;
}
.other {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
}
.o-rank {
  width: 40px;
  color: #5a726d;
}
.o-name {
  flex: 1;
  color: #1a2e2a;
}
.o-out {
  font-size: 11px;
  color: #9aa8a4;
}
.tip-note {
  margin-top: 16px;
  padding: 12px;
  border-radius: 10px;
  background: #f4f8f6;
  font-size: 11px;
  line-height: 18px;
  color: #5a726d;
}
</style>