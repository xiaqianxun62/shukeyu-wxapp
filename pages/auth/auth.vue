<script setup>
import { onMounted } from 'vue'
import { ref } from 'vue'
import { toastError } from '../../common/util'
import { fetchCaptcha, checkNameAvailable } from '../../common/api/auth'
import { useAuth } from '../../common/store/auth'
// 本页有同名的 tab 切换函数 switchTab，页面跳转的重命名为 switchTabPage
import { backOrHome, switchTab as switchTabPage } from '../../common/nav'
import NavBack from '../../components/nav-back/nav-back.vue'

const { submitting, login, register, loginWithWechat } = useAuth()

const tab = ref('login')

const form = ref({
  account: '',
  password: '',
  name: '',
  nickname: '',
  gender: 1,
})
const agree = ref(true)

// 图形验证码
const captchaLoading = ref(false)
const captchaUuid = ref('')
const captchaImage = ref('')
const captchaInput = ref('')

async function loadCaptcha() {
  captchaLoading.value = true
  try {
    const res = await fetchCaptcha()
    captchaUuid.value = res.uuid
    captchaImage.value = res.image
    captchaInput.value = ''
  } catch (e) {
    toastError(e, '验证码加载失败')
  } finally {
    captchaLoading.value = false
  }
}

// 昵称查重状态：null=还没查 / true=可用 / false=已占用
const nameAvailable = ref(null)
let nameCheckTimer = null

/** 注册 tab 昵称查重：输入停 600ms 后自动查 */
function onNameInput() {
  nameAvailable.value = null
  if (nameCheckTimer) clearTimeout(nameCheckTimer)
  const v = (form.value.name || '').trim()
  if (!v) return
  nameCheckTimer = setTimeout(async () => {
    try {
      const res = await checkNameAvailable(v)
      nameAvailable.value = res.available
    } catch {
      nameAvailable.value = null
    }
  }, 600)
}

function switchTab(next) {
  tab.value = next
  loadCaptcha() // 登录 / 注册都需要
}

function pickGender(value) {
  form.value.gender = value
}

async function wechatLogin() {
  if (!agree.value) {
    uni.showToast({ title: '请先勾选同意用户协议', icon: 'none' })
    return
  }
  try {
    const res = await loginWithWechat()
    uni.showToast({
      title: res.newUser ? '已创建账号，去完善资料' : '登录成功',
      icon: 'success',
    })
    setTimeout(() => {
      if (res.newUser) {
        switchTabPage('/pages/mine/mine')
      } else {
        backOrHome('/pages/mine/mine')
      }
    }, 600)
  } catch (e) {
    toastError(e, '微信登录失败')
  }
}

async function submit() {
  if (!agree.value) {
    uni.showToast({ title: '请先勾选同意用户协议', icon: 'none' })
    return
  }
  if (!form.value.account || !form.value.password) {
    uni.showToast({ title: '请填写账号与密码', icon: 'none' })
    return
  }
  if (tab.value === 'register' && !form.value.name) {
    uni.showToast({ title: '请填写姓名', icon: 'none' })
    return
  }
  if (tab.value === 'register' && !form.value.nickname.trim()) {
    uni.showToast({ title: '请填写昵称', icon: 'none' })
    return
  }
  try {
    if (!captchaInput.value.trim()) {
      uni.showToast({ title: '请填写图形验证码', icon: 'none' })
      return
    }
    if (tab.value === 'login') {
      await login({
        account: form.value.account,
        password: form.value.password,
        captchaUuid: captchaUuid.value,
        captchaCode: captchaInput.value.trim(),
      })
    } else {
      await register({
        account: form.value.account,
        name: form.value.name,
        nickname: form.value.nickname.trim(),
        gender: Number(form.value.gender),
        password: form.value.password,
        captchaUuid: captchaUuid.value,
        captchaCode: captchaInput.value.trim(),
      })
    }
    uni.showToast({ title: tab.value === 'login' ? '登录成功' : '注册成功', icon: 'success' })
    setTimeout(() => {
      backOrHome('/pages/mine/mine')
    }, 600)
  } catch (e) {
    toastError(e, tab.value === 'login' ? '登录失败' : '注册失败')
    await loadCaptcha() // 失败强制换一张
  }
}

onMounted(() => {
  loadCaptcha()
})
</script>

