#!/usr/bin/env node
/**
 * 跳转路由校验脚本（纯 Node 内置模块，无第三方依赖）。
 *
 * 防回归目标：detail 页「编辑球局」曾因 navigateTo 跳 tabBar 页（小程序不允许）
 * 而点击无反应。本脚本在提交前拦住三类错误：
 *
 *   1. pages.json 里注册的每个页面，对应的 .vue 文件必须存在；
 *   2. 代码里 navigateTo / switchTab / redirectTo 的字面量路径（'/pages/xx'、
 *      '/pages/xx?id=' 模板串）都能命中 pages.json 注册过的页面；
 *   3. switchTab 的目标必须是 tabBar 页，navigateTo / redirectTo 的目标不能是 tabBar 页。
 *
 * 用法：node scripts/check-routes.mjs   （发现问题时 exit 1）
 *
 * 已知限制：拼接出来的动态路径（如 url = '/pages/x/' + id）无法静态识别，跳过；
 * 覆盖不到的角落仍需运行时配合 nav.js 的 fail 提示兜底。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const errors = []
const warnings = []

/* ---------- 1. pages.json 页面文件存在性 ---------- */

const pagesJson = JSON.parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8'))
// 跳转代码里习惯带前导斜杠（'/pages/x'），pages.json 里不带；统一按带斜杠比对
const pagesPaths = (pagesJson.pages || []).map((p) => '/' + p.path)
const tabPaths = new Set((pagesJson.tabBar?.list || []).map((t) => '/' + t.pagePath))

for (const p of pagesPaths) {
  const file = path.join(root, `${p}.vue`)
  if (!fs.existsSync(file)) {
    errors.push(`pages.json 注册的页面文件不存在: ${p}.vue`)
  }
}
for (const t of tabPaths) {
  if (!pagesPaths.includes(t)) {
    errors.push(`tabBar 引用的页面未在 pages.json 注册: ${t}`)
  }
}

/* ---------- 2/3. 跳转调用静态检查 ---------- */

const API_DIR = path.join(root, 'pages')
const COMMON_DIR = path.join(root, 'common')

function listFiles(dir, exts, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) listFiles(full, exts, acc)
    else if (exts.some((e) => name.endsWith(e))) acc.push(full)
  }
  return acc
}

const files = [
  ...listFiles(API_DIR, ['.vue']),
  ...listFiles(COMMON_DIR, ['.js']),
]

// 匹配 navigateTo/switchTab/redirectTo( 后跟引号：单引号字符串或模板串。
// 模板串里的 ${...} 与 ? 后面的 query 在判断前剥掉。
const CALL_RE = /\b(navigateTo|switchTab|redirectTo)\(\s*(['"`])(\/pages\/[^'"`$?\n]*?)\2/g
const PAGES_SET = new Set(pagesPaths)

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(root, file).replace(/\\/g, '/')
  for (const m of src.matchAll(CALL_RE)) {
    const api = m[1]
    const target = m[3]
    if (!PAGES_SET.has(target)) {
      errors.push(`${rel}: ${api} 的目标页面未注册: '${target}'`)
      continue
    }
    if (api === 'switchTab' && !tabPaths.has(target)) {
      errors.push(`${rel}: switchTab 不能跳非 tabBar 页: '${target}'`)
    }
    if (api !== 'switchTab' && tabPaths.has(target)) {
      errors.push(`${rel}: ${api} 无法打开 tabBar 页（小程序限制，对应按钮会无反应）: '${target}'`)
    }
  }
}

/* ---------- 输出 ---------- */

if (warnings.length) {
  console.log('⚠ 警告:')
  for (const w of warnings) console.log('  -', w)
}
if (errors.length) {
  console.error('✗ 跳转路由校验未通过:')
  for (const e of errors) console.error('  -', e)
  process.exit(1)
}
console.log(`✓ 跳转路由校验通过：${pagesPaths.length} 个页面全部存在，` +
  `${files.length} 个文件无非法跳转目标`)
