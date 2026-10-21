import { request } from './request'

/**
 * 积分榜 Top N：官网与小程序同源，读 Redis ZSet。
 * rating/win/loss 均为所请求类别（type）的口径。
 * @param {number} n
 * @param {number} type 类别：1单打(默认) 2双打(同性别) 3混双
 */
export function fetchRanking(n = 20, type = 1) {
  return request(`/ranking?n=${n}&type=${type}`)
}
