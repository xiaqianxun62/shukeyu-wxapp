/**
 * 统一请求层：把后端 ApiResponse{code,message,data} 解包成业务数据。
 * 约定：HTTP 状态码始终是 200，code === 0 才算成功（见后端 GlobalExceptionHandler）。
 */

import { getBaseUrl } from '../config'

const TOKEN_KEY = 'ShuKeYu_token'

export function getToken() {
  try {
    return uni.getStorageSync(TOKEN_KEY) || null
  } catch (e) {
    return null
  }
}

export function setToken(token) {
  uni.setStorageSync(TOKEN_KEY, token)
}

export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY)
}

/** 业务异常：带后端错误码，便于上层区分「账号已注册」「密码错误」等场景 */
export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * @param {string} path 以 / 开头的接口路径
 * @param {{ method?: string, body?: object }} options
 * @returns {Promise<any>}
 */
export function request(path, options = {}) {
  const token = getToken()
  const header = {}
  if (token) {
    header.Authorization = `Bearer ${token}`
  }
  const baseUrl = getBaseUrl()

  return new Promise((resolve, reject) => {
    uni.request({
      url: baseUrl + path,
      method: options.method || 'GET',
      data: options.body,
      header,
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new ApiError(res.statusCode, `请求失败（HTTP ${res.statusCode}）`))
          return
        }
        const payload = res.data || {}
        if (payload.code !== 0) {
          // token 失效：清掉本地凭证，并广播给登录状态
          if (payload.code === 401) {
            clearToken()
            if (typeof uni !== 'undefined' && typeof uni.$emit === 'function') {
              uni.$emit('ShuKeYu:unauthorized')
            }
          }
          reject(new ApiError(payload.code, payload.message || '请求失败'))
          return
        }
        resolve(payload.data)
      },
      fail: () => {
        reject(new ApiError(-1, `无法连接服务器（${baseUrl}）`))
      },
    })
  })
}

/**
 * multipart 文件上传：带 token，返回业务数据（与 request 一样解包 ApiResponse）
 * @param {string} path 接口路径
 * @param {string} filePath 临时文件路径
 * @param {string} name 文件字段名
 * @returns {Promise<any>}
 */
export function uploadFile(path, filePath, name) {
  const token = getToken()
  const header = {}
  if (token) {
    header.Authorization = `Bearer ${token}`
  }
  const baseUrl = getBaseUrl()

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: baseUrl + path,
      filePath,
      name,
      header,
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new ApiError(res.statusCode, `请求失败（HTTP ${res.statusCode}）`))
          return
        }
        let payload = {}
        try {
          payload = JSON.parse(res.data) || {}
        } catch (e) {
          payload = {}
        }
        if (payload.code !== 0) {
          if (payload.code === 401) {
            clearToken()
            if (typeof uni !== 'undefined' && typeof uni.$emit === 'function') {
              uni.$emit('ShuKeYu:unauthorized')
            }
          }
          reject(new ApiError(payload.code, payload.message || '上传失败'))
          return
        }
        resolve(payload.data)
      },
      fail: () => {
        reject(new ApiError(-1, `无法连接服务器（${baseUrl}）`))
      },
    })
  })
}
