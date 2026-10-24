# 数科羽 ShuKeYu - 微信小程序 / H5（uni-app）

校园羽毛球球局系统的**移动端**：微信小程序为主，同一套代码可发行 H5 手机网页。

**技术栈：uni-app + Vue 3（组合式 API）+ uni-ui，无 npm 运行时依赖**（项目为 HBuilderX 工程结构，直接用 HBuilderX 打开运行）。

## 功能页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 球局广场 | `pages/index` | 首页 Tab：球局列表、筛选、下拉刷新、首页弹窗公告（管理员配置的频率/配色/媒体） |
| 发布球局 | `pages/create` | Tab：发布（封面上传、场地选择） |
| 积分榜 | `pages/ranking` | Tab：ELO 榜单（单打榜 / 双打榜 / 混双榜三档切换，Redis 热点读，官网同源） |
| 我的 | `pages/mine` | Tab：个人中心、资料、三分类战绩明细（单打/双打/混双）、历史入口；环境切换入口仅管理员可见 |
| 球局详情 | `pages/detail` | 对阵 / 报名 / 现场计分 / 改分历史 |
| 编辑球局 | `pages/edit` | 发布人编辑 |
| 登录 | `pages/auth` | 图形验证码登录 / 注册 / 微信一键登录 |
| 编辑资料 | `pages/profile` | 姓名 / 昵称 / 性别 / 头像 |
| 历史场次 | `pages/history` | 我的对局记录与积分变动 |
| 轮排 | `pages/rotation` | 场地轮转排表、录分 |
| ELO 试算实验室 | `pages/elo` | 试算类别（单打/双打/混双）+ 编排 + 积分结算模拟（不写库） |
| SHUKE 认证 | `pages/verify` | 身份校验答题 |
| 步伐训练 | `pages/footwork` | 训练内容 |
| 大型比赛 | `pages/tournament-list` / `-detail` / `-entry` / `-bracket` / `-matches` | 赛事广场 / 详情 / 报名 / 对阵图 / 赛程录入 |
| 裁图页 | `pages/crop` | 头像裁剪（自定义导航、黑底） |

TabBar 四项：**球局 / 发布 / 积分榜 / 我的**，图标由 [scripts/gen-tabbar-icons.mjs](scripts/gen-tabbar-icons.mjs) 用 SDF 直接绘制生成（纯 Node 内置模块，无第三方依赖）：

```bash
node scripts/gen-tabbar-icons.mjs   # 输出 static/tabbar/*.png 并打印 ASCII 预览
```

## 快速启动

### 微信小程序

1. 用 **HBuilderX** 打开本目录（`manifest.json` 已配 `mp-weixin.appid`）
2. 菜单 `运行 → 运行到小程序模拟器 → 微信开发者工具`
3. 微信开发者工具导入编译产物目录即可预览
   - `manifest.json` 中 `mp-weixin.setting.urlCheck: false`，开发期允许请求本地 `http` 接口
   - 正式上线前：把 `mp-weixin.appid` 换成自己的小程序 AppID，并把接口 BASE_URL 换成 **https 域名**（微信生产环境强制 https）

### H5 手机网页

```bash
# HBuilderX：运行 → 运行到浏览器；开发服务器端口 5175
```

- 路由 hash 模式，部署基路径 `/h5/`（与 PC 官网同域名按路径分流）
- 开发期 `manifest.json` 的 `h5.devServer.proxy` 把 `/auth` `/games` `/matches` `/ranking` `/rotation` `/elo` `/uploads` 代理到 `http://127.0.0.1:8080`，避免跨域
- 部署态 H5 强制走同源 `/api`（见 `common/config.js` 的 `getBaseUrl()`，规避混合内容拦截与 nginx 同源代理问题）

前置条件：后端 [../Code](../Code) 已在 `8080` 端口启动。

## 环境切换

[common/config.js](common/config.js) 提供运行时环境切换，持久化在本地存储（`ShuKeYu_env`），所有端共用：

| 环境 | 地址 |
|------|------|
| 本地开发（默认） | `http://127.0.0.1:8080/api`（开发者工具 / 真机同 WiFi 时用局域网 IP） |
| 线上环境 | `http://XX.XXX.XXX.XXX/api`（与 `config.js` 中 `ENVIRONMENTS` 一致；H5 部署态仍强制同源 `/api`） |
| 自定义 | 用户自填 URL |

## 目录结构

```
├── pages.json               # 路由 / 窗口 / TabBar 配置
├── manifest.json            # 应用配置（appid、H5 路由与代理、mp-weixin 设置）
├── App.vue                  # 全局生命周期 + 主题变量（与官网配色一致）
├── main.js                  # Vue3 入口（createSSRApp）
├── uni.scss                 # 全局 scss 变量
├── common/
│   ├── config.js            # 环境切换（本地 / 线上 / 自定义）
│   ├── api/                 # 请求层与业务 API
│   │   ├── request.js       #   统一解包 ApiResponse、token 注入（ShuKeYu_token）、
│   │   │                    #   401 时清 token 并广播 ShuKeYu:unauthorized
│   │   ├── auth / game / ranking / elo / rotation / tournament
│   │   ├── court / my / settings / verification
│   ├── store/               # 模块级 ref 单例（useAuth / 轮排状态）
│   ├── util.js / coord.js / nav.js / qqmap.js
├── components/              # SmartImage（缩略图）/ QqMapView（地图）/ nav-back
├── pages/                   # 19 个页面（见上表）
├── static/                  # 图片、tabbar 图标、customicons 字体
├── scripts/gen-tabbar-icons.mjs
└── uni_modules/             # uni-ui 组件库（47 个模块）
```

## 样式与主题

- 主题变量定义在 `App.vue` 的 `page {}`：`--primary #14665B`（场地墨绿）、`--accent #E5C84B`（荧光黄）、`--bg #FAF7F0`（暖白），与 PC 官网 [yuyue-vue](../yuyue-vue) 保持一致
- H5 宽屏（≥768px）下根节点收成 430px 手机壳居中列，保证桌面浏览器视觉与手机一致
- tabBar 原生图标只认 png，故用脚本生成而非样式覆盖

## 构建产物

- `dist-mp/`：小程序端部分静态产物（已入库的静态资源副本）
- HBuilderX 编译输出目录 `unpackage/` 已在 `.gitignore` 中忽略

## 相关项目

- 后端：[../Code](../Code)（Spring Boot，Swagger UI: `http://localhost:8080/api/swagger-ui.html`）
- PC 官网 / 管理后台：[../yuyue-vue](../yuyue-vue)（Vue 3 + Vite）