<template>
  <view class="page">
    <NavBack />

    <view class="head">
      <view class="head-title">数科羽 ShuKeYu</view>
      <view class="head-sub">注册账号后，即可发布与报名球局</view>
    </view>

    <view class="tabs">
      <view :class="['tab', { active: tab === 'login' }]" @click="switchTab('login')">登录</view>
      <view :class="['tab', { active: tab === 'register' }]" @click="switchTab('register')">注册</view>
    </view>

    <view class="form">
      <view class="field">
        <text class="label">账号</text>
        <uni-easyinput v-model="form.account" placeholder="请输入账号" />
      </view>
      <view class="field">
        <text class="label">密码</text>
        <uni-easyinput type="password" v-model="form.password" placeholder="请输入密码" />
      </view>

      <template v-if="tab === 'register'">
        <view class="field">
          <view class="label-row">
            <text class="label">昵称</text>
            <text class="label-tip">上网冲浪用昵称</text>
          </view>
          <uni-easyinput v-model="form.nickname" placeholder="请输入昵称" :maxlength="20" />
        </view>
        <view class="field">
          <view class="label-row">
            <text class="label">姓名</text>
            <text class="label-tip">对局内用姓名方便统计</text>
          </view>
          <uni-easyinput v-model="form.name" placeholder="请输入姓名" :maxlength="20" @input="onNameInput" />
          <view v-if="nameAvailable === false" class="field-hint bad">
            ⚠️ 这个姓名已经被占用啦，请换一个
          </view>
          <view v-else-if="nameAvailable === true" class="field-hint good">
            ✓ 姓名可用
          </view>
        </view>
        <view class="field">
          <text class="label">性别</text>
          <view class="gender">
            <view :class="['gender-item', { active: form.gender === 1 }]" @click="pickGender(1)">男</view>
            <view :class="['gender-item', { active: form.gender === 2 }]" @click="pickGender(2)">女</view>
          </view>
        </view>
      </template>

      <view class="field">
        <text class="label">图形验证码</text>
        <view class="captcha-row">
          <uni-easyinput v-model="captchaInput" placeholder="不区分大小写" :maxlength="6" />
          <view
            class="captcha-img"
            :class="{ loading: captchaLoading, empty: !captchaImage }"
            @click="loadCaptcha"
          >
            <image
              v-if="captchaImage"
              :src="captchaImage"
              mode="aspectFit"
              class="captcha-pic"
            />
            <view v-else class="captcha-spinner" />
          </view>
        </view>
      </view>

      <view class="agree">
        <switch :checked="agree" color="#14665B" @change="agree = $event.detail.value" />
        <text class="agree-text">我已阅读并同意《用户协议》与《隐私政策》</text>
      </view>

      <button class="submit" type="button" :loading="submitting" @click="submit">
        {{ tab === 'login' ? '登录' : '注册并开始' }}
      </button>

      <!-- #ifndef H5 -->
      <view class="divider">
        <view class="line"></view>
        <text class="divider-text">或</text>
        <view class="line"></view>
      </view>
      <button class="wx-btn" type="button" :loading="submitting" @click="wechatLogin">
        微信一键登录
      </button>
      <view class="wx-tip">使用微信账号快速进入</view>
      <!-- #endif -->
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding-bottom: 40px;
}
.head {
  padding: 28px 20px 22px;
  background: #14665b;
  color: #faf7f0;
}
.head-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 1px;
}
.head-sub {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.9;
}
.tabs {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
}
.tab {
  padding: 6px 18px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #ffffff;
  color: #5a726d;
  font-size: 13px;
  font-weight: 600;
}
.tab.active {
  background: #14665b;
  border-color: #14665b;
  color: #faf7f0;
}
.form {
  padding: 0 20px;
}
.field {
  margin-bottom: 14px;
}
.label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #1a2e2a;
}
/* 标签右侧的用途提示，例如「上网冲浪用昵称」 */
.label-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 6px;
}
.label-row .label {
  margin-bottom: 0;
}
.label-tip {
  font-size: 11px;
  color: #5a726d;
}

/* 图形验证码 */
.captcha-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.captcha-row .uni-easyinput {
  flex: 1;
}
.captcha-row .uni-easyinput input {
  letter-spacing: 2px;
}
.captcha-img {
  flex: 0 0 120px;
  height: 38px;
  background: #ffffff;
  border: 1px solid #e3e8e6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.captcha-img.loading {
  opacity: 0.7;
}
.captcha-img.empty {
  background: #f5f3ee;
}
.captcha-pic {
  width: 100%;
  height: 100%;
}
.captcha-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #e3e8e6;
  border-top-color: #14665b;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.gender {
  display: flex;
  gap: 10px;
}
.gender-item {
  flex: 1;
  height: 38px;
  line-height: 38px;
  text-align: center;
  border: 1px solid #e3e8e6;
  border-radius: 8px;
  background: #ffffff;
  color: #5a726d;
  font-size: 14px;
}
.gender-item.active {
  border-color: #14665b;
  background: #e0f1ec;
  color: #14665b;
  font-weight: 700;
}
.agree {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 18px;
}
.agree-text {
  font-size: 11px;
  color: #5a726d;
}
.submit {
  height: 44px;
  line-height: 44px;
  border: none;
  border-radius: 10px;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 15px;
  font-weight: 700;
}
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0;
}
.divider .line {
  flex: 1;
  height: 1px;
  background: #e3e8e6;
}
.divider-text {
  font-size: 11px;
  color: #5a726d;
}
.wx-btn {
  height: 44px;
  line-height: 44px;
  border: none;
  border-radius: 10px;
  background: #14665b;
  color: #faf7f0;
  font-size: 15px;
  font-weight: 700;
}
.wx-tip {
  margin-top: 8px;
  text-align: center;
  font-size: 11px;
  color: #5a726d;
}
.field-hint {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
}
.field-hint.bad {
  color: #c0392b;
}
.field-hint.good {
  color: #14665b;
}
</style>
