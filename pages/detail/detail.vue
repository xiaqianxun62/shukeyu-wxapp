<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { ARRANGE_SCHEMES, GAME_STATUS, MATCH_FORMAT, arrangeGame, cancelRegisterGame, deleteGame, getGame, getGameMatches, hideGame, registerGame, scoreMatch, unhideGame } from '../../common/api/game'
import { getRotationForGame } from '../../common/api/rotation'
import { AVATAR_COLORS, genderText, resolveUrl, shortDate, shortTime, toastError } from '../../common/util'
import { wgs84ToGcj02 } from '../../common/coord'
import SmartImage from '../../components/SmartImage/SmartImage.vue'
import QqMapView from '../../components/QqMapView/QqMapView.vue'
import { useAuth } from '../../common/store/auth'
import { navigateTo } from '../../common/nav'
import NavBack from '../../components/nav-back/nav-back.vue'

const { isLoggedIn, user } = useAuth()

const gameId = ref(0)
const game = ref(null)
const loading = ref(false)
const activeTab = ref('报名名单')
const tabs = ['报名名单', '轮排安排', '轮排结果', '局内得分排名']
const arranging = ref(false)
const matches = ref(null)
const joining = ref(false)
const canceling = ref(false)
const pickerVisible = ref(false)
const roundRobin = ref(false)
const schemeId = ref(0)
/** 计分弹层 */
const scoreVisible = ref(false)
const scoring = ref(false)
const scoreForm = ref({ matchId: 0, scoreA: '', scoreB: '' })
/** 当前弹层对阵的计分信息：裁判与改分历史（来自 matches 接口的 refereeName / scoreLogs） */
const scoreAudit = ref({ refereeName: '', logs: [] })
/** 打分记录弹层：本场谁当裁判、计了多少分、之后谁又改了分 */
const logVisible = ref(false)
const logForm = ref({ round: 0, court: 0 })
const logRows = ref([])
/** 轮排统计：局内得分排名（已编排的球局才有） */
const rotationStats = ref([])

const statusInfo = computed(() => GAME_STATUS[game.value ? game.value.status : 0])

/** 默认封面图（game.cover 为空时使用） */
const DEFAULT_COVER = '/uploads/cover_1791509309948_6080.jpg'
const coverUrl = computed(() => game.value?.cover || DEFAULT_COVER)
/** 轮排结果 / 得分排名页签下隐藏球局头卡与报名操作，把屏幕让给对阵表 */
const showOverview = computed(
  () => activeTab.value === '报名名单' || activeTab.value === '轮排安排',
)
/** 现场报名球局：没有时间地点，人齐后现场编排开打 */
/** 只有发起人能拍板编排方案（管理员例外） */
const canManage = computed(
  () => !!(game.value && user.value && (game.value.creatorId === user.value.userId || user.value.isAdmin)),
)

const isOnsite = computed(() => !!game.value && game.value.mode === 1)
/** 只有发起人能拍板编排方案 */
const isCreator = computed(
  () => !!(game.value && user.value && game.value.creatorId === user.value.userId),
)
const canArrange = computed(
  () =>
    !!game.value &&
    game.value.status === 0 &&
    canManage.value &&
    game.value.registrations.length >= 4,
)
const registered = computed(() => {
  if (!game.value || !user.value) return false
  return game.value.registrations.some((r) => r.userId === user.value.userId)
})
/** 球局是否已满员（报名数 ≥ 人数上限） */
const isFull = computed(
  () =>
    !!game.value &&
    (game.value.registeredCount || 0) >= (game.value.maxPlayers || 0),
)
/** 报名男女统计：小程序端直接按名单里的性别字段算，不用额外请求 */
const genderStat = computed(() => {
  const list = (game.value && game.value.registrations) || []
  let male = 0
  let female = 0
  list.forEach((r) => {
    if (r.gender === 1) male += 1
    else if (r.gender === 2) female += 1
  })
  return { total: list.length, male, female }
})

/** 点击地图 → 打开原生地图查看（微信小程序/H5 都支持） */
function openCourtMap() {
  const g = game.value
  if (!g?.courtLat || !g?.courtLng) return
  // uni.openLocation 在微信里也是 GCJ-02
  const [mgLng, mgLat] = wgs84ToGcj02(Number(g.courtLng), Number(g.courtLat))
  uni.openLocation({
    latitude: mgLat,
    longitude: mgLng,
    name: g.courtName || g.location || '球场位置',
    address: g.location || '',
    scale: 17,
  })
}

/** 发起人信息：从 game.creator* 字段直接取，不依赖 registrations */
const creatorInfo = computed(() => {
  const g = game.value
  console.log('[creatorInfo] game keys:', g ? Object.keys(g) : null, 'creatorName:', g?.creatorName, 'creatorId:', g?.creatorId)
  if (!g || !g.creatorId) return null
  return {
    userId: g.creatorId,
    displayName: g.creatorName || '球友',
    avatar: g.creatorAvatar || null,
    gender: g.creatorGender || 0,
    rating: g.creatorRating || 0,
  }
})

/** 局内得分排名：按胜场降序，再按净胜分、总 ELO 降序 */
const rankedStats = computed(() => {
  return [...rotationStats.value].sort((a, b) => {
    if ((b.winCount || 0) !== (a.winCount || 0)) return (b.winCount || 0) - (a.winCount || 0)
    if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0)
    return (b.rating || 0) - (a.rating || 0)
  })
})

/**
 * 把扁平的 matches.matches 按 round × court 分组。
 * GameMatchesResponse.MatchItem 没有 round/court 字段，
 * 但编排引擎输出顺序是：先第 1 轮所有场地，再第 2 轮...
 * 所以用 game.courtCount 推算：roundIdx = Math.floor(i / courtCount)
 */
const roundGroups = computed(() => {
  const flat = (matches.value && matches.value.matches) || []
  const courtCount = (game.value && game.value.courtCount) || 1
  const groups = []
  for (let i = 0; i < flat.length; i += courtCount) {
    const slice = flat.slice(i, i + courtCount)
    const roundNo = Math.floor(i / courtCount) + 1
    // 给每个 match 补上推算的 court 号（1-based）
    const matchesWithCourt = slice.map((m, j) => ({ ...m, court: j + 1, round: roundNo }))
    groups.push({ round: roundNo, matches: matchesWithCourt })
  }
  return groups
})

