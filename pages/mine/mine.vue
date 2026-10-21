<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { genderText, resolveUrl, toastError } from '../../common/util'
import SmartImage from '../../components/SmartImage/SmartImage.vue'
import { useAuth } from '../../common/store/auth'
import { navigateTo } from '../../common/nav'
import { ENVIRONMENTS, getEnvId, setEnvId, getCustomUrl, setCustomUrl, getCurrentEnv } from '../../common/config'
import { updateProfile } from '../../common/api/auth'

const { user, isLoggedIn, logout, restore, refreshMe, applyProfile } = useAuth()

/** 积分榜展示名：0 真实姓名 1 昵称（默认）。只影响自己在榜单上的那一行 */
const nameDisplay = computed(() => (user.value && user.value.nameDisplay === 0 ? 0 : 1))
const savingDisplay = ref(false)

async function setNameDisplay(value) {
  if (!isLoggedIn.value || savingDisplay.value || value === nameDisplay.value) return
  savingDisplay.value = true
  try {
    // 后端 profile 接口的性别是必填项，这里带上原值只改展示名偏好
    const updated = await updateProfile({
      gender: Number(user.value.gender) || 1,
      nameDisplay: value,
    })
    applyProfile(updated)
    uni.showToast({
      title: value === 1 ? '积分榜显示昵称' : '积分榜显示真实姓名',
      icon: 'none',
    })
  } catch (e) {
    toastError(e, '设置失败')
  } finally {
    savingDisplay.value = false
  }
}

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
const navbarHeight = statusBarHeight + 44
/** 仅管理员显示环境切换入口 */
const isAdmin = computed(() => !!(user.value && user.value.isAdmin === true))
const currentEnv = ref(getCurrentEnv())
const envPickerVisible = ref(false)
const customUrlInput = ref(getCustomUrl())

onShow(() => {
  restore()
  // 每次回到本页都同步一次库里的最新资料（头像可能在别的端/本页被更新）
  refreshMe()
  currentEnv.value = getCurrentEnv()
})

async function handleLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    success: async (res) => {
      if (!res.confirm) return
      await logout()
      uni.showToast({ title: '已退出', icon: 'success' })
    },
  })
}

function goLogin() { navigateTo('/pages/auth/auth') }
function goProfile() { navigateTo('/pages/profile/profile') }
function goElo() { navigateTo('/pages/elo/elo') }
function goRotation() { navigateTo('/pages/rotation/rotation') }
function goHistory() { navigateTo('/pages/history/history') }
function goFootwork() { navigateTo('/pages/footwork/footwork') }
function goVerify() { navigateTo('/pages/verify/verify') }
function goTournaments() { navigateTo('/pages/tournament-list/tournament-list') }

function openEnvPicker() {
  customUrlInput.value = getCustomUrl()
  envPickerVisible.value = true
}
function closeEnvPicker() { envPickerVisible.value = false }
function selectEnv(envId) {
  setEnvId(envId)
  currentEnv.value = getCurrentEnv()
  envPickerVisible.value = false
  uni.showToast({ title: `已切换到${currentEnv.value.label}`, icon: 'none' })
}
function saveCustomUrl() {
  const url = customUrlInput.value.trim()
  if (!url) { uni.showToast({ title: '请输入地址', icon: 'none' }); return }
  setCustomUrl(url); setEnvId('custom'); currentEnv.value = getCurrentEnv()
  envPickerVisible.value = false
  uni.showToast({ title: '已切换到自定义环境', icon: 'none' })
}
</script>

