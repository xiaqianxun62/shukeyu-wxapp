<script setup>
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { planRotation, planRotationForGame, getRotationForGame } from '../../common/api/rotation'
import { listGames, getGame, scoreMatch } from '../../common/api/game'
import { AVATAR_COLORS, genderText, toastError } from '../../common/util'
import { useAuth } from '../../common/store/auth'
import { navigateTo } from '../../common/nav'
import NavBack from '../../components/nav-back/nav-back.vue'
import SmartImage from '../../components/SmartImage/SmartImage.vue'

/**
 * 轮排：人数多于同时上场人数时，按轮安排谁上场、谁休息。
 * 规则由后端 RotationEngine 保证：上场次数差 ≤ 1、尽量不重复搭档、每场实力接近。
 */

const mode = ref('quick') // quick=快速名单 game=真实球局报名名单
const games = ref([])
const gameIndex = ref(0)

const peopleCount = ref(12)
const players = ref([])
const courts = ref(2)
const rounds = ref(6)
const format = ref(2) // 1 单打 2 双打
/** 双打怎么配队：0 不分性别 1 男双 2 女双 3 混双 4 男女分场（男双+女双同时进行） */
const genderRule = ref(0)
const genderRules = [
  { value: 0, label: '不分性别' },
  { value: 3, label: '混双（一男一女）' },
  { value: 1, label: '男双' },
  { value: 2, label: '女双' },
  { value: 4, label: '男女分场' },
]
const balance = ref(true)

const result = ref(null)
const loading = ref(false)

const { isLoggedIn, user } = useAuth()
/** 真实球局模式：发起人能生成轮排表（管理员有全部权限，后端同样校验） */
const isGameCreator = computed(
  () => !!selectedGame.value && !!user.value
    && (selectedGame.value.creatorId === user.value.userId || !!user.value.isAdmin),
)

/** 现场计分弹层 */
const scoreVisible = ref(false)
const scoring = ref(false)
const scoreForm = ref({ matchId: 0, round: 0, court: 0, scoreA: '', scoreB: '' })
/** 当前弹层对阵的计分信息：裁判与改分历史（来自轮排接口的 refereeName / scoreLogs） */
const scoreAudit = ref({ refereeName: '', logs: [] })

/* ---------- 打分记录 ---------- */
/** 打分记录弹层：本场谁当裁判、计了多少分、之后谁又改了分 */
const logVisible = ref(false)
const logForm = ref({ round: 0, court: 0 })
const logRows = ref([])

const perMatch = computed(() => (format.value === 1 ? 2 : 4))
const onCourt = computed(() => Math.min(courts.value, Math.floor(peopleCount.value / perMatch.value)) * perMatch.value)
const restingPerRound = computed(() => Math.max(peopleCount.value - onCourt.value, 0))
const canGenerate = computed(() =>
  mode.value === 'game' ? games.value.length > 0 : players.value.length >= perMatch.value,
)
const selectedGame = computed(() => games.value[gameIndex.value] || null)
/** 报名男女统计：小程序端直接按轮排名单里的性别字段算，不依赖后端接口 */
const genderStat = computed(() => {
  const list = (result.value && result.value.players) || []
  let male = 0
  let female = 0
  list.forEach((p) => {
    if (p.gender === 1) male += 1
    else if (p.gender === 2) female += 1
  })
  return { total: list.length, male, female }
})
/** 局内得分排名：按胜场降序，再按 ELO 变化、局内得分、总 ELO 降序 */
const rankedStats = computed(() => {
  const list = (result.value && result.value.stats) || []
  return [...list].sort((a, b) => {
    if (b.winCount !== a.winCount) return b.winCount - a.winCount
    if ((b.eloDelta || 0) !== (a.eloDelta || 0)) return (b.eloDelta || 0) - (a.eloDelta || 0)
    if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0)
    return (b.rating || 0) - (a.rating || 0)
  })
})

function eloDeltaText(value) {
  const n = value || 0
  return n > 0 ? `ELO +${n}` : `ELO ${n}`
}

function rebuildPlayers() {
  const n = Number(peopleCount.value)
  const next = []
  for (let i = 0; i < n; i += 1) {
    const old = players.value[i]
    next.push(old || { userId: i + 1, label: `球员${i + 1}`, gender: 0, rating: 1200 })
  }
  players.value = next
}