/* ---------- 轮排结果筛选（右下角圆形按钮） ---------- */
/** 对局状态筛选项（可多选，多选=命中任一即可） */
const STATUS_FILTERS = [
  { value: 'done', label: '已打完' },
  { value: 'pending', label: '未打' },
]
/** 圆形按钮是否已向左展开成操作条（宽度动画，高度不变） */
const fabExpanded = ref(false)
/** 已选状态：空数组=不限 */
const filterStatuses = ref([])
/** 已选角色（参与用户）userId：空数组=不限 */
const filterUsers = ref([])
/** 上拉框：null=关闭 'role'=选角色 'status'=选对局状态 */
const optionSheet = ref(null)

/** 当前筛选项的展示文案，回显在展开后的按钮上 */
const roleLabel = computed(() => {
  if (!filterUsers.value.length) return '全部'
  if (filterUsers.value.length === 1) {
    const p = resultPlayers.value.find((x) => x.userId === filterUsers.value[0])
    return p ? p.name : '全部'
  }
  return `${filterUsers.value.length} 人`
})
const statusLabel = computed(() => {
  if (!filterStatuses.value.length) return '全部'
  if (filterStatuses.value.length === 1) {
    const s = STATUS_FILTERS.find((x) => x.value === filterStatuses.value[0])
    return s ? s.label : '全部'
  }
  return '已打完 / 未打'
})
/** 弹层选项：按当前打开的筛选维度给出，首项「全部」用于清空该维度 */
const sheetOptions = computed(() =>
  optionSheet.value === 'role'
    ? [
        { value: 0, label: '全部', avatar: '' },
        ...resultPlayers.value.map((p) => ({ value: p.userId, label: p.name, avatar: p.avatar })),
      ]
    : [{ value: 'all', label: '全部' }, ...STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))],
)
/** 某一项是否已被勾选（多选） */
function isOptionChecked(opt) {
  if (optionSheet.value === 'role') {
    return opt.value === 0 ? filterUsers.value.length === 0 : filterUsers.value.includes(opt.value)
  }
  return opt.value === 'all' ? filterStatuses.value.length === 0 : filterStatuses.value.includes(opt.value)
}

/** 本球局轮排里出现过的全部球员（含头像），供筛选面板点选 */
const resultPlayers = computed(() => {
  const seen = new Map()
  const flat = (matches.value && matches.value.matches) || []
  flat.forEach((m) => {
    const sides = [...sidePlayers(m.teamA, m.teamANames), ...sidePlayers(m.teamB, m.teamBNames)]
    sides.forEach((p) => {
      if (p.userId != null && !seen.has(p.userId)) {
        seen.set(p.userId, {
          userId: p.userId,
          name: p.name || `球友${p.userId}`,
          avatar: p.avatar || '',
        })
      }
    })
  })
  return [...seen.values()]
})

/** 已生效的筛选项数量，用于在圆形按钮上角标提示 */
const filterCount = computed(() => (filterStatuses.value.length ? 1 : 0) + (filterUsers.value.length ? 1 : 0))

/**
 * 单场对阵是否命中当前筛选条件。
 * 同一维度内多选是「或」：命中任一项即可；维度之间是「且」：既要符合角色又要符合状态。
 */
function matchFilter(m) {
  if (filterStatuses.value.length) {
    const done = !!m.winner
    if (!filterStatuses.value.some((s) => (s === 'done' ? done : !done))) return false
  }
  if (filterUsers.value.length) {
    const ids = [...(m.teamA || []), ...(m.teamB || [])]
    if (!filterUsers.value.some((u) => ids.includes(u))) return false
  }
  return true
}

/** 筛选后的轮次分组：整轮都被筛掉时不再显示该轮 */
const filteredRoundGroups = computed(() => {
  if (!filterCount.value) return roundGroups.value
  return roundGroups.value
    .map((rg) => ({ ...rg, matches: rg.matches.filter(matchFilter) }))
    .filter((rg) => rg.matches.length)
})

/** 点圆形按钮：展开 / 收起；展开后高度不变，宽度向左平滑拉开 */
function toggleFab() {
  fabExpanded.value = !fabExpanded.value
  // 收起按钮条时，上面挂着的筛选面板也要一起收掉
  if (!fabExpanded.value) optionSheet.value = null
}
function collapseFab() {
  fabExpanded.value = false
  optionSheet.value = null
}

function openOptionSheet(type) {
  optionSheet.value = type
}
function closeOptionSheet() {
  optionSheet.value = null
}
/** 上拉框里点一项：多选切换选中态（点「全部」= 清空本维度） */
function pickOption(value) {
  if (optionSheet.value === 'role') {
    if (value === 0) {
      filterUsers.value = []
      return
    }
    const i = filterUsers.value.indexOf(value)
    if (i >= 0) filterUsers.value.splice(i, 1)
    else filterUsers.value.push(value)
  } else {
    if (value === 'all') {
      filterStatuses.value = []
      return
    }
    const i = filterStatuses.value.indexOf(value)
    if (i >= 0) filterStatuses.value.splice(i, 1)
    else filterStatuses.value.push(value)
  }
}
/** 清空当前打开的那个筛选维度 */
function clearCurrentFilter() {
  if (optionSheet.value === 'role') filterUsers.value = []
  else filterStatuses.value = []
}
function resetFilter() {
  filterStatuses.value = []
  filterUsers.value = []
}

function eloDeltaText(value) {
  const n = value || 0
  return n > 0 ? `+${n}` : `${n}`
}

/** 昵称超过 5 字截断为前 3 字 + 省略号 */
function truncateName(name) {
  if (!name) return ''
  return name.length > 5 ? name.slice(0, 3) + '…' : name
}