<template>
  <view class="page">
    <view class="navbar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-title">我的</view>
    </view>

    <view v-if="isLoggedIn && user" class="profile">
      <view v-if="user.avatar" class="avatar">
        <SmartImage class="avatar-img" :src="user.avatar" mode="aspectFill" />
      </view>
      <view v-else class="avatar">{{ user.name.charAt(0) }}</view>
      <view class="name">{{ user.name }}</view>
      <view class="meta">{{ genderText(user.gender) }}</view>
      <view v-if="user.account" class="meta">账号 {{ user.account }}</view>

      <view class="stats">
        <view class="stat">
          <text class="stat-value">{{ user.rating }}</text>
          <text class="stat-label">ELO 积分</text>
        </view>
        <view class="stat" @click="goHistory">
          <text class="stat-value">{{ user.gamesPlayed }}</text>
          <text class="stat-label">历史场次 ›</text>
        </view>
      </view>

      <!-- 分类 ELO 明细：单打 / 双打(同性别) / 混双 -->
      <view class="cat-stats">
        <view class="cat-row">
          <text class="cat-name">单打</text>
          <text class="cat-rating">{{ user.ratingSingles ?? user.rating ?? 1200 }}</text>
          <text class="cat-record">{{ user.singlesWin ?? 0 }}胜 {{ user.singlesLoss ?? 0 }}负</text>
        </view>
        <view class="cat-row">
          <text class="cat-name">双打</text>
          <text class="cat-rating">{{ user.ratingDoubles ?? user.rating ?? 1200 }}</text>
          <text class="cat-record">{{ user.doublesWin ?? 0 }}胜 {{ user.doublesLoss ?? 0 }}负</text>
        </view>
        <view class="cat-row">
          <text class="cat-name">混双</text>
          <text class="cat-rating">{{ user.ratingMixed ?? user.rating ?? 1200 }}</text>
          <text class="cat-record">{{ user.mixedWin ?? 0 }}胜 {{ user.mixedLoss ?? 0 }}负</text>
        </view>
      </view>
    </view>

    <view v-else class="guest">
      <view class="guest-title">还没有登录</view>
      <view class="guest-desc">注册后即可发布球局、报名、查看 ELO 积分榜</view>
      <button class="primary-btn" type="button" @click="goLogin">登录 / 注册</button>
    </view>

    <view class="menu">
      <view v-if="isLoggedIn" class="item" @click="goProfile">
        <uni-icons type="person" size="16" color="#14665B" />
        <text class="item-text">编辑个人信息</text>
        <text class="arrow">›</text>
      </view>
      <view v-if="isLoggedIn" class="item">
        <uni-icons type="star" size="16" color="#14665B" />
        <text class="item-text">积分榜显示</text>
        <view class="seg">
          <view :class="['seg-item', { active: nameDisplay === 1 }]" @click="setNameDisplay(1)">昵称</view>
          <view :class="['seg-item', { active: nameDisplay === 0 }]" @click="setNameDisplay(0)">姓名</view>
        </view>
      </view>
      <!--<view v-if="isLoggedIn" class="item-hint">只决定你自己在积分榜上显示什么，其他人不受影响</view>-->
      <view class="item" @click="goRotation">
        <uni-icons type="refresh" size="16" color="#14665B" />
        <text class="item-text">轮排安排</text>
        <text class="arrow">›</text>
      </view>
      <view class="item" @click="goTournaments">
        <uni-icons type="medal" size="16" color="#14665B" />
        <text class="item-text">大型比赛</text>
        <text class="item-hint-inline">随机抽签</text>
        <text class="arrow">›</text>
      </view>
      <view class="item" @click="goElo">
        <uni-icons type="compose" size="16" color="#14665B" />
        <text class="item-text">ELO 试算实验室</text>
        <text class="arrow">›</text>
      </view>
      <view class="item" @click="goFootwork">
        <uni-icons type="paperplane" size="16" color="#14665B" />
        <text class="item-text">步伐训练</text>
        <text class="arrow">›</text>
      </view>
      <view class="item" @click="goVerify">
        <uni-icons type="locked" size="16" color="#14665B" />
        <text class="item-text">SHUKE认证</text>
        <text v-if="user?.isVerified" class="tag verified">已认证</text>
        <text v-else class="tag unverified">未认证</text>
        <text class="arrow">›</text>
      </view>

      <view v-if="isAdmin" class="item" @click="openEnvPicker">
        <uni-icons type="gear" size="16" color="#14665B" />
        <text class="item-text">环境切换</text>
        <text class="env-tag">{{ currentEnv.label }}</text>
        <text class="arrow">›</text>
      </view>
      <view v-if="isLoggedIn" class="item danger" @click="handleLogout">
        <uni-icons type="close" size="16" color="#aa0000" />
        <text class="item-text">退出登录</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="foot">by 2026@千巽</view>

    <!-- 环境切换弹层（仅管理员可从入口打开，这里再兜一层） -->
    <view v-if="envPickerVisible && isAdmin" class="mask" @click="closeEnvPicker">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">切换环境</text>
          <text class="picker-close" @click="closeEnvPicker">✕</text>
        </view>
        <view
          v-for="env in ENVIRONMENTS"
          :key="env.id"
          :class="['env-option', { active: getEnvId() === env.id }]"
          @click="selectEnv(env.id)"
        >
          <text class="env-label">{{ env.label }}</text>
          <text class="env-url">{{ env.url }}</text>
        </view>
        <view
          :class="['env-option', { active: getEnvId() === 'custom' }]"
          @click="selectEnv('custom')"
        >
          <text class="env-label">自定义</text>
          <text class="env-url">{{ getCustomUrl() || '未设置' }}</text>
        </view>
        <view class="custom-row">
          <input class="custom-input" v-model="customUrlInput" placeholder="http://IP:端口/api" confirm-type="done" @confirm="saveCustomUrl" />
          <button class="custom-btn" @click="saveCustomUrl">保存</button>
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
.profile,
.guest {
  padding: 24px 16px 26px;
  text-align: center;
  background: #0c3125;
  color: #faf7f0;
}
.avatar {
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 26px;
  font-weight: 800;
  overflow: hidden;
}
.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.name {
  font-size: 18px;
  font-weight: 800;
}
.meta {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.9;
}
.stats {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
/* 分类 ELO 明细：单打 / 双打 / 混双（深色头部底色） */
.cat-stats {
  margin-top: 10px;
  border: 1px solid rgba(250, 247, 240, 0.35);
  border-radius: 12px;
  overflow: hidden;
}
.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  font-size: 13px;
}
.cat-row + .cat-row {
  border-top: 1px solid rgba(250, 247, 240, 0.18);
}
.cat-name {
  width: 40px;
  color: rgba(250, 247, 240, 0.75);
}
.cat-rating {
  color: #e5c84b;
  font-weight: 800;
}
.cat-record {
  margin-left: auto;
  font-size: 11px;
  color: rgba(250, 247, 240, 0.75);
}
.stat {
  flex: 1;
  padding: 12px 8px;
  border: 1px solid rgba(250, 247, 240, 0.35);
  border-radius: 12px;
}
.stat-value {
  display: block;
  font-size: 20px;
  font-weight: 800;
  color: #e5c84b;
}
.stat-label {
  font-size: 11px;
  opacity: 0.85;
}
.guest-title {
  font-size: 18px;
  font-weight: 800;
}
.guest-desc {
  margin: 8px 0 18px;
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.9;
}
.primary-btn {
  height: 42px;
  line-height: 42px;
  border: none;
  border-radius: 10px;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 15px;
  font-weight: 700;
}
.menu {
  margin: 14px 16px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px;
  border-bottom: 1px solid #f0efea;
}
.item.danger .item-text {
  color: #aa0000;
}
.item-text {
  flex: 1;
  font-size: 14px;
  color: #1a2e2a;
}
.arrow {
  font-size: 16px;
  color: #5a726d;
  margin-left: auto;
}
/* 积分榜展示名：昵称 / 姓名 二选一 */
.seg {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.seg-item {
  padding: 4px 12px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #ffffff;
  color: #5a726d;
  font-size: 12px;
  font-weight: 600;
}
.seg-item.active {
  border-color: #14665b;
  background: #e0f1ec;
  color: #14665b;
}
.item-hint {
  padding: 8px 14px 12px;
  font-size: 11px;
  color: #5a726d;
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  margin-left: auto;
  margin-right: 8px;
}
.tag.verified {
  background: #e8f4e0;
  color: #27ae60;
}
.tag.unverified {
  background: #fdecea;
  color: #b33a2e;
}
.foot {
  margin-top: 20px;
  text-align: center;
  font-size: 11px;
  color: #5a726d;
}
.env-tag,
.item-hint-inline {
  padding: 1px 8px;
  border-radius: 999px;
  background: #e0f1ec;
  color: #14665b;
  font-size: 10px;
  font-weight: 700;
}
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
.env-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  margin-bottom: 8px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
  background: #faf7f0;
}
.env-option.active {
  border-color: #14665b;
  background: #e0f1ec;
}
.env-label {
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.env-url {
  font-size: 11px;
  color: #5a726d;
  word-break: break-all;
}
.custom-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.custom-input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
  background: #faf7f0;
  font-size: 13px;
}
.custom-btn {
  height: 40px;
  line-height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: #14665b;
  color: #faf7f0;
  font-size: 13px;
  font-weight: 700;
}
</style>
