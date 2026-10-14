<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import {
  getTournamentMatches,
  scoreTournamentMatch,
  TOURNAMENT_STAGE,
} from '../../common/api/tournament'
import { toastError } from '../../common/util'

const id = ref(null)
const data = ref(null)
const loading = ref(false)
const activeFormat = ref(null)
const submittingId = ref(null)
/** 每场临时比分输入：{ [matchId]: { a: '21', b: '19' } }，只存在于本页，不落库 */
const scores = ref({})

const formats = computed(() => data.value?.formats || [])
const current = computed(
  () => formats.value.find((f) => f.format === activeFormat.value) || formats.value[0] || null,
)
const totalPending = computed(() =>
  formats.value.reduce((sum, f) => sum + f.pending.length, 0),
)

async function load() {
  loading.value = true
  try {
    data.value = await getTournamentMatches(id.value)
    if (!activeFormat.value && formats.value.length) {
      activeFormat.value = formats.value[0].format
    }
    // 已录入的比分不再留在输入框里，避免二次提交时误带旧值
    formats.value.forEach((f) => {
      f.done.forEach((m) => {
        delete scores.value[m.id]
      })
    })
  } catch (e) {
    toastError(e, '赛程加载失败')
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

function inputOf(matchId) {
  if (!scores.value[matchId]) {
    scores.value[matchId] = { a: '', b: '' }
  }
  return scores.value[matchId]
}

function parseScore(v) {
  const n = Number(v)
  return v === '' || v === null || Number.isNaN(n) ? undefined : Math.trunc(n)
}

/** 点胜方即提交；比分是可选的，填了就一并留档 */
async function submit(match, winner) {
  const box = scores.value[match.id] || {}
  const payload = {
    winner,
    scoreA: parseScore(box.a),
    scoreB: parseScore(box.b),
  }
  if (payload.scoreA != null && payload.scoreB != null && payload.scoreA === payload.scoreB) {
    uni.showToast({ title: '比分不能相同', icon: 'none' })
    return
  }
  submittingId.value = match.id
  try {
    const res = await scoreTournamentMatch(match.id, payload)
    delete scores.value[match.id]
    uni.showToast({ title: res.advanced || '已录入', icon: 'none' })
    await load()
  } catch (e) {
    toastError(e, '录入失败')
  } finally {
    submittingId.value = null
  }
}

function confirmRevoke(match) {
  uni.showModal({
    title: '撤销本场赛果',
    content: '撤销后本场回到待录入，且后续轮次的赛果会被一并清空，需要重新打一遍。确定吗？',
    confirmText: '确定撤销',
    confirmColor: '#B0483B',
    success: async (res) => {
      if (!res.confirm) return
      submittingId.value = match.id
      try {
        await scoreTournamentMatch(match.id, { winner: 0 })
        delete scores.value[match.id]
        uni.showToast({ title: '已撤销', icon: 'none' })
        await load()
      } catch (e) {
        toastError(e, '撤销失败')
      } finally {
        submittingId.value = null
      }
    },
  })
}

function stageText(m) {
  return m.roundName || TOURNAMENT_STAGE[m.stage] || ''
}

function teamName(team) {
  return team ? team.name : '待定'
}

function scoreText(m) {
  if (m.scoreA == null || m.scoreB == null) return '已出结果'
  return `${m.scoreA} : ${m.scoreB}`
}

function winnerName(m) {
  if (!m.winner) return ''
  return (m.winner === 1 ? teamName(m.teamA) : teamName(m.teamB)) + ' 胜'
}
</script>

<template>
  <view class="page">
    <view v-if="loading && !data" class="state">加载中…</view>
    <view v-else-if="!data" class="state">暂无赛程</view>

    <template v-else>
      <view class="head">
        <text class="title">{{ data.title }}</text>
        <text class="sub">
          {{ data.statusText }} · 待录入 {{ totalPending }} 场 · 本赛事不计入ELO积分
        </text>
      </view>

      <view v-if="!formats.length || !current" class="state">该赛事还没抽签分组，暂无赛程</view>

      <template v-else>
        <view v-if="formats.length > 1" class="tabs">
          <view
            v-for="f in formats"
            :key="f.format"
            :class="['tab', { on: current.format === f.format }]"
            @click="activeFormat = f.format"
          >
            {{ f.formatName }}
            <text v-if="f.pending.length" class="dot">{{ f.pending.length }}</text>
          </view>
        </view>

        <view class="section">
          <text class="section-title">待录入（{{ current.pending.length }}）</text>
          <view v-if="!current.pending.length" class="empty">本组别赛果已全部录入</view>

          <view
            v-for="m in current.pending"
            :key="m.id"
            :class="['m', { mine: m.involved, busy: submittingId === m.id }]"
          >
            <view class="m-head">
              <text class="tag">{{ stageText(m) }}</text>
              <text v-if="m.groupNo" class="tag g">{{ m.groupNo }} 组</text>
              <text v-if="m.court" class="court">{{ m.court }} 号场</text>
              <text v-if="m.involved" class="tag mine">我的比赛</text>
            </view>

            <view class="teams">
              <text class="team a">{{ teamName(m.teamA) }}</text>
              <text class="vs">VS</text>
              <text class="team b">{{ teamName(m.teamB) }}</text>
            </view>

            <view class="ctrl">
              <input
                class="sc"
                :value="inputOf(m.id).a"
                placeholder="比分"
                placeholder-class="ph"
                @input="inputOf(m.id).a = $event.detail.value"
              />
              <text class="colon">:</text>
              <input
                class="sc"
                :value="inputOf(m.id).b"
                placeholder="比分"
                placeholder-class="ph"
                @input="inputOf(m.id).b = $event.detail.value"
              />
            </view>

            <view class="btns">
              <view class="win" @click="submit(m, 1)">{{ teamName(m.teamA) }} 胜</view>
              <view class="win" @click="submit(m, 2)">{{ teamName(m.teamB) }} 胜</view>
            </view>
          </view>
        </view>

        <view class="section">
          <text class="section-title">已出结果（{{ current.done.length }}）</text>
          <view v-if="!current.done.length" class="empty">还没有已完成的场次</view>

          <view v-for="m in current.done" :key="m.id" class="m done">
            <view class="m-head">
              <text class="tag">{{ stageText(m) }}</text>
              <text v-if="m.groupNo" class="tag g">{{ m.groupNo }} 组</text>
              <text v-if="m.court" class="court">{{ m.court }} 号场</text>
            </view>
            <view class="teams">
              <text :class="['team', 'a', m.winner === 1 ? 'win' : 'lose']">
                {{ teamName(m.teamA) }}
              </text>
              <text class="score">{{ scoreText(m) }}</text>
              <text :class="['team', 'b', m.winner === 2 ? 'win' : 'lose']">
                {{ teamName(m.teamB) }}
              </text>
            </view>
            <view class="done-foot">
              <text class="by">{{ winnerName(m) }}{{ m.refereeName ? ' · 记录人 ' + m.refereeName : '' }}</text>
              <text class="revoke" @click="confirmRevoke(m)">撤销</text>
            </view>
          </view>
        </view>

        <view class="tip-note">
          录入只需点「谁胜」即可，比分可选填、仅作赛果留档。若点错了，点「撤销」可以回退，
          但后续轮次的赛果会被一并清空，需要重新录入。
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
.dot {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 10px;
  background: #e5c84b;
  font-size: 10px;
  font-weight: 700;
  color: #1a2e2a;
}
.section {
  margin-top: 16px;
}
.section-title {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 800;
  color: #14665b;
}
.empty {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: #9aa8a4;
}
.m {
  margin-bottom: 10px;
  padding: 12px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.m.mine {
  border-color: #e5c84b;
}
.m.busy {
  opacity: 0.6;
}
.m-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tag {
  padding: 1px 7px;
  border-radius: 20px;
  background: #eef3f1;
  font-size: 10px;
  font-weight: 700;
  color: #14665b;
}
.tag.g {
  background: #f0efea;
  color: #5a726d;
}
.tag.mine {
  background: #e5c84b;
  color: #1a2e2a;
}
.court {
  font-size: 10px;
  color: #9aa8a4;
}
.teams {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.team {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
  color: #1a2e2a;
}
.team.b {
  text-align: right;
}
.team.win {
  color: #14665b;
}
.team.lose {
  color: #9aa8a4;
}
.vs {
  font-size: 11px;
  color: #9aa8a4;
  flex-shrink: 0;
}
.score {
  font-size: 13px;
  font-weight: 800;
  color: #1a2e2a;
  flex-shrink: 0;
}
.ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
}
.sc {
  width: 70px;
  height: 34px;
  border: 1px solid #e3e8e6;
  border-radius: 6px;
  background: #faf7f0;
  text-align: center;
  font-size: 13px;
}
.ph {
  color: #c2cac8;
}
.colon {
  font-size: 13px;
  color: #5a726d;
}
.btns {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.win {
  flex: 1;
  padding: 9px 0;
  border: 1px solid #14665b;
  border-radius: 8px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: #14665b;
  background: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.win:active {
  background: #14665b;
  color: #ffffff;
}
.done {
  background: #f7f9f8;
}
.done-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e3e8e6;
}
.by {
  font-size: 11px;
  color: #5a726d;
}
.revoke {
  font-size: 11px;
  color: #b0483b;
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