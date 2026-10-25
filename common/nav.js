/**
 * 页面跳转统一封装。
 *
 * 背景：H5 端 uni.navigateTo 内部走 getApp().$router.push()，
 * 开发环境下热更新（HMR）重建 App 实例后 $router 可能没挂上，会直接抛
 * "Cannot read properties of undefined (reading 'push')"；
 * 这个异常发生在 uni 内部的 Promise executor 里，不会进 fail 回调，
 * 所以只能在调用前探测 $router，缺失就降级成直接改 hash（H5 默认 hash 路由）。
 *
 * 小程序 / App 端条件编译后只剩原生 uni.navigateTo / uni.switchTab。
 */

/**
 * 跳转失败不再静默：统一 fail 回调（toast + 控制台报错），
 * 避免再出现「跳 tab 页 / 路径写错 / 栈满」这类点了没反应的隐性 bug。
 * 调用方自己传了 fail 的话尊其优先。
 */
function withFailLog(opts, tag, url) {
  if (opts && typeof opts.fail === 'function') return opts
  const fail = (err) => {
    // eslint-disable-next-line no-console
    console.error(`[nav] ${tag} 失败:`, url, err)
    try {
      uni.showToast({ title: '页面跳转失败', icon: 'none' })
    } catch (e) {
      // 极端场景下 showToast 也可能没就绪，忽略
    }
  }
  return { fail, ...(opts || {}) }
}

export function navigateTo(url, opts = {}) {
  // #ifdef H5
  const app = typeof getApp === 'function' ? getApp() : null
  if (!app || !app.$router) {
    window.location.hash = '#' + url
    return
  }
  // #endif
  uni.navigateTo({ url, ...withFailLog(opts, 'navigateTo', url) })
}

export function switchTab(url) {
  // #ifdef H5
  const app = typeof getApp === 'function' ? getApp() : null
  if (!app || !app.$router) {
    window.location.hash = '#' + url
    return
  }
  // #endif
  uni.switchTab({ url, ...withFailLog(null, 'switchTab', url) })
}

export function navigateBack(delta = 1) {
  // #ifdef H5
  const app = typeof getApp === 'function' ? getApp() : null
  if (!app || !app.$router) {
    window.history.go(-delta)
    return
  }
  // #endif
  uni.navigateBack({ delta })
}

/**
 * 返回上一页；已经是栈底（分享 / 扫码 / 刷新直接进来的页面）时退到首页。
 * 直接 navigateBack 在栈深为 1 时会失败，用户会被卡在当前页。
 */
export function backOrHome(homeUrl = '/pages/index/index', delta = 1) {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (pages && pages.length > 1) {
    navigateBack(delta)
  } else {
    switchTab(homeUrl)
  }
}
