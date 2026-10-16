/**
 * 环境配置：支持运行时切换 本地 / 线上 / 自定义，持久化到本地存储。
 * 所有端（H5 / 小程序）共用这一份配置。
 */

const ENV_KEY = 'shukeyu_env'
const CUSTOM_KEY = 'shukeyu_custom_url'

/** 预定义环境 */
const ENVIRONMENTS = [
  {
    id: 'local',
    label: '本地开发',
    // 局域网 IP：开发者工具 / 真机同 WiFi 时用
    url: 'http://127.0.0.1:8080/api',
  },
  {
    id: 'prod',
    label: '线上环境',
    url: 'http://42.193.190.232/api',
  },
]

/** 获取当前环境 id（默认 local） */
export function getEnvId() {
  try {
    return uni.getStorageSync(ENV_KEY) || 'local'
  } catch {
    return 'local'
  }
}

/** 设置当前环境 id */
export function setEnvId(id) {
  try {
    uni.setStorageSync(ENV_KEY, id)
  } catch {
    /* 忽略 */
  }
}

/** 获取自定义 URL */
export function getCustomUrl() {
  try {
    return uni.getStorageSync(CUSTOM_KEY) || ''
  } catch {
    return ''
  }
}

/** 保存自定义 URL */
export function setCustomUrl(url) {
  try {
    uni.setStorageSync(CUSTOM_KEY, url)
  } catch {
    /* 忽略 */
  }
}

/**
 * 获取当前生效的 BASE_URL。
 * - H5 且页面不在 localhost → 强制同源 /api（部署时接口同域，无跨域、无混合内容）；
 * - 其余（开发者工具 / localhost / 小程序）→ 按用户选择的环境（或默认 local）走。
 *
 * 注意：env 切换开关仅对 localhost 和小程序生效；H5 部署态同源是硬规则，
 * 因为 envId 默认 prod 会让部署页面错误地拼 http://42.193.190.232/api，
 * 既可能触发混合内容拦截，又绕开了同源 nginx 的代理/静态映射。
 */
export function getBaseUrl() {
  // #ifdef H5
  const host = typeof location !== 'undefined' ? location.hostname : ''
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return '/api'
  }
  // #endif
  const envId = getEnvId()
  if (envId === 'custom') {
    return getCustomUrl() || ENVIRONMENTS[0].url
  }
  if (envId) {
    const env = ENVIRONMENTS.find((e) => e.id === envId)
    if (env) return env.url
  }
  return ENVIRONMENTS[0].url
}

/** 获取当前环境信息（用于 UI 展示） */
export function getCurrentEnv() {
  const id = getEnvId()
  if (id === 'custom') {
    return { id: 'custom', label: '自定义', url: getCustomUrl() }
  }
  return ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0]
}

export { ENVIRONMENTS }
