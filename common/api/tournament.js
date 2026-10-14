import { request } from './request'

/**
 * 大型比赛（锦标赛）接口
 *
 * 与球局最大的差异：不涉及ELO。报名、分组、对阵、名次都不读积分，
 * 赛制靠「小组赛循环 + 逐轮淘汰 + 季军赛/决赛」推进。
 */

/** 赛事状态：0 报名中 1 已抽签 2 进行中 3 已结束 4 已取消（见后端 Constants） */
export const TOURNAMENT_STATUS = {
  0: { text: '报名中', color: '#E5C84B' },
  1: { text: '已抽签', color: '#14665B' },
  2: { text: '进行中', color: '#2E8B57' },
  3: { text: '已结束', color: '#5A726D' },
  4: { text: '已取消', color: '#9AA8A4' },
}

/** 组别：1 单打 2 男双 3 女双 4 混双 */
export const TOURNAMENT_FORMAT = {
  1: { text: '单打', teamSize: 1, needPartner: false, gender: '不区分' },
  2: { text: '男双', teamSize: 2, needPartner: true, gender: '两位男生' },
  3: { text: '女双', teamSize: 2, needPartner: true, gender: '两位女生' },
  4: { text: '混双', teamSize: 2, needPartner: true, gender: '一男一女' },
}

/** 对阵阶段：1 小组赛 2 淘汰赛 3 季军赛 4 决赛 */
export const TOURNAMENT_STAGE = {
  1: '小组赛',
  2: '淘汰赛',
  3: '季军赛',
  4: '决赛',
}

/** 名次文案 */
export const RANK_TEXT = {
  1: '冠军',
  2: '亚军',
  3: '季军',
  4: '第 4 名',
}

/** 参赛单位状态 */
export const ENTRY_STATUS = {
  0: { text: '待抽签', color: '#5A726D' },
  1: { text: '小组赛', color: '#14665B' },
  2: { text: '仍在赛', color: '#2E8B57' },
  3: { text: '已淘汰', color: '#9AA8A4' },
}

/** 赛事广场：报名中的排前面 */
export function listTournaments() {
  return request('/tournaments')
}

/** 赛事详情（含各组别报名情况、我的参赛单位、领奖台） */
export function getTournament(id) {
  return request(`/tournaments/${id}`)
}

/** 对阵图：小组积分榜 + 淘汰赛逐轮 + 最终名次 */
export function getTournamentBracket(id) {
  return request(`/tournaments/${id}/bracket`)
}

/** 赛程录入：按组别返回待录入 / 已出结果两栏 */
export function getTournamentMatches(id) {
  return request(`/tournaments/${id}/matches`)
}

/**
 * 赛事报名
 * @param {number} id 赛事 id
 * @param {{ format: number, partnerId?: number, contact?: string }} payload
 *   format=1 单打不传 partnerId；双打必须传搭档 userId（由队长代搭档提交）
 */
export function enterTournament(id, payload) {
  return request(`/tournaments/${id}/entries`, { method: 'POST', body: payload })
}

/**
 * 按注册账号找搭档（双打报名用）
 * @param {string} account 搭档的注册账号
 * @returns {Promise<{userId:number,name:string,avatar:string,gender:number}>}
 */
export function lookupPartner(account) {
  return request(`/tournaments/partners/lookup?account=${encodeURIComponent(account)}`)
}

/** 撤回报名（报名中可自行撤回；已抽签仅管理员可移出参赛名单） */
export function cancelTournamentEntry(id, entryId) {
  return request(`/tournaments/${id}/entries/${entryId}`, { method: 'DELETE' })
}

/** 抽签分组 + 生成小组赛程（管理员 / 赛事创建人） */
export function drawTournament(id) {
  return request(`/tournaments/${id}/draw`, { method: 'POST' })
}

/** 取消赛事（管理员 / 创建人，只能取消没开打的） */
export function cancelTournament(id) {
  return request(`/tournaments/${id}/cancel`, { method: 'PUT' })
}

/**
 * 赛事计分：只需指定胜方，比分可选填
 * @param {number} matchId 对阵 id
 * @param {{ winner: number, scoreA?: number, scoreB?: number }} payload
 *   winner=1 A队胜 / 2 B队胜 / 0 撤销本场（会连带清空后续轮次）
 */
export function scoreTournamentMatch(matchId, payload) {
  return request(`/tournaments/matches/${matchId}/score`, { method: 'PUT', body: payload })
}

/** 创建赛事（管理员） */
export function createTournament(payload) {
  return request('/tournaments', { method: 'POST', body: payload })
}