async function load() {
  if (!gameId.value) return
  loading.value = true
  try {
    game.value = await getGame(gameId.value)
    // 对阵与统计并行拉取，避免串行瀑布拖慢整页
    await Promise.all([loadMatches(), loadRotationStats()])
  } catch (e) {
    toastError(e, '球局加载失败')
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

/** 编排后的对阵与比分：落库保存，所有人看到的都是同一份 */
async function loadMatches() {
  if (!game.value || game.value.status === 0) {
    matches.value = null
    return
  }
  try {
    matches.value = await getGameMatches(gameId.value)
  } catch (e) {
    matches.value = null
  }
}

/** 轮排统计：局内得分排名（已编排的球局才有，未编排时为空） */
async function loadRotationStats() {
  if (!game.value || game.value.status === 0) {
    rotationStats.value = []
    return
  }
  try {
    const res = await getRotationForGame(gameId.value)
    rotationStats.value = (res && res.stats) || []
  } catch (e) {
    rotationStats.value = []
  }
}

onLoad((options) => {
  gameId.value = Number(options.id || 0)
  load()
})

onPullDownRefresh(() => {
  load()
})

onShow(() => {
  // 从轮排页返回后，比分 / 得分排名可能已更新，重新拉一次（并行）
  if (game.value) {
    Promise.all([loadMatches(), loadRotationStats()])
  }
})

/** 底部 Tab：轮排安排仅发起人可进入，其余在本页切换 */
function onTabClick(tab) {
  if (tab === '轮排安排') {
    if (!isCreator.value) {
      uni.showToast({ title: '轮排安排仅发起人可操作', icon: 'none' })
      return
    }
    navigateTo(`/pages/rotation/rotation?gameId=${gameId.value}`)
    return
  }
  // 离开「轮排结果」时按钮条与筛选面板一并收起，避免面板悬空留在别的页签
  if (tab !== '轮排结果') {
    fabExpanded.value = false
    optionSheet.value = null
  }
  activeTab.value = tab
}

async function join() {
  if (!isLoggedIn.value) {
    navigateTo('/pages/auth/auth')
    return
  }
  // 满员拦截
  if (isFull.value) {
    uni.showToast({ title: '该球局已满员', icon: 'none' })
    return
  }
  joining.value = true
  try {
    await registerGame(gameId.value)
    uni.showToast({ title: '报名成功', icon: 'success' })
    await load()
  } catch (e) {
    toastError(e, '报名失败')
  } finally {
    joining.value = false
  }
}

/** 取消报名：二次确认后释放名额 */
async function cancelJoin() {
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '取消报名',
      content: '取消后名额立即释放，确定要取消吗？',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return
  canceling.value = true
  try {
    await cancelRegisterGame(gameId.value)
    uni.showToast({ title: '已取消报名', icon: 'success' })
    matches.value = null
    await load()
  } catch (e) {
    toastError(e, '取消失败')
  } finally {
    canceling.value = false
  }
}

/** 编辑球局：复用 create 页面（URL 带 id = 进入编辑模式） */
function editGame() {
  navigateTo(`/pages/create/create?id=${gameId.value}`)
}

/** 删除球局：二次确认后软删 + 级联清报名 */
async function deleteThisGame() {
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '删除球局',
      content: '确定要删除这场球局吗？所有已报名记录也会一并清除。',
      confirmColor: '#b33a2e',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return
  try {
    await deleteGame(gameId.value)
    uni.showToast({ title: '球局已删除', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 500)
  } catch (e) {
    toastError(e, '删除失败')
  }
}

/** 发起人/管理员：隐藏球局（不再首页列表显示，但详情页仍可访问） */
async function toggleHidden() {
  const hiding = !game.value?.hidden
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: hiding ? '隐藏球局' : '恢复球局',
      content: hiding ? '隐藏后这场球局将不在首页广场显示。确定吗？' : '恢复后球局会重新出现在首页广场。',
      confirmColor: '#b33a2e',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return
  try {
    if (hiding) await hideGame(gameId.value)
    else await unhideGame(gameId.value)
    uni.showToast({ title: hiding ? '已隐藏' : '已恢复', icon: 'success' })
    game.value.hidden = hiding ? 1 : 0
  } catch (e) {
    toastError(e, hiding ? '隐藏失败' : '恢复失败')
  }
}

function goRotation() {
  navigateTo(`/pages/rotation/rotation?gameId=${gameId.value}`)
}

/** 点击编排：弹出方案选择面板（微信小程序 ActionSheet 最多 6 项，故用自绘弹层） */
function pickArrange() {
  pickerVisible.value = true
}

function closePicker() {
  if (!arranging.value) pickerVisible.value = false
}

async function doArrange(schemeId, roundRobin) {
  arranging.value = true
  try {
    await arrangeGame(gameId.value, { schemeId, roundRobin })
    pickerVisible.value = false
    uni.showToast({ title: '编排完成', icon: 'success' })
    await load()
  } catch (e) {
    toastError(e, '编排失败')
  } finally {
    arranging.value = false
  }
}

/* ---------- 现场计分 ---------- */

function openScore(match) {
  if (!isLoggedIn.value) {
    navigateTo('/pages/auth/auth')
    return
  }
  // 已计分的场次带出原比分，方便改分
  scoreForm.value = {
    matchId: match.matchId,
    scoreA: match.winner ? String(match.scoreA) : '',
    scoreB: match.winner ? String(match.scoreB) : '',
  }
  scoreAudit.value = {
    refereeName: match.refereeName || '',
    logs: match.scoreLogs || [],
  }
  scoreVisible.value = true
}

/** 打分记录：比分改动对所有人公开可查，未登录也能看 */
function openScoreLog(match, round) {
  logForm.value = { round: round || 0, court: match.court || 0 }
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

/** 单条计分日志文案：首次录入 / 改分（含改前比分） */
function logText(log) {
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
  if (a === b) {
    uni.showToast({ title: '比分不能相同', icon: 'none' })
    return
  }
  scoring.value = true
  try {
    const res = await scoreMatch(scoreForm.value.matchId, a, b)
    uni.showToast({
      title: res && res.gameFinished ? '比分已录入，球局结束' : '比分已录入',
      icon: 'success',
    })
    scoreVisible.value = false
    await load()
  } catch (e) {
    toastError(e, '计分失败')
  } finally {
    scoring.value = false
  }
}

function colorOf(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

function nameInitial(name) {
  return (name || '球友').charAt(0)
}

/** 个人头像 URL：兼容旧后端的 avatar 字段，或新 displayAvatar.imageUrl */
function realAvatarOf(r) {
  if (!r) return ''
  if (r.avatar) return r.avatar
  if (r.displayAvatar && r.displayAvatar.imageUrl) return r.displayAvatar.imageUrl
  return ''
}

function playerOf(userId, fallbackName) {
  const r = (game.value && game.value.registrations || []).find(
    (reg) => String(reg.userId) === String(userId),
  )
  const name = fallbackName || r?.displayName || '球友'
  return {
    userId,
    name,
    avatar: realAvatarOf(r),
    // 轮排不使用系统匿名形象，无个人头像时用姓名首字兜底
    avatarView: null,
  }
}

function sidePlayers(team, names) {
  return (team || []).map((id, i) => playerOf(id, names?.[i]))
}
</script>

<template>
  <view class="page">
    <NavBack />

    <view v-if="!game" class="state">{{ loading ? '加载中…' : '球局不存在' }}</view>

    <view v-else class="content">
      <!-- 封面 Banner -->
      <view class="cover-banner" v-if="showOverview">
        <SmartImage :src="coverUrl" mode="aspectFill" class="cover-img" />
        <view class="cover-overlay" />
        <view class="cover-info">
          <text class="cover-title">{{ game.title }}</text>
          <text :class="['badge', statusInfo.type]">{{ statusInfo.text }}</text>
        </view>
      </view>

      <view v-if="showOverview" class="head head-below-cover">
        <view class="head-top">
          <text class="title">{{ game.title }}</text>
          <text :class="['badge', statusInfo.type]">{{ statusInfo.text }}</text>
        </view>
        <view class="line mode-line">
          <text class="mode-badge">{{ isOnsite ? '现场报名' : '预报名' }}</text>
          <text>{{ game.courtCount || 1 }} 片场地</text>
        </view>
        <view class="line">
          <uni-icons type="calendar" size="14" color="#5A726D" />
          <text v-if="isOnsite">{{ game.playDate ? `今天 ${shortDate(game.playDate)} · 人齐后现场开打` : '时间待定 · 人齐后现场开打' }}</text>
          <text v-else>{{ shortDate(game.playDate) }} {{ shortTime(game.startTime) }}-{{ shortTime(game.endTime) }}</text>
        </view>
        <view class="line">
          <uni-icons type="location" size="14" color="#5A726D" />
          <text>{{ game.location || game.courtName || '地点待定' }}</text>
          <text v-if="game.courtName && game.location !== game.courtName && game.location" class="location-alt">（{{ game.courtName }}）</text>
        </view>
        <!-- 地图预览：有经纬度才展示 -->
        <view v-if="game.courtLat && game.courtLng" class="map-section">
          <view class="map-header">
            <text class="map-title">📍 {{ game.courtName || game.location || '球场位置' }}</text>
            <text class="map-sub" v-if="game.courtName && game.location !== game.courtName">{{ game.location }}</text>
          </view>
          <view class="map-wrap">
            <QqMapView
              :latitude="game.courtLat"
              :longitude="game.courtLng"
              :title="game.courtName || game.location || '球场位置'"
              :height="520"
              :radius="11"
              @tap="openCourtMap"
            />
          </view>
          <view class="map-actions">
            <button class="map-btn" @click.stop="openCourtMap">
              <uni-icons type="map-filled" size="14" color="#14665B" />
              导航到此
            </button>
            <button class="map-btn" @click.stop="openCourtMap">
              <uni-icons type="location" size="14" color="#14665B" />
              查看地图
            </button>
          </view>
        </view>
        <view v-if="game.remark" class="remark-block">
          <view class="remark-title">球局备注</view>
          <view class="remark-content">{{ game.remark }}</view>
        </view>
        <view class="line">
          <uni-icons type="person" size="14" color="#5A726D" />
          <text>
            {{ game.registeredCount }} / {{ game.maxPlayers }} 人已报名<template v-if="genderStat.total">
              （男 {{ genderStat.male }} · 女 {{ genderStat.female }}）
            </template>
          </text>
        </view>
      </view>

      <view v-if="showOverview" class="actions">
        <button
          v-if="!registered && isFull && game.status === 0"
          class="btn disabled"
          disabled
        >
          已满员
        </button>
        <button v-else-if="!registered" class="btn primary" :loading="joining" @click="join">
          {{ isLoggedIn ? '报名' : '登录后报名' }}
        </button>
        <button v-else-if="game.status === 0" class="btn danger" :loading="canceling" @click="cancelJoin">
          取消报名
        </button>
        <view v-else-if="game.status === 1" class="joined">等待开赛</view>
        <view v-else-if="game.status === 2" class="joined finished">球局已结束</view>
        <view v-else class="joined">已报名</view>
        <button v-if="canArrange" class="btn ghost" :loading="arranging" @click="pickArrange">
          选择编排方案
        </button>
        <view v-else-if="game.status === 0 && game.registrations.length < 4" class="joined">
          至少 {{ 4 - game.registrations.length }} 人
        </view>
        <view v-else-if="game.status === 0 && isFull" class="joined">已满员，等待发起人</view>
        <view v-else-if="game.status === 0" class="joined">等待发起人</view>
        <button v-if="canManage && game.status === 0" class="btn ghost" @click="editGame">
          编辑球局
        </button>
        <button v-if="canManage && game.status === 0" class="btn danger" @click="deleteThisGame">
          删除球局
        </button>
      </view>

      <!-- 发起人（跟下面报名名单 member 同款样式） -->
      <view class="panel">
        <view class="panel-title">发起人</view>
        <view v-if="creatorInfo" class="member">
          <SmartImage
            v-if="creatorInfo.avatar"
            class="member-avatar-img"
            :src="creatorInfo.avatar"
            mode="aspectFill"
          />
          <view v-else class="avatar" :style="{ background: colorOf(creatorInfo.userId) }">
            {{ (creatorInfo.displayName || '?').charAt(0) }}
          </view>
          <view class="member-info">
            <text class="member-name">{{ creatorInfo.displayName || '球友' }}</text>
            <text class="member-meta">{{ genderText(creatorInfo.gender) }} · ELO {{ creatorInfo.rating }}</text>
          </view>
        </view>
        <view v-else class="panel-empty">球局已删除或发起人不存在</view>
        <view v-if="canManage && creatorInfo" class="creator-actions">
          <button class="hide-btn" @click="toggleHidden">
            {{ game.hidden ? '恢复显示' : '隐藏球局' }}
          </button>
        </view>
      </view>

      <view class="tab-content">
        <!-- 报名名单 -->
        <view v-if="activeTab === '报名名单'" class="panel">
          <view class="panel-title">报名名单</view>
          <view v-if="!game.registrations.length" class="panel-empty">还没有人报名</view>
          <view v-for="(r, i) in game.registrations" :key="r.userId" class="member">
            <SmartImage
              v-if="realAvatarOf(r)"
              class="member-avatar-img"
              :src="realAvatarOf(r)"
              mode="aspectFill"
            />
            <view
              v-else-if="r.displayAvatar && r.displayAvatar.emoji"
              class="member-avatar-emoji"
              :style="{ background: r.displayAvatar.bgColor || colorOf(r.userId) }"
            >{{ r.displayAvatar.emoji }}</view>
            <view v-else class="avatar" :style="{ background: colorOf(r.userId) }">
              {{ (r.displayName || '?').charAt(0) }}
            </view>
            <view class="member-info">
              <text class="member-name">{{ r.displayName || '球友' }}</text>
              <text class="member-meta">{{ genderText(r.gender) }} · ELO {{ r.rating }}</text>
            </view>

          </view>
        </view>

        <!-- 轮排安排 -->
        <view v-else-if="activeTab === '轮排安排'" class="panel">
          <view class="panel-title">轮排安排</view>
          <view v-if="game.status === 0 && game.registrations.length < 4" class="panel-empty">
            还差 {{ 4 - game.registrations.length }} 人才能编排
          </view>
          <view v-else-if="game.status === 0 && !isCreator" class="panel-empty">
            等待发起人编排
          </view>
          <view v-else-if="!isCreator" class="panel-empty">
            轮排安排由发起人管理
          </view>
          <view v-else class="arrange-actions">
            <button v-if="game.status === 0 && canManage" class="btn primary" :loading="arranging" @click="pickArrange">
              选择编排方案
            </button>
            <button v-if="canManage && game.registrations.length >= 4" class="btn ghost" @click="goRotation">
              进入轮排安排页面
            </button>
          </view>
        </view>

        <!-- 轮排结果 -->
        <view v-else-if="activeTab === '轮排结果'" class="panel">
          <view class="panel-title">
            轮排结果 · {{ (matches && matches.schemeName) || '自动编排' }}
            <text v-if="matches" class="rr-badge">{{ matches.finishedCount }} / {{ matches.totalCount }} 场已打完</text>
          </view>
          <view v-if="!matches || !matches.matches.length" class="panel-empty">还没有编排结果</view>
          <view v-else-if="!filteredRoundGroups.length" class="panel-empty">没有符合筛选条件的对局</view>
          <template v-else>
            <view v-for="rg in filteredRoundGroups" :key="rg.round" class="rr-round">
              <view class="rr-round-head">
                <text class="rr-round-no">第 {{ rg.round }} 轮</text>
              </view>
              <view class="rr-grid">
                <view
                  v-for="m in rg.matches"
                  :key="`${rg.round}-${m.court}`"
                  :class="['rr-match', { scored: m.winner }]"
                  hover-class="rr-match-hv"
                  hover-stay-time="120"
                  @click="openScore(m)"
                >
                  <view class="rr-match-top">
                    <text class="rr-match-type">{{ MATCH_FORMAT[m.format] || '双打' }} · {{ m.court }} 号场</text>
                    <text v-if="m.winner" class="rr-match-score">
                      <text :class="['score-num', { best: m.scoreA > m.scoreB }]">{{ m.scoreA }}</text>
                      <text class="score-colon">:</text>
                      <text :class="['score-num', { best: m.scoreB > m.scoreA }]">{{ m.scoreB }}</text>
                    </text>
                    <text v-else class="rr-match-score todo">录比分 ›</text>
                  </view>
                  <view class="rr-match-sides">
                    <view class="rr-match-side">
                      <view
                        v-for="(p, pi) in sidePlayers(m.teamA, m.teamANames)"
                        :key="`a-${p.userId}`"
                        class="rr-player"
                      >
                        <SmartImage v-if="p.avatar" class="rr-avatar-img" :src="p.avatar" mode="aspectFill" />
                        <view v-else-if="p.avatarView && p.avatarView.emoji" class="rr-avatar-emoji"
                              :style="{ background: p.avatarView.bgColor || colorOf(p.userId) }">
                          {{ p.avatarView.emoji }}
                        </view>
                        <view v-else class="rr-avatar" :style="{ background: colorOf(p.userId) }">
                          {{ nameInitial(p.name) }}
                        </view>
                        <text class="rr-player-name">{{ p.name }}</text>
                      </view>
                    </view>
                    <text class="rr-match-vs">VS</text>
                    <view class="rr-match-side">
                      <view
                        v-for="(p, pi) in sidePlayers(m.teamB, m.teamBNames)"
                        :key="`b-${p.userId}`"
                        class="rr-player"
                      >
                        <SmartImage v-if="p.avatar" class="rr-avatar-img" :src="p.avatar" mode="aspectFill" />
                        <view v-else-if="p.avatarView && p.avatarView.emoji" class="rr-avatar-emoji"
                              :style="{ background: p.avatarView.bgColor || colorOf(p.userId) }">
                          {{ p.avatarView.emoji }}
                        </view>
                        <view v-else class="rr-avatar" :style="{ background: colorOf(p.userId) }">
                          {{ nameInitial(p.name) }}
                        </view>
                        <text class="rr-player-name">{{ p.name }}</text>
                      </view>
                    </view>
                  </view>
                  <view v-if="m.refereeName" class="rr-match-referee">
                    <text>裁判 · {{ m.refereeName }}</text>
                    <text v-if="(m.scoreLogs || []).length > 1" class="rr-referee-edited">已改分</text>
                    <view
                      v-if="(m.scoreLogs || []).length"
                      class="rr-log-btn"
                      hover-class="rr-log-btn-hv"
                      hover-stay-time="120"
                      @click.stop="openScoreLog(m, rg.round)"
                    >打分记录</view>
                  </view>
                </view>
              </view>
            </view>
          </template>
        </view>

        <!-- 局内得分排名 -->
        <view v-else-if="activeTab === '局内得分排名'" class="panel">
          <view class="panel-title">
            局内得分排名
            <text v-if="matches" class="rr-badge">{{ matches.finishedCount }} / {{ matches.totalCount }} 场已打完</text>
          </view>
          <view v-if="!rankedStats.length" class="panel-empty">还没有比赛得分</view>
          <view v-else class="rank-table">
            <!-- 表头 -->
            <view class="rank-thead">
              <text class="col-rank">#</text>
              <text class="col-name">名字</text>
              <text class="col-gender">性别</text>
              <text class="col-wl">胜负</text>
              <text class="col-net">净胜分</text>
              <text class="col-elo">ELO</text>
            </view>
            <!-- 数据行 -->
            <view v-for="(s, i) in rankedStats" :key="s.userId" class="rank-row">
              <text :class="['col-rank', 'rank-no', { gold: i === 0, silver: i === 1, bronze: i === 2 }]">{{ i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1 }}</text>
              <view class="col-name">
                <view class="rank-avatar">
                  <SmartImage v-if="s.avatar" class="rank-avatar-img" :src="s.avatar" mode="aspectFill" />
                  <view v-else class="rank-avatar-fallback" :style="{ background: colorOf(s.userId) }">
                    {{ s.label ? s.label.charAt(0) : '球' }}
                  </view>
                </view>
                <text class="stat-name">{{ truncateName(s.label) }}</text>
              </view>
              <text class="col-gender">{{ genderText(s.gender) }}</text>
              <text class="col-wl">{{ s.winCount || 0 }}-{{ s.loseCount || 0 }}</text>
              <text class="col-net">{{ s.points || 0 }}</text>
              <text :class="['col-elo', 'elo-delta', { up: (s.eloDelta || 0) > 0, down: (s.eloDelta || 0) < 0 }]">
                {{ eloDeltaText(s.eloDelta) }}
              </text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部 Tab 栏 -->
    <view v-if="game" class="tab-bar">
      <view
        v-for="tab in tabs"
        :key="tab"
        :class="['tab-item', { active: activeTab === tab }]"
        @click="onTabClick(tab)"
      >
        {{ tab }}
      </view>
    </view>

    <!-- 编排方案选择弹层（微信小程序 ActionSheet 最多 6 项，故自绘） -->
    <view v-if="pickerVisible" class="mask" @click="closePicker">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">选择编排方案</text>
          <text class="picker-close" @click="closePicker">✕</text>
        </view>
        <scroll-view scroll-y class="picker-list">
          <view
            v-for="s in ARRANGE_SCHEMES"
            :key="s.id"
            :class="['scheme', { active: schemeId === s.id }]"
            @click="schemeId = s.id"
          >
            <text class="scheme-name">{{ s.name }}</text>
            <text class="scheme-desc">{{ s.desc }}</text>
          </view>
        </scroll-view>
        <view class="picker-toggle" @click="roundRobin = !roundRobin">
          <text>循环赛模式（每支队伍与其他队伍各打一场）</text>
          <view :class="['switch', { on: roundRobin }]">
            <view class="knob" />
          </view>
        </view>
        <button class="btn primary picker-go" :loading="arranging" @click="doArrange(schemeId, roundRobin)">
          开始编排
        </button>
      </view>
    </view>

    <!-- 计分弹层：打完一场录一次，胜方按比分自动判定 -->
    <view v-if="scoreVisible" class="mask" @click="closeScore">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">录入比分</text>
          <text class="picker-close" @click="closeScore">✕</text>
        </view>
        <view class="score-row">
          <text class="score-side">A 队</text>
          <input class="score-input" type="number" v-model="scoreForm.scoreA" placeholder="0" />
          <text class="score-colon">:</text>
          <input class="score-input" type="number" v-model="scoreForm.scoreB" placeholder="0" />
          <text class="score-side">B 队</text>
        </view>
        <view class="score-tip">胜方按比分自动判定，例如 21 : 15</view>
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
        <button class="btn primary picker-go" type="button" :loading="scoring" @click="submitScore">
          保存比分
        </button>
      </view>
    </view>

    <!-- 轮排结果筛选：圆形按钮点一下向左展开成条，再点「角色 / 状态」上拉选择 -->
    <view
      v-if="activeTab === '轮排结果' && matches && matches.matches.length"
      :class="['fab', { expand: fabExpanded }]"
      @click="toggleFab"
    >
      <uni-icons v-if="!fabExpanded" type="search" size="20" color="#faf7f0" />
      <view v-if="filterCount && !fabExpanded" class="fab-badge">{{ filterCount }}</view>
      <template v-if="fabExpanded">
        <view class="fab-item" @click.stop="openOptionSheet('role')">
          <text class="fab-item-label">角色</text>
          <text class="fab-item-value">{{ roleLabel }}</text>
        </view>
        <view class="fab-item" @click.stop="openOptionSheet('status')">
          <text class="fab-item-label">状态</text>
          <text class="fab-item-value">{{ statusLabel }}</text>
        </view>
        <view class="fab-item ghost" @click.stop="resetFilter">重置</view>
        <view class="fab-close" @click.stop="collapseFab">✕</view>
      </template>
    </view>

    <!-- 筛选面板：从按钮条上方（角色按钮所在位置）向上展开 -->
    <view v-if="optionSheet && activeTab === '轮排结果'" class="panel-mask" @click="closeOptionSheet">
      <view :class="['filter-panel', optionSheet === 'role' ? 'panel-role' : 'panel-status']" @click.stop>
        <view class="panel-head">
          <text class="panel-title">{{ optionSheet === 'role' ? '角色（可多选）' : '对局状态（可多选）' }}</text>
          <text class="panel-clear" @click="clearCurrentFilter">清空</text>
        </view>

        <!-- 角色：头像 + 名字 -->
        <scroll-view v-if="optionSheet === 'role'" scroll-y class="panel-list">
          <view
            v-for="opt in sheetOptions"
            :key="opt.value"
            :class="['role-row', { active: isOptionChecked(opt) }]"
            @click="pickOption(opt.value)"
          >
            <SmartImage v-if="opt.avatar" class="role-avatar-img" :src="opt.avatar" mode="aspectFill" />
            <view v-else :class="['role-avatar', { none: opt.value === 0 }]" :style="opt.value === 0 ? {} : { background: colorOf(opt.value) }">
              {{ opt.value === 0 ? '全' : opt.label.charAt(0) }}
            </view>
            <text class="role-name">{{ opt.label }}</text>
            <text v-if="isOptionChecked(opt)" class="role-check">✓</text>
          </view>
        </scroll-view>

        <!-- 对局状态：文字选项 -->
        <scroll-view v-else scroll-y class="panel-list">
          <view
            v-for="opt in sheetOptions"
            :key="opt.value"
            :class="['status-row', { active: isOptionChecked(opt) }]"
            @click="pickOption(opt.value)"
          >
            <text class="status-name">{{ opt.label }}</text>
            <text v-if="isOptionChecked(opt)" class="role-check">✓</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 打分记录弹层：本场比分的录入与修改全过程（不登录也能看） -->
    <view v-if="logVisible" class="mask" @click="closeScoreLog">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">打分记录 · 第 {{ logForm.round }} 轮 {{ logForm.court }} 号场</text>
          <text class="picker-close" @click="closeScoreLog">✕</text>
        </view>
        <scroll-view scroll-y class="log-list">
          <view v-for="(log, li) in logRows" :key="li" class="score-audit-row">
            <text class="score-audit-who">{{ log.operatorName }}</text>
            <text class="score-audit-text">{{ logText(log) }}</text>
            <text class="score-audit-time">{{ formatLogTime(log.time) }}</text>
          </view>
          <view v-if="!logRows.length" class="panel-empty">还没有打分记录</view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding: 16px 16px calc(64px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.tab-content {
  margin-top: 14px;
}
.tab-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1px solid #e3e8e6;
  background: #ffffff;
  z-index: 50;
}
.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #5a726d;
}
.tab-item.active {
  color: #14665b;
  font-weight: 700;
  background: #e0f1ec;
}
.arrange-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.state {
  margin-top: 80px;
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
/* ===== 封面 Banner ===== */
.cover-banner {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  height: 160px;
  margin-bottom: 8px;
}
.cover-img {
  width: 100%;
  height: 100%;
  display: block;
}
.cover-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(26,46,42,0) 40%, rgba(26,46,42,0.88) 100%);
}
.cover-info {
  position: absolute;
  left: 16px; right: 16px; bottom: 12px;
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 10px;
}
.cover-title {
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 1px 4px rgba(0,0,0,.5);
  line-height: 1.3;
  flex: 1;
  min-width: 0;
}
.cover-info .badge {
  flex-shrink: 0;
}

.head-below-cover {
  margin-top: 0;
}

.head {
  padding: 16px;
  border-radius: 12px;
  background: #14665b;
  color: #faf7f0;
}
.head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.title {
  flex: 1;
  margin-right: 8px;
  font-size: 18px;
  font-weight: 800;
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.badge.primary {
  background: #e5c84b;
  color: #1a2e2a;
}
.badge.warning {
  background: #fbf1cd;
  color: #8a6d1a;
}
.badge.default {
  background: #e3e8e6;
  color: #5a726d;
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 13px;
  opacity: 0.92;
}
.location-alt {
  color: #5a726d;
  font-size: 12px;
}
/* ===== 地图区块：独立白底圆角卡片 ===== */
.map-section {
  margin-top: 8px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(20, 102, 91, 0.08);
  overflow: hidden;
}
.map-header {
  padding: 8px 14px 8px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.map-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a2e2a;
}
.map-sub {
  font-size: 12px;
  color: #5a726d;
}
.map-wrap {
  position: relative;
  background: #eee;
  max-height: 320px;
}
.map-actions {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border-top: 1px solid #f0efea;
}
.map-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f1f5f3;
  color: #14665b;
  font-size: 13px;
  font-weight: 600;
  border: none;
  line-height: 1;
}
.map-btn:active { background: #e0f1ec; }
.map-btn::after { display: none; }
.remark-block {
  margin: 8px 0 10px;
  padding: 10px 12px;
  background: #f0efea;
  border-radius: 8px;
  border-left: 3px solid #14665b;
}
.remark-title {
  font-size: 11px;
  font-weight: 700;
  color: #14665b;
  margin-bottom: 4px;
  letter-spacing: 0.5px;
}
.remark-content {
  font-size: 13px;
  color: #1a2e2a;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.actions {
  display: flex;
  gap: 10px;
  margin: 14px 0;
}
.btn {
  flex: 1;
  height: 42px;
  line-height: 42px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
}
.btn.primary {
  border: none;
  background: #e5c84b;
  color: #1a2e2a;
}
.btn.ghost {
  border: 1px solid #14665b;
  background: #ffffff;
  color: #14665b;
}
.btn.danger {
  border: 1px solid #c0392b;
  background: #ffffff;
  color: #c0392b;
}
.btn.disabled {
  border: none;
  background: #e3e8e6;
  color: #9aa39c;
}
.joined {
  flex: 1;
  height: 42px;
  line-height: 42px;
  text-align: center;
  border-radius: 10px;
  background: #e0f1ec;
  color: #14665b;
  font-size: 13px;
  font-weight: 600;
}
.joined.finished {
  background: #f0f2f1;
  color: #6b7672;
}
.panel {
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(20, 102, 91, 0.08);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 800;
  color: #1a2e2a;
}
.creator-actions {
  margin-top: 8px;
}
.hide-btn {
  width: 100%;
  height: 36px;
  font-size: 12px;
  font-weight: 600;
  color: #b33a2e;
  background: #fef5f4;
  border: 1px solid #f3cfc8;
  border-radius: 8px;
  padding: 0;
  margin: 0;
  line-height: 36px;
  text-align: center;
  transition: background 0.15s, transform 0.1s;
}
.hide-btn:active {
  background: #f3cfc8;
  transform: scale(0.98);
}
.panel-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: #5a726d;
}
.member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #f0efea;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}
.member-avatar-img {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #e3e8e6;
  flex-shrink: 0;
}
.member-avatar-emoji {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 17px;
  flex-shrink: 0;
}
.member-info {
  display: flex;
  flex-direction: column;
}
.member-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a2e2a;
}
.member-meta {
  font-size: 11px;
  color: #5a726d;
}
.real-badge {
  padding: 2px 6px;
  border-radius: 6px;
  background: #e0f1ec;
  color: #14665b;
  font-size: 10px;
}
/* ===== 轮排结果 round 分组竖排 ===== */
.rr-round {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
  background: #ffffff;
}
.rr-round-head {
  margin-bottom: 8px;
}
.rr-round-no {
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
}
.rr-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
.rr-match {
  padding: 10px;
  border-radius: 8px;
  background: #faf7f0;
}
.rr-match.scored { border: 1px solid #14665b; }
.rr-match-hv { background: #f2ece1; }
.rr-match-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.rr-match-type { font-size: 12px; font-weight: 700; color: #14665b; }
.rr-match-score { font-size: 15px; color: #5a726d; }
.rr-match-score .score-num.best { color: #e03333 !important; font-weight: 800 !important; font-size: 19px !important; }
.rr-match-score .score-colon { margin: 0 2px; color: #c9d2cf; }
.rr-match-score.todo { color: #14665b; font-weight: 700; }
.rr-match-sides {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 6px 0 2px;
}
.rr-match-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  justify-content: center;
}
.rr-match-vs {
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
  flex-shrink: 0;
}
.rr-player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  max-width: 52px;
}
.rr-avatar,
.rr-avatar-img,
.rr-avatar-emoji {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.rr-avatar-img { border: 1.5px solid #e3e8e6; }
.rr-player-name {
  font-size: 11px;
  color: #1a2e2a;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.match {
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: #faf7f0;
}

/* ---------- 编排方案弹层 ---------- */
.mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgba(26, 46, 42, 0.45);
  display: flex;
  align-items: flex-end;
}
.picker {
  width: 100%;
  border-radius: 16px 16px 0 0;
  background: #ffffff;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
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
  padding: 4px;
  font-size: 14px;
  color: #5a726d;
}
.picker-list {
  max-height: 320px;
}
.scheme {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
  background: #faf7f0;
}
.scheme.active {
  border-color: #14665b;
  background: #e0f1ec;
}
.scheme-name {
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.scheme-desc {
  font-size: 11px;
  color: #5a726d;
}
.picker-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  font-size: 13px;
  color: #1a2e2a;
}
.switch {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: #d8dcd6;
  padding: 2px;
  box-sizing: border-box;
  transition: background 0.2s;
}
.switch.on {
  background: #14665b;
}
.switch .knob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s;
}
.switch.on .knob {
  transform: translateX(18px);
}
.picker-go {
  margin-top: 8px;
  width: 100%;
}
.rr-badge {
  padding: 1px 8px;
  border-radius: 999px;
  background: #fbf1cd;
  color: #8a6d1a;
  font-size: 10px;
  font-weight: 700;
}
.match-type {
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #14665b;
}
.match-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.match-score {
  font-size: 14px;
  font-weight: 800;
  color: #1a2e2a;
}
.match-score.todo {
  font-size: 12px;
  font-weight: 700;
  color: #14665b;
}
.match-sides {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
}
.match-side {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.match-player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.match-avatar-img {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #e3e8e6;
}
.match-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
}
.match-avatar-emoji {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 17px;
}
.match-player-name {
  max-width: 56px;
  font-size: 11px;
  color: #1a2e2a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-vs {
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
  flex-shrink: 0;
}
.match-hv {
  background: #f2ece1;
}
.mode-line {
  gap: 8px;
}
.mode-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: #faf7f0;
  font-size: 11px;
  font-weight: 700;
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
/* 计分留痕：裁判与改分历史 */
.score-audit {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
  background: #f7faf8;
}
.score-audit-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: #14665b;
  margin-bottom: 6px;
}
.score-audit-badge {
  font-size: 10px;
  font-weight: 600;
  color: #8a6d1a;
  background: #f6ecc9; border-radius: 8px;
  padding: 1px 8px;
}
.score-audit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #5a726d;
  padding: 3px 0;
}
.score-audit-who {
  flex-shrink: 0;
  font-weight: 600;
  color: #1a2e2a;
}
.score-audit-text {
  flex: 1;
  min-width: 0;
}
.score-audit-time {
  flex-shrink: 0;
  font-size: 10px;
  color: #9aa8a4;
}
.rr-match-referee {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 10px;
  color: #5a726d;
}
.rr-referee-edited {
  font-size: 10px;
  color: #8a6d1a;
  background: #f6ecc9;
  border-radius: 8px;
  padding: 0 6px;
}
/* 轮排结果筛选：圆形按钮 → 向左平滑拓宽成操作条（高度不变） */
.fab {
  position: fixed;
  right: 20px;
  bottom: calc(84px + env(safe-area-inset-bottom));
  height: 52px;
  width: 52px;
  padding: 0;
  border-radius: 26px;
  background: #14665b;
  box-shadow: 0 4px 14px rgba(20, 102, 91, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
  z-index: 90;
  transition: width 0.3s ease, padding 0.3s ease;
}
.fab.expand {
  width: calc(100vw - 40px);
  padding: 0 8px 0 14px;
  justify-content: flex-start;
}
.fab-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-sizing: border-box;
}
.fab-item {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-right: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}
.fab-item.ghost {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.fab-item-label {
  font-size: 11px;
  font-weight: 700;
  color: #faf7f0;
}
.fab-item-value {
  max-width: 76px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #faf7f0;
}
.fab-close {
  margin-left: auto;
  padding: 6px 10px;
  font-size: 14px;
  color: #faf7f0;
}
/* 筛选面板：锚在按钮条正上方（角色按钮位置），从下往上展开 */
.panel-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.filter-panel {
  position: fixed;
  left: 20px;
  bottom: calc(146px + env(safe-area-inset-bottom));
  width: 260px;
  max-width: calc(100vw - 40px);
  max-height: 54vh;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(20, 51, 45, 0.2);
  box-sizing: border-box;
  z-index: 95;
  transform-origin: left bottom;
  animation: panel-up 0.22s ease both;
}
@keyframes panel-up {
  from { opacity: 0; transform: translateY(14px) scale(0.94); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.panel-title {
  font-size: 12px;
  font-weight: 700;
  color: #1a2e2a;
}
.panel-clear {
  font-size: 11px;
  font-weight: 600;
  color: #14665b;
}
.panel-list {
  max-height: 42vh;
}
/* 角色：头像 + 名字 */
.role-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 6px;
  border-radius: 8px;
}
.role-row.active {
  background: #e0f1ec;
}
.role-avatar {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #ffffff;
  font-size: 12px;
  line-height: 26px;
  text-align: center;
}
.role-avatar.none {
  background: #c9d2cf;
}
.role-avatar-img {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
}
.role-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  color: #1a2e2a;
}
.role-row.active .role-name {
  color: #14665b;
  font-weight: 700;
}
.role-check {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: #14665b;
}
/* 对局状态：文字选项 */
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 6px;
  border-bottom: 1px solid #f0efea;
  font-size: 13px;
  color: #1a2e2a;
}
.status-row.active {
  color: #14665b;
  font-weight: 700;
}
.status-name {
  flex: 1;
  min-width: 0;
}
.rr-log-btn {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid #14665b;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: #14665b;
}
.rr-log-btn-hv {
  background: #e6f1ee;
}
.log-list {
  max-height: 46vh;
  padding: 4px 0;
}
.rank-table {
  width: 100%;
  border-top: 1px solid #e3e8e6;
}
.rank-thead {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: #5a726d;
  padding: 6px 4px;
  border-bottom: 1px solid #e3e8e6;
  font-weight: 600;
  background: #f7faf8;
}
.rank-thead .col-rank { flex: 0 0 28px; text-align: center; }
.rank-thead .col-name  { flex: 3; text-align: left; }
.rank-thead .col-gender{ flex: 1; text-align: center; }
.rank-thead .col-wl    { flex: 2; text-align: center; }
.rank-thead .col-net   { flex: 1; text-align: center; }
.rank-thead .col-elo   { flex: 1; text-align: center; }

.rank-row {
  display: flex;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid #f0efea;
  font-size: 12px;
  color: #1a2e2a;
  gap: 0;
}
.rank-row .col-rank { flex: 0 0 28px; text-align: center; }
.rank-row .col-name {
  flex: 3;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.rank-row .col-gender { flex: 1; text-align: center; color: #5a726d; font-size: 12px; }
.rank-row .col-wl     { flex: 2; text-align: center; font-size: 11px; }
.rank-row .col-net    { flex: 1; text-align: center; font-weight: 700; }
.rank-row .col-elo    { flex: 1; text-align: center; }

.rank-no {
  width: 22px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: #5a726d;
  text-align: center;
}
.rank-no.gold {
  color: #d4a017;
  font-size: 14px;
  font-weight: 800;
}
.rank-no.silver {
  color: #8a9baa;
  font-size: 13px;
  font-weight: 700;
}
.rank-no.bronze {
  color: #a0652d;
  font-size: 13px;
  font-weight: 700;
}
.rank-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
}
.rank-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 1px solid #e3e8e6;
  display: block;
}
.rank-avatar-fallback {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.stat-name {
  font-size: 12px;
  font-weight: 600;
  color: #1a2e2a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.elo-delta {
  font-weight: 700;
}
.elo-delta.up {
  color: #14665b;
}
.elo-delta.down {
  color: #b33a2e;
}
</style>