function shuffleRatings() {
  players.value = players.value.map((p) => ({
    ...p,
    rating: 1200 + Math.floor(Math.random() * 300) - 150,
  }))
}

watch(peopleCount, rebuildPlayers, { immediate: true })

onLoad((options) => {
  const gameId = options && options.gameId ? Number(options.gameId) : null
  if (gameId) {
    mode.value = 'game'
    getGame(gameId).then((g) => {
      games.value = [g]
      gameIndex.value = 0
      loadSaved()
    }).catch(() => {
      games.value = [{ id: gameId, title: '加载失败', registeredCount: 0, registrations: [] }]
      gameIndex.value = 0
      loadSaved()
    })
  } else {
    loadGames()
  }
})

async function loadGames() {
  try {
    games.value = await listGames()
  } catch (e) {
    games.value = []
  }
  if (options && options.gameId) {
    const idx = games.value.findIndex((g) => String(g.id) === String(options.gameId))
    if (idx >= 0) {
      gameIndex.value = idx
      mode.value = 'game'
    }
  }
  await loadSaved()
}

/** 真实球局：把上次生成过的轮排表读回来（含已录比分），没生成过就留空等生成 */
async function loadSaved() {
  if (mode.value !== 'game' || !selectedGame.value) {
    result.value = null
    return
  }
  try {
    const saved = await getRotationForGame(selectedGame.value.id)
    result.value = saved || null
    if (saved) {
      // 回填上次的参数，点「重新生成」时沿用同样的场地 / 轮数 / 赛制
      courts.value = saved.courts
      rounds.value = saved.rounds
      format.value = saved.format
    }
  } catch (e) {
    result.value = null
  }
}

function goToGameDetail() {
  navigateTo(`/pages/detail/detail?id=${selectedGame.value.id}`)
}

function switchMode(next) {
  if (mode.value === next) return
  mode.value = next
  if (next === 'game') {
    loadSaved()
  } else {
    result.value = null
  }
}

async function onGameChange(evt) {
  gameIndex.value = Number(evt.detail.value)
  await loadSaved()
}

async function generate() {
  if (!canGenerate.value) {
    uni.showToast({
      title: `人数不足，至少需要 ${perMatch.value} 人`,
      icon: 'none',
    })
    return
  }
  loading.value = true
  try {
    const payload = {
      courts: Number(courts.value),
      rounds: Number(rounds.value),
      format: Number(format.value),
      genderRule: Number(genderRule.value),
      balanceStrength: balance.value,
      players: players.value,
    }
    result.value =
      mode.value === 'game'
        ? await planRotationForGame(selectedGame.value.id, payload)
        : await planRotation(payload)
  } catch (e) {
    toastError(e, '生成失败')
  } finally {
    loading.value = false
  }
}

function namesOf(list) {
  return (list || []).map((p) => p.label).join(' / ')
}

/**
 * 场地标题的赛制文案：两队性别构成可能不同（男双 vs 混双），
 * 只标一个会显示成「混双打混双」，故不同时写成「A vs B」。
 */
function formatText(m) {
  const a = m.teamAFormatName
  const b = m.teamBFormatName
  if (a && b && a !== b) return `${a} vs ${b}`
  return a || b || m.formatName || '双打'
}

function nameInitial(name) {
  return (name || '球友').charAt(0)
}

/** 轮排表球员名只显示前 3 个字，避免卡片内拥挤 */
function shortName(name) {
  const n = name || ''
  return n.length > 3 ? n.slice(0, 3) : n
}

