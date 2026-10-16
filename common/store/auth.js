import { computed, ref } from 'vue'
import * as authApi from '../api/auth'
import { clearToken, getToken, setToken } from '../api/request'
import { randomUid } from '../util'

/**
 * 全局登录状态。
 * 模块级 ref 单例：任何页面调用 useAuth() 拿到的都是同一份状态。
 */

const USER_KEY = 'shukeyu_user'

function readCachedUser() {
  try {
    const raw = uni.getStorageSync(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

const user = ref(readCachedUser())
const submitting = ref(false)
/** 首次 token 校验是否完成（避免启动闪一下未登录态） */
const restored = ref(false)

/** 落盘时只存用户资料，token 由 request 层单独管理 */
function persist(next) {
  user.value = next
  if (next) {
    uni.setStorageSync(
      USER_KEY,
      JSON.stringify({
        token: null,
        userId: next.userId,
        name: next.name,
        nickname: next.nickname || '',
        avatar: next.avatar || '',
        gender: next.gender,
        account: next.account || '',
        rating: next.rating,
        gamesPlayed: next.gamesPlayed,
        isAdmin: next.isAdmin === true,
      }),
    )
  } else {
    uni.removeStorageSync(USER_KEY)
  }
}

function accept(result) {
  if (result.token) {
    setToken(result.token)
  }
  persist(result)
  return result
}

async function login(payload) {
  submitting.value = true
  try {
    return accept(await authApi.login(payload))
  } finally {
    submitting.value = false
  }
}

async function register(payload) {
  submitting.value = true
  try {
    return accept(await authApi.register(payload))
  } finally {
    submitting.value = false
  }
}

/**
 * 取微信登录 code。
 * 没有 appid / 开发者工具不支持时降级成 mock code（后端 WX_MOCK_ENABLED=true 时可用），
 * 保证没有小程序账号也能联调。
 * H5 手机网页不提供微信一键登录（UI 已隐藏），直接走 mock 兜底，避免调用不存在的 provider。
 */
function getWxCode() {
  return new Promise((resolve) => {
    // #ifdef H5
    resolve(mockCode())
    return
    // #endif
    // #ifndef H5
    uni.login({
      provider: 'weixin',
      success: (res) => {
        if (res && res.code) {
          resolve(res.code)
        } else {
          resolve(mockCode())
        }
      },
      fail: () => resolve(mockCode()),
    })
    // #endif
  })
}

function mockCode() {
  let id = ''
  try {
    id = uni.getStorageSync('shukeyu_devid') || ''
  } catch (e) {
    id = ''
  }
  if (!id) {
    id = 'mock_' + randomUid(8)
    uni.setStorageSync('shukeyu_devid', id)
  }
  return id
}

/** 微信一键登录 */
async function loginWithWechat(nickName) {
  submitting.value = true
  try {
    const code = await getWxCode()
    return accept(await authApi.wxLogin({ code, nickName }))
  } finally {
    submitting.value = false
  }
}

/** 完善资料后同步本地缓存 */
function applyProfile(profile) {
  if (user.value) {
    persist({ ...user.value, ...profile })
  }
}

async function logout() {
  try {
    // 让后端把 token 拉黑；即便失败也必须清本地，不能把用户卡在登录态
    if (getToken()) {
      await authApi.logout()
    }
  } catch (e) {
    /* 忽略：本地登出一定要成功 */
  } finally {
    clearToken()
    persist(null)
  }
}

/** 应用启动时用本地 token 换一次用户信息；token 失效则静默登出 */
async function restore() {
  if (restored.value) {
    return
  }
  restored.value = true
  if (!getToken()) {
    persist(null)
    return
  }
  try {
    const me = await authApi.fetchMe()
    persist({ ...me, token: null })
  } catch (e) {
    clearToken()
    persist(null)
  }
}

/**
 * 强制拉取一次最新用户信息（不受 restored 幂等限制）。
 * 用于「我的」页 onShow、头像上传后等场景，保证多端缓存的头像/资料是库里最新值。
 */
async function refreshMe() {
  if (!getToken()) {
    return
  }
  try {
    const me = await authApi.fetchMe()
    persist({ ...me, token: null })
  } catch (e) {
    /* 静默失败：下次 restore / 其他请求会再同步 */
  }
}

/**
 * token 过期 / 被登出时由请求层广播：这里同步清掉登录态。
 * 放在 store 里而不是 App.vue，是为了让「谁先 import 谁负责」——页面必然 import 本模块。
 */
if (typeof uni !== 'undefined' && typeof uni.$on === 'function') {
  uni.$on('shukeyu:unauthorized', () => {
    restored.value = false
    persist(null)
  })
}

export function useAuth() {
  return {
    user,
    isLoggedIn: computed(() => user.value !== null),
    isAdmin: computed(() => user.value?.isAdmin === true),
    submitting,
    restored,
    login,
    register,
    loginWithWechat,
    applyProfile,
    logout,
    restore,
    refreshMe,
  }
}
