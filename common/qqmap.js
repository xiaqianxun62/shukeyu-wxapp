/**
 * 腾讯地图 JavaScript API（v2.exp）统一加载器（仅 H5 端使用）
 *
 * - key 类型必须与申请的 key 一致：DROBZ-… 是「JavaScript API」类型 key，
 *   走 map.qq.com/api/js?v=2.exp（GL 版 gljs 需要另外类型的 key，用这把会 403 拒发）；
 * - 单例 Promise：多处调用只注入一个 <script>，失败后清空可重试；
 * - JSONP 回调名全局唯一，加载失败 / 超时都会 reject，调用方据此展示兜底 UI。
 */

// 与 manifest.json 中 h5.sdkConfigs.maps.tencent.key 保持一致
const QQ_MAP_KEY = 'DROBZ-77XCZ-2WQXQ-7HMJ5-CKIR7-N4BRC'

const LOAD_TIMEOUT_MS = 10000

/** 全局单例：正在加载 / 已加载的 Promise（挂在全局对象上防 HMR 重置） */
const g = typeof window !== 'undefined' ? window : {}

function getPending() {
  return g.__shukeyuQQMapPromise || null
}

function setPending(p) {
  g.__shukeyuQQMapPromise = p
}

/**
 * 加载腾讯地图 JS API（v2.exp）。
 * @returns {Promise<QMaps>} resolve 为 window.qq.maps（命名空间）
 */
export function loadQQMap() {
  // 非 H5 环境直接失败，调用方不该走到这里
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('腾讯地图仅支持 H5 端'))
  }

  // 已就绪
  if (g.qq && g.qq.maps) return Promise.resolve(g.qq.maps)

  const pending = getPending()
  if (pending) return pending

  const p = new Promise((resolve, reject) => {
    // JSONP 回调名必须全局唯一，重复加载时 Tencent 会立即回调
    const cbName = `__shukeyuQQMapCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    let script = null
    let timer = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      try { delete g[cbName] } catch (e) { /* ignore */ }
      if (script && script.parentNode) script.parentNode.removeChild(script)
    }

    g[cbName] = function () {
      if (g.qq && g.qq.maps) {
        cleanup()
        resolve(g.qq.maps)
      } else {
        cleanup()
        reject(new Error('腾讯地图 SDK 回调成功但 qq.maps 全局对象不存在'))
      }
    }

    timer = setTimeout(() => {
      cleanup()
      setPending(null)
      reject(new Error('腾讯地图 SDK 加载超时'))
    }, LOAD_TIMEOUT_MS)

    script = document.createElement('script')
    script.src = `https://map.qq.com/api/js?v=2.exp&key=${QQ_MAP_KEY}&callback=${cbName}`
    script.async = true
    script.onerror = () => {
      cleanup()
      setPending(null)
      reject(new Error('腾讯地图 SDK 网络加载失败'))
    }
    document.head.appendChild(script)
  })

  setPending(p)
  // 失败后清掉单例，下次调用可重试
  p.catch(() => setPending(null))
  return p
}