/** 按 userId 稳定取头像背景色（同个球员颜色永远一样） */
function colorOf(userId) {
  const idx = (Number(userId) || 0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

function playerAvatar(p) {
  if (!p) return ''
  return p.avatar || ''
}

/* ---------- 现场计分 ---------- */

function openScore(match, round) {
  if (!match.matchId) return
  if (!isLoggedIn.value) {
    navigateTo('/pages/auth/auth')
    return
  }
  scoreForm.value = {
    matchId: match.matchId,
    round,
    court: match.court,
    scoreA: match.winner ? String(match.scoreA) : '',
    scoreB: match.winner ? String(match.scoreB) : '',
  }
  scoreAudit.value = {
    refereeName: match.refereeName || '',
    logs: match.scoreLogs || [],
  }
  scoreVisible.value = true
}

/** 打分记录：未登录也能看，比分改动对所有人公开可查 */
function openScoreLog(match, round) {
  logForm.value = { round, court: match.court }
  logRows.value = match.scoreLogs || []
  logVisible.value = true
}

function closeScoreLog() {
  logVisible.value = false
}

/** 计分日志时间展示：2026-01-01T12:30:00 → 01-01 12:30 */
function formatLogTime(time) {
  if (!time) return ''
  const s = String(time).replace('T', ' ')
  return s.length >= 16 ? s.slice(5, 16) : s
}

/** 单条计分日志文案：首次录入 / 改分（含改前比分）/ 撤销 */
function logText(log) {
  if (log.action === 3) {
    return `撤销比分 ${log.prevScoreA} : ${log.prevScoreB} → 不计输赢`
  }
  if (log.action === 2 && log.prevScoreA != null) {
    return `改分 ${log.prevScoreA} : ${log.prevScoreB} → ${log.scoreA} : ${log.scoreB}`
  }
  return `录入 ${log.scoreA} : ${log.scoreB}`
}

function closeScore() {
  if (!scoring.value) scoreVisible.value = false
}

async function submitScore() {
  const a = Number(scoreForm.value.scoreA)
  const b = Number(scoreForm.value.scoreB)
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    uni.showToast({ title: '请输入双方比分', icon: 'none' })
    return
  }
  // 0:0 是唯一的相同比分例外：撤销本场（误点救回），不计输赢
  const isReset = a === 0 && b === 0
  if (a === b && !isReset) {
    uni.showToast({ title: '比分不能相同', icon: 'none' })
    return
  }
  if (isReset) {
    const ok = await new Promise((resolve) => {
      uni.showModal({
        title: '撤销本场比分',
        content: '本场将回到未计分状态，不计输赢；若已结算过积分，会原路退回。确定吗？',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!ok) return
  }
  scoring.value = true
  try {
    const res = await scoreMatch(scoreForm.value.matchId, a, b)
    const round = result.value.rotation.find((r) => r.round === scoreForm.value.round)
    const m = round && round.matches.find((x) => x.matchId === scoreForm.value.matchId)
    if (m) {
      m.scoreA = a
      m.scoreB = b
      m.winner = res.winner
    }
    uni.showToast({
      title: isReset ? '本场已撤销，不计输赢' : res && res.gameFinished ? '比分已录入，球局结束' : '比分已录入',
      icon: 'success',
    })
    scoreVisible.value = false
    await loadSaved()
  } catch (e) {
    toastError(e, '计分失败')
  } finally {
    scoring.value = false
  }
}
</script>

<template>
  <view class="page">
    <NavBack />

    <scroll-view class="body" scroll-y>
      <view class="hero">
        <view class="hero-title">轮排</view>
        <view class="hero-desc">
          人多场少时按轮轮换上场：每人上场次数差不超过 1 轮，尽量避免重复搭档，
          组队用 ELO 期望胜率做均衡（让每场双方的预期胜率尽量接近 50%）。
        </view>
      </view>

      <view class="tabs">
        <view :class="['tab', { active: mode === 'quick' }]" @click="switchMode('quick')">快速名单</view>
        <view :class="['tab', { active: mode === 'game' }]" @click="switchMode('game')">真实球局</view>
      </view>

      <view class="panel">
        <view v-if="mode === 'game'" class="field">
          <text class="label">选择球局</text>
          <picker mode="selector" :range="games" range-key="title" :value="gameIndex" @change="onGameChange">
            <view class="picker">
              {{ selectedGame ? selectedGame.title + `（${selectedGame.registeredCount} 人已报名）` : '暂无球局' }}
            </view>
          </picker>
          <view v-if="mode === 'game' && result" class="gender-stat">
            <text class="stat-item">已报名 {{ genderStat.total }} 人</text>
            <text class="stat-item">男 {{ genderStat.male }} 人</text>
            <text class="stat-item">女 {{ genderStat.female }} 人</text>
          </view>
          <view v-if="mode === 'game' && result && genderStat.male === 0 && genderStat.female === 0" class="gender-warning">
            <text>报名者尚未填写性别，无法按性别规则编排。</text>
            <text>请让报名者到「我的 → 编辑资料」填写性别。</text>
          </view>
        </view>

        <view v-else class="field">
          <text class="label">人数（{{ peopleCount }} 人）</text>
          <uni-number-box v-model="peopleCount" :min="2" :max="40" />
          <view class="chips">
            <view class="chip" @click="shuffleRatings">随机实力（1200±150）</view>
            <view v-for="n in [4, 6, 8, 10, 12, 16]" :key="n" class="chip" @click="peopleCount = n">
              {{ n }} 人
            </view>
          </view>
        </view>

        <view class="row">
          <text class="label">场地数</text>
          <uni-number-box v-model="courts" :min="1" :max="8" />
        </view>
        <view class="row">
          <text class="label">轮数</text>
          <uni-number-box v-model="rounds" :min="1" :max="20" />
        </view>
        <view class="row">
          <text class="label">赛制</text>
          <view class="seg">
            <view :class="['seg-item', { active: format === 2 }]" @click="format = 2">双打（4 人/场）</view>
            <view :class="['seg-item', { active: format === 1 }]" @click="format = 1">单打（2 人/场）</view>
          </view>
        </view>
        <view v-if="format === 2" class="field">
          <text class="label">性别规则</text>
          <view class="chips">
            <view
              v-for="g in genderRules"
              :key="g.value"
              :class="['chip', { active: genderRule === g.value }]"
              @click="genderRule = g.value"
            >
              {{ g.label }}
            </view>
          </view>
          <text v-if="mode === 'quick' && genderRule !== 0" class="hint">
            快速名单没有性别信息，性别规则请在「真实球局」模式下使用
          </text>
        </view>
        <view class="row">
          <text class="label">按 ELO 均衡实力</text>
          <switch :checked="balance" color="#14665B" @change="balance = $event.detail.value" />
        </view>

        <view class="summary">
          <text>每轮 {{ onCourt }} 人上场</text>
          <text v-if="restingPerRound"> · {{ restingPerRound }} 人休息</text>
        </view>

        <template v-if="mode === 'game' && !isGameCreator">
          <view class="creator-only-tip">轮排表由发起人生成，其他人只可查看</view>
          <button class="run ghost" type="button" @click="goToGameDetail">
            返回球局详情
          </button>
        </template>
        <button v-else class="run" type="button" :loading="loading" @click="generate">
          {{ result && mode === 'game' ? '重新生成轮排表' : '生成轮排表' }}
        </button>
      </view>

      <view v-if="result" class="result">
        <view class="result-title">轮排表 · {{ result.formatName }} · {{ result.courts }} 片场地</view>
        <text v-if="mode === 'game'" class="result-tip">已保存到服务器，退出后回来还在</text>

        <view v-for="r in result.rotation" :key="r.round" class="round">
          <view class="round-head">
            <text class="round-no">第 {{ r.round }} 轮</text>
            <view v-if="r.resting.length" class="round-rest">
              <text class="rest-label">休息：</text>
              <view class="mini-list">
                <view
                  v-for="(p, i) in r.resting"
                  :key="`rest-${r.round}-${p.userId}-${i}`"
                  class="mini-player"
                >
                  <SmartImage
                    v-if="playerAvatar(p)"
                    class="mini-avatar-img"
                    :src="playerAvatar(p)"
                    mode="aspectFill"
                  />
                  <view v-else class="mini-avatar" :style="{ background: colorOf(p.userId) }">{{ nameInitial(p.label) }}</view>
                  <text class="mini-name">{{ shortName(p.label) }}</text>
                </view>
              </view>
            </view>
            <text v-else class="round-rest">全员上场</text>
          </view>
          <!-- 多片场地合并到一个组合网格里显示 -->
          <view class="court-grid" style="gridTemplateColumns: 1fr">
            <view
              v-for="m in r.matches"
              :key="m.court"
              :class="['court', { scored: m.winner }]"
              hover-class="court-hv"
              hover-stay-time="120"
              @click="openScore(m, r.round)"
            >
              <view class="court-head">
                <text class="court-no">{{ m.court }} 号场 · {{ formatText(m) }}</text>
                <text v-if="m.winner" class="court-score">{{ m.scoreA }} : {{ m.scoreB }}</text>
                <text v-else-if="m.matchId" class="court-score todo">录比分 ›</text>
                <text v-else class="court-score">试算</text>
              </view>
              <view v-if="m.expectedA" class="court-elo">
                ELO 预期胜率：A 队 {{ Math.round(m.expectedA * 100) }}% · B 队
                {{ 100 - Math.round(m.expectedA * 100) }}%
              </view>
              <view class="court-vs">
                <view class="vs-list left">
                  <view
                    v-for="(p, i) in m.teamA || []"
                    :key="`a-${r.round}-${m.court}-${p.userId}-${i}`"
                    class="mini-player"
                  >
                    <SmartImage
                      v-if="playerAvatar(p)"
                      class="mini-avatar-img"
                      :src="playerAvatar(p)"
                      mode="aspectFill"
                    />
                    <view v-else class="mini-avatar" :style="{ background: colorOf(p.userId) }">{{ nameInitial(p.label) }}</view>
                    <text class="mini-name">{{ shortName(p.label) }}</text>
                  </view>
                </view>
                <text class="vs-tag">VS</text>
                <view class="vs-list right">
                  <view
                    v-for="(p, i) in m.teamB || []"
                    :key="`b-${r.round}-${m.court}-${p.userId}-${i}`"
                    class="mini-player"
                  >
                    <SmartImage
                      v-if="playerAvatar(p)"
                      class="mini-avatar-img"
                      :src="playerAvatar(p)"
                      mode="aspectFill"
                    />
                    <view v-else class="mini-avatar" :style="{ background: colorOf(p.userId) }">{{ nameInitial(p.label) }}</view>
                    <text class="mini-name">{{ shortName(p.label) }}</text>
                  </view>
                </view>
              </view>
              <!-- 裁判与计分留痕：谁首次录的分、之后被改过几次 -->
              <view v-if="m.refereeName" class="court-referee">
                <text class="court-referee-text">裁判 · {{ m.refereeName }}</text>
                <text v-if="(m.scoreLogs || []).length > 1" class="court-referee-edited">已改分 {{ (m.scoreLogs || []).length - 1 }} 次</text>
                <view
                  v-if="(m.scoreLogs || []).length"
                  class="court-log-btn"
                  hover-class="court-log-btn-hv"
                  hover-stay-time="120"
                  @click.stop="openScoreLog(m, r.round)"
                >打分记录</view>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 计分弹层：点场地后录入本场比分，胜方自动判定 -->
    <view v-if="scoreVisible" class="mask" @click="closeScore">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">录入比分 · 第 {{ scoreForm.round }} 轮 {{ scoreForm.court }} 号场</text>
          <text class="picker-close" @click="closeScore">✕</text>
        </view>
        <view class="score-row">
          <text class="score-side">A 队</text>
          <input class="score-input" type="number" v-model="scoreForm.scoreA" placeholder="0" />
          <text class="score-colon">:</text>
          <input class="score-input" type="number" v-model="scoreForm.scoreB" placeholder="0" />
          <text class="score-side">B 队</text>
        </view>
        <view class="score-tip">胜方按比分自动判定，例如 21 : 15；填 0 : 0 可撤销本场（误点救回）</view>
        <!-- 计分留痕：谁当裁判、计了多少分、谁后面又改了 -->
        <view v-if="scoreAudit.refereeName" class="score-audit">
          <view class="score-audit-title">
            <text>裁判 · {{ scoreAudit.refereeName }}</text>
            <text v-if="scoreAudit.logs.length > 1" class="score-audit-badge">已改分 {{ scoreAudit.logs.length - 1 }} 次</text>
          </view>
          <view v-for="(log, li) in scoreAudit.logs" :key="li" class="score-audit-row">
            <text class="score-audit-who">{{ log.operatorName }}</text>
            <text class="score-audit-text">{{ logText(log) }}</text>
            <text class="score-audit-time">{{ formatLogTime(log.time) }}</text>
          </view>
        </view>
        <button class="run picker-go" type="button" :loading="scoring" @click="submitScore">保存比分</button>
      </view>
    </view>

    <!-- 打分记录弹层：本场比分的录入与修改全过程 -->
    <view v-if="logVisible" class="mask" @click="closeScoreLog">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">打分记录 · 第 {{ logForm.round }} 轮 {{ logForm.court }} 号场</text>
          <text class="picker-close" @click="closeScoreLog">✕</text>
        </view>
        <scroll-view scroll-y class="log-list">
          <view v-for="(log, li) in logRows" :key="li" class="log-row">
            <view class="log-row-top">
              <SmartImage
                v-if="log.operatorAvatar"
                class="log-avatar-img"
                :src="log.operatorAvatar"
                mode="aspectFill"
              />
              <view v-else class="log-avatar" :style="{ background: colorOf(log.operatorId) }">
                {{ log.operatorName ? log.operatorName.charAt(0) : '球' }}
              </view>
              <text class="log-who">{{ log.operatorName }}</text>
              <text class="log-time">{{ formatLogTime(log.time) }}</text>
            </view>
            <text class="log-text">{{ logText(log) }}</text>
          </view>
          <view v-if="!logRows.length" class="log-empty">还没有打分记录</view>
        </scroll-view>
      </view>
    </view>

  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding-bottom: env(safe-area-inset-bottom);
}
.body {
  padding: 16px 16px 40px;
  box-sizing: border-box;
}
.hero {
  padding: 18px 16px;
  border-radius: 12px;
  background: #14665b;
  color: #faf7f0;
}
.hero-title {
  font-size: 20px;
  font-weight: 800;
}
.hero-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.92;
}
.tabs {
  display: flex;
  gap: 8px;
  padding: 14px 0 6px;
}
.tab {
  padding: 5px 14px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #ffffff;
  color: #5a726d;
  font-size: 12px;
  font-weight: 600;
}
.tab.active {
  background: #14665b;
  border-color: #14665b;
  color: #faf7f0;
}
.panel {
  margin-top: 8px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(20, 102, 91, 0.08);
}
.field {
  margin-bottom: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f0efea;
}
.label {
  font-size: 13px;
  font-weight: 700;
  color: #1a2e2a;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: #5a726d;
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
  background: #14665b;
  border-color: #14665b;
  color: #faf7f0;
  font-weight: 700;
}
.court-elo {
  margin-top: 2px;
  font-size: 11px;
  color: #5a726d;
}
.seg {
  display: flex;
  gap: 6px;
}
.seg-item {
  padding: 5px 12px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #ffffff;
  color: #5a726d;
  font-size: 12px;
}
.seg-item.active {
  background: #14665b;
  border-color: #14665b;
  color: #faf7f0;
  font-weight: 700;
}
.picker {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid #e3e8e6;
  border-radius: 8px;
  background: #faf7f0;
  font-size: 13px;
  color: #1a2e2a;
}
.gender-stat {
  display: flex;
  gap: 12px;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f0f5f3;
}
.stat-item {
  font-size: 12px;
  font-weight: 600;
  color: #14665b;
}
.gender-warning {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff3f0;
}
.gender-warning text {
  display: block;
  font-size: 12px;
  color: #b33a2e;
  line-height: 1.6;
}
.summary {
  margin-top: 10px;
  font-size: 12px;
  color: #5a726d;
}
.run {
  margin-top: 12px;
  height: 44px;
  line-height: 44px;
  border: none;
  border-radius: 10px;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 15px;
  font-weight: 700;
}
.run.ghost {
  border: 1px solid #14665b;
  background: #ffffff;
  color: #14665b;
}
.creator-only-tip {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f0f5f3;
  font-size: 12px;
  color: #5a726d;
  text-align: center;
}

.result {
  margin-top: 16px;
}
.result-title {
  margin: 14px 0 8px;
  font-size: 14px;
  font-weight: 800;
  color: #1a2e2a;
}
.round {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.round-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 8px;
}
.round-no {
  font-size: 14px;
  font-weight: 800;
  color: #14665b;
}
.round-rest {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  font-size: 11px;
  color: #5a726d;
}
.rest-label {
  font-size: 11px;
  color: #5a726d;
}
.mini-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mini-player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  max-width: 56px;
  text-align: center;
}
.mini-avatar,
.mini-avatar-img {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  flex-shrink: 0;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mini-name {
  font-size: 11px;
  color: #1a2e2a;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.court-vs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 6px 0 2px;
}
.vs-list {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.vs-list.right {
}
.vs-tag {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
  letter-spacing: 0.5px;
}
.court {
  padding: 10px;
  border-radius: 8px;
  background: #faf7f0;
}
.court-grid {
  display: grid;
  gap: 8px;
}
.court-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.court-no {
  font-size: 12px;
  font-weight: 700;
  color: #14665b;
}
.court-score {
  font-size: 11px;
  color: #5a726d;
}
.side {
  font-size: 13px;
  color: #1a2e2a;
  line-height: 1.7;
}

.stats {
  padding: 12px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.stat {
  padding: 8px 0;
  border-bottom: 1px solid #f0efea;
}
.stat-name {
  font-size: 13px;
  font-weight: 700;
  color: #1a2e2a;
}
.stat-meta {
  margin-left: 6px;
  font-size: 11px;
  color: #5a726d;
}
.stat-bar {
  display: flex;
  height: 6px;
  margin: 6px 0 4px;
  border-radius: 3px;
  overflow: hidden;
  background: #f0efea;
}
.bar-play {
  background: #14665b;
}
.bar-rest {
  background: #d8e2de;
}
.stat-count {
  font-size: 11px;
  color: #5a726d;
}
.elo-delta {
  font-weight: 700;
  color: #5a726d;
}
.elo-delta.up {
  color: #14665b;
}
.elo-delta.down {
  color: #b33a2e;
}
.result-tip {
  display: block;
  padding-bottom: 8px;
  font-size: 11px;
  color: #5a726d;
}
.court-hv {
  background: #f2ece1;
}
.court.scored {
  border: 1px solid #14665b;
}
.court-score.todo {
  color: #14665b;
  font-weight: 700;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
}
.picker {
  width: 100%;
  max-height: 70vh;
  padding: 16px;
  border-radius: 16px 16px 0 0;
  background: #ffffff;
  box-sizing: border-box;
}
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.picker-title {
  font-size: 15px;
  font-weight: 800;
  color: #1a2e2a;
}
.picker-close {
  font-size: 18px;
  color: #5a726d;
  padding: 4px;
}
.picker-go {
  margin-top: 4px;
}
.score-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 0 4px;
}
.score-side {
  width: 40px;
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
.score-input {
  width: 76px;
  height: 44px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
  background: #fbfaf5;
  text-align: center;
  font-size: 18px;
  font-weight: 800;
  color: #1a2e2a;
}
.score-colon {
  font-size: 18px;
  font-weight: 800;
  color: #c9d2cf;
}
.score-tip {
  padding-bottom: 12px;
  text-align: center;
  font-size: 11px;
  color: #5a726d;
}

/* ---------- 裁判与打分记录 ---------- */
.court-referee {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #e3e8e6;
}
.court-referee-text {
  font-size: 11px;
  color: #5a726d;
}
.court-referee-edited {
  font-size: 10px;
  color: #8a6d1a;
}
.court-log-btn {
  margin-left: auto;
  padding: 3px 10px;
  border: 1px solid #14665b;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #14665b;
}
.court-log-btn-hv {
  background: #e6f1ee;
}
.score-audit {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #faf7f0;
}
.score-audit-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #1a2e2a;
}
.score-audit-badge {
  font-size: 10px;
  font-weight: 600;
  color: #8a6d1a;
}
.score-audit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: #5a726d;
}
.score-audit-who {
  font-weight: 600;
  color: #1a2e2a;
}
.score-audit-time {
  margin-left: auto;
  font-size: 10px;
  color: #9aa8a4;
}
.log-list {
  max-height: 46vh;
  padding: 4px 0;
}
.log-row {
  padding: 8px 0;
  border-bottom: 1px solid #f0efea;
}
.log-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.log-avatar {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #ffffff;
  font-size: 12px;
  line-height: 26px;
  text-align: center;
  margin-right: 8px;
}
.log-avatar-img {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  margin-right: 8px;
}
.log-who {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: #1a2e2a;
}
.log-time {
  font-size: 10px;
  color: #9aa8a4;
}
.log-text {
  margin-top: 2px;
  font-size: 12px;
  color: #5a726d;
}
.log-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: #9aa8a4;
}
</style>
