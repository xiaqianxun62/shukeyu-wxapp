import { request, uploadFile } from './request'

/**
 * @typedef {Object} AuthResult
 * @property {string|null} token 仅注册、登录时返回；/auth/me 返回 null
 * @property {number} userId
 * @property {string} name
 * @property {number} gender 1男 2女 0未知
 * @property {string|null} account 登录账号，微信用户未绑定时为空
 * @property {number} rating
 * @property {number} gamesPlayed
 */

/** @param {{ account: string, password: string, captchaUuid: string, captchaCode: string }} payload */
export function login(payload) {
  return request('/auth/login', { method: 'POST', body: payload })
}

/** @param {{ account: string, name: string, nickname?: string, gender: number, password: string, captchaUuid: string, captchaCode: string }} payload */
export function register(payload) {
  return request('/auth/register', { method: 'POST', body: payload })
}

/** 获取图形验证码：{ uuid, image } ，image 是 data:image/png;base64,... 完整 data URL */
export function fetchCaptcha() {
  return request('/auth/captcha')
}

/** 昵称查重：公开接口。edit 时传 excludeId 排除自己 */
export function checkNameAvailable(name, excludeId = null) {
  const params = new URLSearchParams({ name })
  if (excludeId != null) params.append('excludeId', excludeId)
  return request(`/auth/name-check?${params.toString()}`)
}

/**
 * 微信小程序登录：code → openid → JWT
 * @param {{ code: string, nickName?: string, avatarUrl?: string }} payload
 */
export function wxLogin(payload) {
  return request('/auth/wxlogin', { method: 'POST', body: payload })
}

/**
 * 完善资料：微信用户补充姓名 / 性别 / 账号
 * @param {{ name?: string, gender?: number, account?: string }} payload
 */
export function updateProfile(payload) {
  return request('/auth/profile', { method: 'POST', body: payload })
}

export function fetchMe() {
  return request('/auth/me')
}

export function logout() {
  return request('/auth/logout', { method: 'POST' })
}

/** 上传个人头像，返回 { avatar: url } */
export function uploadAvatar(filePath) {
  return uploadFile('/auth/avatar', filePath, 'file')
}
