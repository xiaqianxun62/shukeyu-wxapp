# 改进实施记录（2026-10-26）

依据会话中排查出的问题（「编辑球局点击无反应」的根因链）落实的改进，共 6 项代码/环境改动 + 1 份本文档。涉及后端（Shukeyu）、PC 官网（shukeyu-vue）、小程序（shukeyu-wxapp）三个仓库。

## 背景

小程序球局详情页「编辑球局」按钮点击无反应：`pages/create/create` 是 tabBar 页，微信小程序不允许 `uni.navigateTo` 打开 tab 页，且 `fail` 回调未处理 → 静默失败。修复与防回归措施如下。

---

## 1. 跳转失败可见化（shukeyu-wxapp · common/nav.js）

`navigateTo` / `switchTab` 统一注入 `fail` 回调：`console.error` 定位日志 + toast「页面跳转失败」。调用方自带 `fail` 时不覆盖。

- 以后任何路由错误（跳 tab 页、路径写错、页面栈满 10 层）都会有可见反馈，不再「点了没反应」。

## 2. 删除 create.vue 死编辑模式（shukeyu-wxapp · pages/create/create.vue）

URL 带 `id` 的隐藏编辑分支（`isEdit` / `editingId`、onLoad 回填、updateGame 提交、模板里 2 处三元）自「编辑球局」改走 `pages/edit/edit` 后永远不可达，全部删除（净删约 40 行），并把真实编辑职责注释写明，防止后人误以为该分支仍有效。

- 附带效果：`getGame` / `updateGame` / `onLoad` 三个 import 一并清理，create 页语义收敛为纯「发布」。

## 3. 跳转路由校验脚本（shukeyu-wxapp · scripts/check-routes.mjs，新增）

纯 Node 内置模块、无第三方依赖，用于提交前静态拦截三类问题：

1. `pages.json` 注册的每个页面对应 `.vue` 文件必须存在；
2. 代码里 `navigateTo` / `switchTab` / `redirectTo` 的字面量路径必须命中 `pages.json`；
3. `switchTab` 不得跳非 tab 页；`navigateTo` / `redirectTo` 不得跳 tab 页（正是本次 bug 的形态）。

运行：`node scripts/check-routes.mjs`（有问题 exit 1）。当前基线：19 个页面、37 个文件全部通过。已知限制：拼接型动态路径（`'/pages/x/' + id`）无法静态识别，由 nav.js 的 fail 提示兜底。README 的构建产物一节已补充用法。

## 4. 重置密码后旧会话立即失效（Shukeyu 后端）

此前管理员重置某账号密码后，该用户已登录的旧 token 可继续用到过期。现在：

- `Constants` 新增按用户踢下线标记前缀 `JWT_PWD_RESET_PREFIX`（`yuyue:jwt:pwd_reset:{userId}`，value = 生效时刻 epoch ms）；
- `UserService.adminResetPassword()` 写标记，TTL = token 最大存活时长（到期自动清）;
- `JwtUtil` 新增 `parseClaims()`（保留 `parse()` 委托），让拦截器能读到 `issuedAt`；
- `AuthInterceptor` 抽出 `requireFreshToken()`：登出黑名单与踢下线标记统一校验，早于标记时刻签发的 token 一律 401；公开读接口的软鉴权同样不认旧 token（视为未登录）。

## 5. adminResetPassword 单测（Shukeyu · 新增 UserServiceAdminResetPasswordTest）

Mockito 纯单测，三条断言：

1. 正常账号重置：哈希落库为 `hash(123456):salt` 形态，且 Redis 记了踢下线标记（key/value/TTL 均验证）；
2. 用户不存在 → `USER_NOT_FOUND`，不写库不写标记；
3. 未设置账号的微信用户 → `PARAM_ERROR` 拒绝。

## 6. 文档与仓库环境一致性

- 三个仓库 README 的跨项目链接全部指向实际存在的目录（修正 `../Code`、`../yuyue-vue`、`../yuyue-wxapp` 等死链）；
- 三个仓库的 `origin` 已 `set-url` 到改名后的 GitHub 地址（此前靠 GitHub 重定向）。

---

## 验证结果

| 检查 | 结果 |
|---|---|
| 后端 `mvn test`（含新增 3 条用例） | ✅ EXIT=0 |
| wxapp `node scripts/check-routes.mjs` | ✅ EXIT=0 |
| 三仓库 `git ls-remote`（remote 有效） | ✅ |

## 未实施（保持记录，等待决策）

- **品牌名大小写统一**：目录 `Shukeyu` / `shukeyu-vue` 与内容里的 "ShuKeYu" 未对齐。本地目录改名成本高、牵涉所有跨仓库引用，建议单独决策后一次性做。
- **wxapp 无 CI**：校验脚本目前靠手动执行；若后续接入 CI，把 `node scripts/check-routes.mjs` 作为必过门槛即可。
- **动态拼接跳转路径**的静态识别：超出脚本能力，由 fail 提示兜底。

## 相关提交

- Shukeyu（后端）：踢下线标记 + 单测
- shukeyu-vue：README 死链修正
- shukeyu-wxapp：nav.js fail 提示、create.vue 死代码清理、check-routes 脚本、README 修正
