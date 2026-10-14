<script setup>
import { computed, nextTick, ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { GAME_STATUS, cancelRegisterGame, listGames, registerGame } from '../../common/api/game'
import { getHomePoem } from '../../common/api/settings'
import { AVATAR_COLORS, resolveUrl, shortDate, shortTime, thumbUrl, toastError } from '../../common/util'
import SmartImage from '../../components/SmartImage/SmartImage.vue'
import { useAuth } from '../../common/store/auth'
import { navigateTo, switchTab } from '../../common/nav'

/**
 * 球局广场：墨绿顶栏 + 场馆头图 + 身份卡 + 诗句 + 分类筛选 + 球局卡片。
 * 报名中的第一场作为「精选大卡」，其余用紧凑卡，卡片可展开看详情。
 */

const { user, isLoggedIn, restore } = useAuth()

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const TABS = [
  { text: '默认', status: null },
  { text: '报名中', status: 0 },
  { text: '已编排', status: 1 },
  { text: '已结束', status: 2 },
]

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

const games = ref([])
const loading = ref(false)
const tabIndex = ref(0)
const keyword = ref('')
const searching = ref(false)
const expandedIds = ref([])
const joiningId = ref(0)

/** 排序：时间升序（近→远）/ 降序（远→近） */
const sortAsc = ref(true)

/** 默认诗句（后端为空或加载失败时的兜底） */
const DEFAULT_POEM = {
  line1: '无言独上西楼，月如钩，',
  line2: '寂寞梧桐深院锁清秋。',
  source: '—— 五代 · 李煜《相见欢》',
}

/** 站点可配置文案（从 /settings/home-poem 拉） */
const poem = ref({ ...DEFAULT_POEM })

/** 自定义顶栏的实际占位高度：状态栏 + 16 上边距 + 34 标题行 + 14 下边距 */
const topbarHeight = computed(() => statusBarHeight + 64)

/** 拼一个可比较的日期键：playDate + startTime（null 兜底 00:00） */
function sortDateKey(g) {
  const date = g.playDate || '9999-12-31'
  const t = g.startTime ? String(g.startTime).slice(0, 5) : '00:00'
  return `${date} ${t}`
}

const filtered = computed(() => {
  const status = TABS[tabIndex.value].status
  let list = status === null ? games.value.filter((g) => g.status !== 2) : games.value.filter((g) => g.status === status)
  const kw = keyword.value.trim()
  if (kw) {
    list = list.filter(
      (g) => (g.title || '').includes(kw) || (g.location || '').includes(kw),
    )
  }
  // 前端按时间升/降序
  list = [...list].sort((a, b) => {
    const ka = sortDateKey(a)
    const kb = sortDateKey(b)
    return sortAsc.value ? ka.localeCompare(kb) : kb.localeCompare(ka)
  })
  return list
})

/** 精选大卡：当前筛选结果里的第一场「报名中」，没有就取第一场 */
const featured = computed(() => {
  const list = filtered.value
  return list.find((g) => g.status === 0) || list[0] || null
})

const rest = computed(() =>
  filtered.value.filter((g) => !featured.value || g.id !== featured.value.id),
)

function countOf(status) {
  if (status === null) return games.value.filter((g) => g.status !== 2).length
  return games.value.filter((g) => g.status === status).length
}

async function load() {
  loading.value = true
  try {
    games.value = await listGames()
  } catch (e) {
    toastError(e, '球局加载失败')
  }
  // 站点文案（公开接口，失败时用默认值，不阻塞页面）
  try {
    const data = await getHomePoem()
    if (data && data.line1) poem.value = { ...DEFAULT_POEM, ...data }
  } catch {
    // 文案拉不动不影响首页展示
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

onShow(() => {
  restore()
  load()
})

onPullDownRefresh(() => {
  load()
})

/* ---------- 展示用小工具 ---------- */

function statusText(status) {
  return GAME_STATUS[status] ? GAME_STATUS[status].text : '报名中'
}

function statusClass(status) {
  if (status === 0) return 'open'
  if (status === 1) return 'arr'
  return 'done'
}

function dayOf(playDate) {
  const parts = String(playDate || '').split('-')
  return parts.length === 3 ? String(Number(parts[2])) : '--'
}

function weekdayText(playDate) {
  if (!playDate) return ''
  const date = new Date(String(playDate).replace(/-/g, '/'))
  return Number.isNaN(date.getTime()) ? '' : WEEK[date.getDay()]
}

function percentOf(game) {
  const max = game.maxPlayers || 1
  return Math.min(100, Math.round((game.registeredCount / max) * 100))
}

/** 报名率 ≥ 70% 标记为热门 */
function isHot(game) {
  return game.registeredCount / (game.maxPlayers || 1) >= 0.7
}

function isJoined(game) {
  if (!user.value) return false
  // 列表接口偶尔不带报名名单（字段缺失 / null），这里必须兜底，
  // 否则 .some 抛 TypeError，而 onJoin 是 async，异常会变成 unhandled rejection —— 点了报名毫无反应
  const list = game.registrations || []
  return list.some((r) => r.userId === user.value.userId)
}

/** 报名男女构成；列表接口偶尔不带报名名单，缺了就返回 0，调用处据此不显示，避免「男0女0」误导 */
function genderOf(game) {
  const list = (game && game.registrations) || []
  let male = 0
  let female = 0
  list.forEach((r) => {
    if (r.gender === 1) male += 1
    else if (r.gender === 2) female += 1
  })
  return { total: list.length, male, female }
}

/** 头像组：取前 4 位报名者，渲染优先级 imageUrl > emoji+bgColor > 姓名首字 */
function avatarList(game) {
  const list = game.registrations || []
  return list.slice(0, 4).map((r) => {
    const name = r.displayName || '球友'
    const view = r.displayAvatar || null
    const imageUrl = r.avatar || (view && view.imageUrl) || ''
    return {
      userId: r.userId,
      char: name.charAt(0),
      emoji: view && view.emoji ? view.emoji : '',
      bgColor: view && view.bgColor ? view.bgColor : '',
      imageUrl,
    }
  })
}

function colorOf(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

function creatorName(game) {
  if (!game || !game.registrations) return ''
  const creator = game.registrations.find((r) => r.userId === game.creatorId)
  return creator ? creator.displayName : ''
}

function isExpanded(id) {
  return expandedIds.value.indexOf(id) >= 0
}

/**
 * 列表封面优先显示后端生成的 _thumb.jpg（800×800 JPEG），
 * 历史封面（缩略图功能上线前传的）没有 _thumb 文件，加载失败时回退原图。
 * 这里不预加载原图：列表一次只显示一张大卡，没必要为它多下几 MB。
 */
const coverFallback = ref({})

function coverSrc(game) {
  const cover = game && game.cover
  if (!cover) return ''
  return coverFallback.value[game.id] ? resolveUrl(cover) : resolveUrl(thumbUrl(cover))
}

function onCoverError(game) {
  if (!game) return
  coverFallback.value = { ...coverFallback.value, [game.id]: true }
}

/** 现场报名球局：按 playDate 相对今天显示「今天/昨天/09/xx」 */
function timeText(game) {
  if (game.mode === 1) {
    if (!game.playDate) return '时间待定 · 人齐就打'
    return `${relativeDateLabel(game.playDate)} · 人齐就打`
  }
  return `${shortDate(game.playDate)} ${shortTime(game.startTime)}-${shortTime(game.endTime)}`
}

/** 给 playDate 算相对日期标签：今天 / 昨天 / 09/20 */
function relativeDateLabel(playDate) {
  if (!playDate) return ''
  const today = new Date()
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayStr = fmt(today)
  if (playDate === todayStr) return '今天'
  const yd = new Date(today.getTime() - 86400000)
  if (playDate === fmt(yd)) return '昨天'
  return shortDate(playDate)
}

function toggleExpand(id) {
  const i = expandedIds.value.indexOf(id)
  if (i >= 0) {
    expandedIds.value.splice(i, 1)
    return
  }
  expandedIds.value.push(id)
  nextTick(() => scrollCardIntoView(id))
}

/**
 * 展开后把卡片底部带进视口。
 * 卡片在屏幕下方时，新展开的详情正好落在 tabBar 后面，看上去就是「点了没反应」。
 */
function scrollCardIntoView(id) {
  try {
    const query = uni.createSelectorQuery()
    query.select(`.card-${id}`).boundingClientRect()
    query.selectViewport().scrollOffset()
    query.exec((res) => {
      const rect = res && res[0]
      const scroll = res && res[1]
      if (!rect || !scroll) return
      const viewH = uni.getSystemInfoSync().windowHeight
      const bottom = rect.top + rect.height
      if (bottom > viewH - 24) {
        uni.pageScrollTo({
          scrollTop: scroll.scrollTop + (bottom - viewH) + 72,
          duration: 250,
        })
      }
    })
  } catch (e) {
    /* 滚动失败不影响展开本身 */
  }
}

/** 球局是否已满员（报名数 ≥ 人数上限） */
function isFull(game) {
  return (game.registeredCount || 0) >= (game.maxPlayers || 0)
}

function actionText(game) {
  if (game.status === 1) return '查看对阵'
  if (game.status === 2) return '查看战报'
  if (isJoined(game)) return game.status === 0 ? '已报名 · 取消' : '已报名'
  if (isFull(game)) return '已满员'
  return '报名'
}

/* ---------- 交互 ---------- */

function goDetail(id) {
  navigateTo(`/pages/detail/detail?id=${id}`)
}

function goLogin() {
  navigateTo('/pages/auth/auth')
}

/** 身份卡：未登录去登录页，已登录去「我的」 */
function onIdcard() {
  if (!isLoggedIn.value) {
    goLogin()
    return
  }
  switchTab('/pages/mine/mine')
}

function toggleSearch() {
  searching.value = !searching.value
  if (!searching.value) keyword.value = ''
}

function onBell() {
  uni.showToast({ title: '暂无新通知', icon: 'none' })
}

async function onJoin(game) {
  if (joiningId.value) return // 防重复提交
  if (game.status !== 0) {
    goDetail(game.id)
    return
  }
  // 满员拦截：不弹报名菜单，直接提示并引导进详情页看名单
  if (!isJoined(game) && isFull(game)) {
    uni.showToast({ title: '该球局已满员', icon: 'none' })
    return
  }
  if (!isLoggedIn.value) {
    uni.showToast({ title: '登录后才能报名', icon: 'none' })
    setTimeout(goLogin, 450)
    return
  }
  if (isJoined(game)) {
    // 已报名：报名中的球局可在此直接取消，已编排/已结束的只能进详情查看
    if (game.status !== 0) {
      goDetail(game.id)
      return
    }
    const tap = await new Promise((resolve) => {
      uni.showActionSheet({
        itemList: ['取消报名', '查看球局详情'],
        success: (res) => resolve(res.tapIndex),
        fail: () => resolve(-1),
      })
    })
    if (tap === 1) {
      goDetail(game.id)
      return
    }
    if (tap !== 0) return
    const confirmed = await new Promise((resolve) => {
      uni.showModal({
        title: '取消报名',
        content: '取消后名额立即释放，确定要取消吗？',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return
    joiningId.value = game.id
    try {
      await cancelRegisterGame(game.id)
      uni.showToast({ title: '已取消报名', icon: 'success' })
      await load()
    } catch (e) {
      toastError(e, '取消失败')
    } finally {
      joiningId.value = 0
    }
    return
  }
  joiningId.value = game.id
  try {
    await registerGame(game.id)
    uni.showToast({ title: '报名成功', icon: 'success' })
    await load()
  } catch (e) {
    console.error('[index] register failed', e)
    toastError(e, '报名失败')
  } finally {
    joiningId.value = 0
  }
}
</script>

<template>
  <view class="page">
    <!-- 墨绿顶栏：标题 + 搜索 / 通知 -->
    <view class="topbar" :style="{ paddingTop: statusBarHeight + 16 + 'px' }">
      <text class="pt">球局广场</text>
      <view class="tb-r">
        <view class="tb-btn" @click="toggleSearch">
          <uni-icons type="search" size="18" color="#EDF4EE" />
        </view>
        <view class="tb-btn ring" @click="onBell">
          <uni-icons type="notification" size="18" color="#EDF4EE" />
          <view class="dot" />
        </view>
      </view>
    </view>

    <view class="flow" :style="{ paddingTop: topbarHeight + 'px' }">
      <!-- 场馆头图 -->
      <view class="head">
        <view class="deco deco-1" />
        <view class="deco deco-2" />
        <text class="head-tip">菜肴佳联</text>
      </view>

      <!-- 身份卡 -->
      <view class="idcard" @click="onIdcard">
        <view class="id-top">
          <view v-if="user" class="avatar lg" :style="{ background: colorOf(0) }">
            <image
              v-if="user.avatar"
              class="avatar-img"
              :src="resolveUrl(user.avatar)"
              mode="aspectFill"
            />
            <text v-else>{{ user.name.charAt(0) }}</text>
          </view>
          <view v-else class="avatar lg guest">
            <uni-icons type="person" size="22" color="#7C837D" />
          </view>
          <view class="id-mid">
            <view class="name">
              {{ user ? user.name : '未登录' }}<text class="brand">SHUYU</text>
            </view>
            <view class="tag">
              {{ user ? '已打 ' + user.gamesPlayed + ' 场' : '点击登录后报名球局' }}
            </view>
          </view>
          <view class="elo">
            <text class="l">ELO 积分</text>
            <text class="n">{{ user ? user.rating : '—' }}</text>
            <text class="up">{{ user ? user.gamesPlayed + ' 场' : '登录查看' }}</text>
          </view>
        </view>
      </view>

      <!-- 诗句签名（后端可配置） -->
     <view class="poem">
        <text class="qm">"</text>
		<view class="p-body">
		  <text class="p-line">{{ poem.line1 }}</text>
		  <text class="p-line">{{ poem.line2 }}<text class="qm">"</text></text>
		  <text class="src">{{ poem.source }}</text>
		</view>
      </view>

      <!-- 搜索条 -->
      <view v-if="searching" class="search-row">
        <view class="search-box">
          <uni-icons type="search" size="15" color="#7C837D" />
          <input
            v-model="keyword"
            class="search-input"
            placeholder="搜索球局标题 / 场馆"
            placeholder-class="ph"
            confirm-type="search"
          />
          <text v-if="keyword" class="search-clear" @click="keyword = ''">✕</text>
        </view>
      </view>

      <!-- 分类筛选 -->
      <view class="tabs">
        <view
          v-for="(tab, i) in TABS"
          :key="tab.text"
          :class="['tab', { on: i === tabIndex }]"
          @click="tabIndex = i"
        >
          <text>{{ tab.text }}</text>
        </view>
        <view class="sort-btn" @click="sortAsc = !sortAsc">
          <uni-icons :type="sortAsc ? 'up' : 'down'" size="14" :color="sortAsc ? '#14665b' : '#5a726d'" />
        </view>
      </view>

      <view v-if="loading && !games.length" class="state">加载中…</view>
      <view v-else-if="!filtered.length" class="state">
        {{ keyword ? '没有匹配的球局' : '暂无球局，去发布一个吧' }}
      </view>

      <!-- 精选大卡 -->
      <view v-if="featured" :class="['gcard', 'card-' + featured.id]">
        <view class="pic" hover-class="pic-hv" hover-stay-time="120" @click="toggleExpand(featured.id)">
          <!-- 列表封面用后端生成的 _thumb.jpg，不预加载原图；历史图片没有缩略图时 404 回退原图 -->
          <image
            v-if="featured.cover"
            class="pic-cover"
            :src="coverSrc(featured)"
            mode="aspectFill"
            @error="onCoverError(featured)"
          />
          <view class="pic-mask" />
          <view class="timechip">
            <uni-icons type="calendar" size="13" color="#F0C98F" />
            <text>{{ timeText(featured) }}</text>
          </view>
        </view>
        <view class="bd">
          <view class="hd">
            <text class="ttl">{{ featured.title }}</text>
            <text :class="['badge', statusClass(featured.status)]">{{ statusText(featured.status) }}</text>
            <text v-if="isHot(featured)" class="hot">
              <uni-icons type="fire" size="12" color="#B96A14" />热门
            </text>
          </view>
          <view class="sub">
            <uni-icons type="location" size="13" color="#9AA39C" />
            <text>{{ featured.location || '地点待定' }}</text>
            <text class="gap" />
            <uni-icons type="person" size="13" color="#9AA39C" />
            <text>{{ featured.maxPlayers }} 人场</text>
          </view>
          <view v-if="featured.remark && featured.remark.trim()" class="remark-line featured-remark">{{ featured.remark }}</view>
          <view class="people">
            <view class="avatars">
              <view
                v-for="(a, i) in avatarList(featured)"
                :key="a.userId || i"
                class="av"
                :style="{ background: a.bgColor || colorOf(a.userId) }"
              >
                <SmartImage v-if="a.imageUrl" class="av-img" :src="a.imageUrl" mode="aspectFill" />
                <text v-else-if="a.emoji">{{ a.emoji }}</text>
                <text v-else>{{ a.char }}</text>
              </view>
              <view v-if="featured.registeredCount > 4" class="av more">
                +{{ featured.registeredCount - 4 }}
              </view>
            </view>
            <text class="cap">
              <text class="now">{{ featured.registeredCount }}</text>/{{ featured.maxPlayers }} 人已报名
            </text>
            <text v-if="genderOf(featured).total" class="cap gender">
              男 {{ genderOf(featured).male }} · 女 {{ genderOf(featured).female }}
            </text>
          </view>
          <view class="bar">
            <view class="bar-in" :style="{ width: percentOf(featured) + '%' }" />
          </view>
          <view class="foot">
            <text class="org">组织者 · {{ creatorName(featured) }}</text>
            <view class="fbtns">
              <view
                :class="['btn', 'ghost', 'chv', { open: isExpanded(featured.id) }]"
                hover-class="btn-hv"
                hover-stay-time="120"
                @click.stop="toggleExpand(featured.id)"
              >
                <text>{{ isExpanded(featured.id) ? '收起' : '展开' }}</text>
                <uni-icons :class="['arw', { up: isExpanded(featured.id) }]" type="down" size="13" color="#7C837D" />
              </view>
              <view
                :class="['btn', 'amber', { joined: isJoined(featured), disabled: !isJoined(featured) && isFull(featured) && featured.status === 0 }]"
                hover-class="btn-hv"
                hover-stay-time="120"
                @click.stop="onJoin(featured)"
              >
                {{ joiningId === featured.id ? '提交中…' : actionText(featured) }}
              </view>
            </view>
          </view>
          <view v-if="isExpanded(featured.id)" class="mv">
            <view class="mv-row">
              <uni-icons type="calendar" size="14" color="#0F3B2E" />
              <text v-if="featured.mode === 1">{{ timeText(featured) }}</text>
              <text v-else>{{ shortDate(featured.playDate) }} {{ weekdayText(featured.playDate) }} {{ shortTime(featured.startTime) }}-{{ shortTime(featured.endTime) }}</text>
            </view>
            <view class="mv-row">
              <uni-icons type="location" size="14" color="#0F3B2E" />
              <text>{{ featured.location || '地点待定' }}</text>
            </view>
            <view class="mv-row">
              <uni-icons type="person" size="14" color="#0F3B2E" />
              <text>{{ featured.registeredCount }} / {{ featured.maxPlayers }} 人 · 满员即止</text>
            </view>
            <view class="mv-row">
              <uni-icons type="info" size="14" color="#0F3B2E" />
              <text>请提前 15 分钟到场热身 · 迟到 10 分钟视为弃权</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 紧凑卡片 -->
      <view
        v-for="game in rest"
        :key="game.id"
        :class="['ccard', 'card-' + game.id]"
      >
        <view class="date">
          <template v-if="game.mode === 1">
            <template v-if="game.playDate">
              <text class="d">{{ dayOf(game.playDate) }}</text>
              <text class="w">{{ relativeDateLabel(game.playDate) }}</text>
            </template>
            <template v-else>
              <text class="d">现</text>
              <text class="w">现场局</text>
            </template>
          </template>
          <template v-else>
            <text class="d">{{ dayOf(game.playDate) }}</text>
            <text class="w">{{ weekdayText(game.playDate) }}</text>
          </template>
        </view>
        <view class="mid" hover-class="mid-hv" hover-stay-time="120" @click.stop="toggleExpand(game.id)">
          <view class="ttl2">
            <text class="t">{{ game.title }}</text>
            <text :class="['badge', statusClass(game.status)]">{{ statusText(game.status) }}</text>
          </view>
          <view class="meta">
            <uni-icons type="location" size="12" color="#9AA39C" />
            <text>{{ game.location || '地点待定' }}</text>
            <uni-icons type="person" size="12" color="#9AA39C" />
            <text class="now">{{ game.registeredCount }}</text>/{{ game.maxPlayers }} 人
          </view>
          <view v-if="game.remark && game.remark.trim()" class="remark-line">{{ game.remark }}</view>
        </view>
        <view
          :class="['btn', 'sm', game.status === 0 ? (isJoined(game) ? 'amber joined' : (isFull(game) ? 'amber disabled' : 'amber')) : 'outline']"
          hover-class="btn-hv"
          hover-stay-time="120"
          @click.stop="onJoin(game)"
        >
          {{ joiningId === game.id ? '提交中…' : actionText(game) }}
        </view>
        <view v-if="isExpanded(game.id)" class="mv">
          <view class="mv-row">
            <uni-icons type="calendar" size="14" color="#0F3B2E" />
            <text v-if="game.mode === 1">{{ game.playDate ? `${relativeDateLabel(game.playDate)} · ${game.maxPlayers} 人场` : `时间待定 · ${game.maxPlayers} 人场` }}</text>
            <text v-else>{{ shortDate(game.playDate) }} {{ shortTime(game.startTime) }}-{{ shortTime(game.endTime) }} · {{ game.maxPlayers }} 人场</text>
          </view>
          <view class="mv-row">
            <uni-icons type="location" size="14" color="#0F3B2E" />
            <text>{{ game.location || '地点待定' }}</text>
          </view>
        </view>
      </view>

      <view class="tail" />
    </view>
  </view>
</template>

<style scoped>
.page {
  --world: #0f3b2e;
  --world-2: #1c5c43;
  --world-3: #e2ece5;
  --key: #f08a22;
  --ink: #22312a;
  --dim: #7c837d;
  --line: rgba(34, 49, 42, 0.09);
  --surface: #fffdf8;
  min-height: 100vh;
  background: #f5f0e5;
  padding-bottom: calc(40px + env(safe-area-inset-bottom));
}

/* 顶栏 */
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--world);
  padding: 0 22px 14px;
  display: flex;
  align-items: center;
}
.pt {
  font-family: "Songti SC", "Noto Serif SC", serif;
  font-size: 20px;
  font-weight: 700;
  color: #f3f0e4;
  letter-spacing: 1px;
  line-height: 34px;
}
.tb-r {
  margin-left: auto;
  margin-right: 0px;
  display: flex;
  flex-direction: row;
  gap: 8px;
}
.tb-btn {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.13);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--key);
}

/* 内容流 */
.flow {
  display: block;
}

/* 场馆头图 */
.head {
  position: relative;
  height: 150px;
  overflow: hidden;
  background: linear-gradient(165deg, #123f31, var(--world) 55%, #0c3125);
}
.deco {
  position: absolute;
  border-radius: 50%;
}
.deco-1 {
  width: 160px;
  height: 160px;
  top: -50px;
  right: -30px;
  background: rgba(240, 138, 34, 0.18);
}
.deco-2 {
  width: 200px;
  height: 200px;
  left: -80px;
  bottom: -110px;
  background: rgba(226, 236, 229, 0.14);
}
.head-tip {
  position: absolute;
  left: 22px;
  bottom: 62px;
  font-family: "Songti SC", "Noto Serif SC", serif;
  font-size: 13px;
  color: rgba(243, 240, 228, 0.72);
  letter-spacing: 2px;
}

/* 身份卡 */
.idcard {
  position: relative;
  z-index: 3;
  margin: -46px 20px 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 15px 16px 14px;
  box-shadow: 0 12px 30px -14px rgba(15, 59, 46, 0.32);
}
.id-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.avatar {
  flex: 0 0 auto;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
}
.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.avatar.lg {
  width: 50px;
  height: 50px;
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 2px #c3d5c9;
}
.avatar.guest {
  background: #eceae3;
}
.id-mid {
  flex: 1;
  min-width: 0;
}
.name {
  font-size: 16.5px;
  font-weight: 800;
  color: var(--ink);
}
.name .brand {
  font-size: 12px;
  font-weight: 600;
  color: var(--world);
  margin-left: 5px;
  letter-spacing: 2px;
}
.tag {
  font-size: 12px;
  color: var(--dim);
  margin-top: 3px;
}
.elo {
  flex: 0 0 auto;
  background: var(--world-3);
  border-radius: 13px;
  padding: 7px 13px;
  text-align: center;
  display: flex;
  flex-direction: column;
}
.elo .l {
  font-size: 10px;
  font-weight: 700;
  color: #5f7b6c;
}
.elo .n {
  font-size: 19px;
  font-weight: 800;
  color: var(--world);
  line-height: 1.15;
}
.elo .up {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--world);
}

/* 诗句 */
.poem {
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin: 15px 26px 0;
}
.qm {
  font-family: "Songti SC", "Noto Serif SC", serif;
  font-size: 28px;
  line-height: 1.1;
  color: var(--key);
  font-weight: 700;
}
.p-body {
  flex: 1;
}
.p-line {
  display: block;
  font-family: "Songti SC", "Noto Serif SC", serif;
  font-style: italic;
  font-size: 15px;
  line-height: 1.9;
  color: var(--ink);
  letter-spacing: 2px;
}
.src {
  display: block;
  margin-top: 4px;
  font-family: "Songti SC", "Noto Serif SC", serif;
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: 1px;
}

/* 搜索 */
.search-row {
  padding: 14px 20px 0;
}
.search-box {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}
.search-input {
  flex: 1;
  font-size: 13.5px;
  color: var(--ink);
}
.ph {
  color: #a6aca6;
}
.search-clear {
  font-size: 13px;
  color: var(--dim);
  padding: 0 4px;
}

/* 分类 */
.tabs {
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding: 16px 20px 13px;
  align-items: center;
}
.sort-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 7.5px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 13.5px;
  font-weight: 600;
  color: #5e675f;
}
.tab.on {
  background: var(--world);
  border-color: var(--world);
  color: #f1f6f2;
}
.cnt {
  font-size: 11px;
  opacity: 0.55;
}

.state {
  margin-top: 60px;
  text-align: center;
  font-size: 13px;
  color: var(--dim);
}

/* 精选大卡 */
.gcard {
  margin: 0 20px 13px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 4px 16px -10px rgba(15, 59, 46, 0.14);
}
.pic {
  position: relative;
  height: 132px;
  background: linear-gradient(160deg, var(--world-2), var(--world));
}
.pic-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
.pic-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 60%;
  background: linear-gradient(180deg, rgba(11, 34, 26, 0), rgba(11, 34, 26, 0.58));
}
.timechip {
  position: absolute;
  left: 12px;
  bottom: 11px;
  z-index: 2;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  background: rgba(15, 40, 31, 0.78);
  color: #f2efe3;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
}
.bd {
  padding: 13px 15px 14px;
}
.hd {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.ttl {
  font-size: 16.5px;
  font-weight: 800;
  color: var(--ink);
}
.badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3.5px 9px;
  border-radius: 999px;
}
.badge.open {
  background: var(--world-3);
  color: #1f6b4c;
}
.badge.arr {
  background: #fbe8d2;
  color: #96651f;
}
.badge.done {
  background: #eceae3;
  color: #8a867c;
}
.hot {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 700;
  color: #b96a14;
}
.sub {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--dim);
}
.gap {
  width: 1px;
  height: 11px;
  background: var(--line);
  margin: 0 3px;
}
.people {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  margin-top: 12px;
}
.avatars {
  display: flex;
  flex-direction: row;
}
.av {
  width: 27px;
  height: 27px;
  border-radius: 50%;
  border: 2px solid var(--surface);
  margin-left: -8px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.av-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.av:first-child {
  margin-left: 0;
}
.av.more {
  background: #eceae3;
  color: #8a867c;
}
.cap {
  font-size: 12.5px;
  color: var(--dim);
}
.cap .now {
  color: var(--world);
  font-weight: 800;
}
.cap.gender {
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef4f1;
  color: #14665b;
  font-weight: 600;
}
.bar {
  height: 4px;
  border-radius: 2px;
  background: #ece7da;
  margin-top: 9px;
  overflow: hidden;
}
.bar-in {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--world-2), var(--world));
}
.foot {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 13px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.org {
  font-size: 12px;
  color: var(--dim);
}
.fbtns {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

/* 按钮 */
.btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 700;
  padding: 9px 17px;
}
.btn.amber {
  background: var(--key);
  color: #0f3b2e;
}
.btn.amber.joined {
  background: var(--world-3);
  color: #1f6b4c;
}
.btn.amber.disabled {
  background: #e3e8e6;
  color: #9aa39c;
}
.btn.outline {
  border: 1px solid var(--world);
  color: var(--world);
}
.btn.ghost {
  color: var(--dim);
}
.btn.sm {
  padding: 8px 13px;
  font-size: 12.5px;
}

/* 展开详情 */
.mv {
  border-top: 1px solid var(--line);
  padding: 12px 15px 14px;
  animation: mv-in 0.22s ease both;
}
@keyframes mv-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 按下反馈：微信小程序的 view 没有 :active，
   不写 hover-class 点上去界面完全不变，会被当成「点了没反应」 */
.pic-hv {
  opacity: 0.92;
}
.btn-hv {
  opacity: 0.78;
}
.mid-hv {
  background: #f2ece1;
  border-radius: 10px;
}
.arw {
  transition: transform 0.2s;
}
.arw.up {
  transform: rotate(180deg);
}
.mv-row {
  display: flex;
  flex-direction: row;
  gap: 9px;
  align-items: flex-start;
  font-size: 12.5px;
  color: #55605a;
  line-height: 1.6;
  margin-bottom: 9px;
}

/* 紧凑卡 */
.ccard {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 13px;
  margin: 0 20px 13px;
  padding: 13px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 4px 16px -10px rgba(15, 59, 46, 0.14);
}
.date {
  flex: 0 0 auto;
  width: 54px;
  height: 54px;
  border-radius: 14px;
  background: var(--world-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--world);
}
.date .d {
  font-size: 19px;
  font-weight: 800;
  line-height: 1.05;
}
.date .w {
  font-size: 10px;
  font-weight: 700;
  margin-top: 2px;
  opacity: 0.75;
}
.mid {
  flex: 1;
  min-width: 0;
}
.ttl2 {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
}
.ttl2 .t {
  font-size: 15px;
  font-weight: 800;
  color: var(--ink);
}
.meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  font-size: 12px;
  color: var(--dim);
}
.meta .now {
  color: var(--world);
  font-weight: 800;
}
.remark-line {
  margin-top: 6px;
  padding: 5px 8px;
  background: #f3f7f4;
  border-left: 3px solid #2d7a66;
  border-radius: 0 4px 4px 0;
  font-size: 11px;
  color: #4a5a53;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 44px;
  overflow: hidden;
}
.featured-remark {
  background: rgba(255,255,255,.85);
  color: #1a2e2a;
  font-size: 12px;
  max-height: 48px;
  margin-top: 8px;
}
.ccard .mv {
  flex-basis: 100%;
  padding: 12px 0 0;
  border-top: 1px solid var(--line);
}

.tail {
  height: 18px;
}
</style>
