<script setup>
import { ref, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { updateProfile, uploadAvatar } from '../../common/api/auth'
import { resolveUrl, toastError } from '../../common/util'
import { navigateTo } from '../../common/nav'
import { useAuth } from '../../common/store/auth'
import NavBack from '../../components/nav-back/nav-back.vue'

const { user, isLoggedIn, applyProfile, restore, refreshMe } = useAuth()

const form = ref({
  name: '',
  nickname: '',
  gender: 0,
  account: '',
  avatar: '',
})
const saving = ref(false)
const uploadingAvatar = ref(false)

/** 用最新的 /auth/me 回填，避免本地缓存和库里不一致 */
function fillFromUser() {
  if (!user.value) return
  form.value = {
    name: user.value.name || '',
    nickname: user.value.nickname || '',
    gender: user.value.gender || 0,
    account: user.value.account || '',
    // 保留刚上传的头像：避免 watch 触发时覆盖 onAvatarCropped 设置的 URL
    avatar: form.value.avatar || user.value.avatar || '',
  }
}

onLoad(async () => {
  // 注册裁剪页回传事件
  uni.$on('avatar-cropped', onAvatarCropped)
  if (!user.value) {
    await restore()
  } else {
    // 有本地缓存也要同步一次库里的最新资料（其他端可能改过头像）
    refreshMe()
  }
  fillFromUser()
})

onUnload(() => {
  uni.$off('avatar-cropped', onAvatarCropped)
})

watch(user, fillFromUser)

/** 判断文件是否为 GIF 动图：H5 端用 File.type，小程序端从路径后缀 */
function isGif(filePath, file) {
  if (file && file.type && file.type.toLowerCase() === 'image/gif') return true
  if (filePath) {
    const ext = filePath.toLowerCase()
    if (ext.endsWith('.gif')) return true
    if (ext.indexOf('data:image/gif') === 0) return true
  }
  return false
}

/** 选择图片后进入裁剪页，裁剪完成事件里再上传；GIF 跳过裁剪直传保留动图 */
async function chooseAvatar() {
  let tempFile
  let rawFile // uni.chooseImage success 里 tempFiles[0]，H5 为原生 File 有 .type
  try {
    const choose = await new Promise((resolve, reject) => {
      uni.chooseImage({
        count: 1,
        // 用 original 保留原始格式：GIF 动图不能压缩，一压缩就丢帧变静态
        sizeType: ['original'],
        success: (res) => resolve(res),
        fail: (err) => reject(err),
      })
    })
    tempFile = (choose.tempFilePaths && choose.tempFilePaths[0]) || ''
    rawFile = choose.tempFiles && choose.tempFiles[0]
    if (!tempFile) return
  } catch (e) {
    // 用户取消等场景：静默退出
    return
  }

  if (isGif(tempFile, rawFile)) {
    // GIF 动图：跳过裁剪页（canvas 导出只能产静态 JPEG），直接上传原图保留动效
    uni.showToast({ title: 'GIF 动图直接上传', icon: 'none' })
    await onAvatarCropped(tempFile)
    return
  }

  navigateTo(`/pages/crop/crop?src=${encodeURIComponent(tempFile)}`)
}

/** 裁剪页确认后回传临时文件，执行上传 */
async function onAvatarCropped(tempFile) {
  if (!tempFile) return
  uploadingAvatar.value = true
  try {
    const res = await uploadAvatar(tempFile)
    form.value.avatar = res && res.avatar ? res.avatar : ''
    // 上传接口本身已把 avatar 写库：立即同步到全局登录态（含本地缓存），
    // 「我的」页 / 首页身份卡马上能看到新头像，不必等用户点保存
    applyProfile({ avatar: form.value.avatar })
    uni.showToast({ title: '头像已上传', icon: 'success' })
  } catch (e) {
    toastError(e, '头像上传失败')
  } finally {
    uploadingAvatar.value = false
  }
}

async function save() {
  const name = form.value.name.trim()
  if (!name) {
    uni.showToast({ title: '请填写姓名', icon: 'none' })
    return
  }
  if (!form.value.gender) {
    uni.showToast({ title: '请选择性别', icon: 'none' })
    return
  }
  saving.value = true
  try {
    const updated = await updateProfile({
      name,
      // 昵称：空串=清除，后端不传(null)才是不修改；积分榜优先展示昵称
      nickname: form.value.nickname.trim(),
      gender: Number(form.value.gender),
      account: form.value.account.trim(),
      avatar: form.value.avatar,
    })
    applyProfile(updated)
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 500)
  } catch (e) {
    toastError(e, '保存失败')
  } finally {
    saving.value = false
  }
}

function pickGender(value) {
  form.value.gender = value
}

function goLogin() {
  navigateTo('/pages/auth/auth')
}
</script>

<template>
  <view class="page">
    <NavBack />

    <view v-if="isLoggedIn" class="panel">
      <view class="field">
        <text class="label">姓名</text>
        <uni-easyinput v-model="form.name" placeholder="填写真实姓名，便于球友辨认" />
      </view>

      <view class="field">
        <text class="label">昵称</text>
        <uni-easyinput v-model="form.nickname" placeholder="积分榜等场景展示，可留空" />
        <text class="hint">积分榜优先显示昵称；不填则显示姓名</text>
      </view>

      <view class="field">
        <text class="label">性别</text>
        <view class="gender">
          <view :class="['gender-item', { active: form.gender === 1 }]" @click="pickGender(1)">男</view>
          <view :class="['gender-item', { active: form.gender === 2 }]" @click="pickGender(2)">女</view>
        </view>
      </view>

      <view class="field">
        <text class="label">账号</text>
        <uni-easyinput v-model="form.account" placeholder="登录用，可留空；重复会被拒绝" />
        <text class="hint">绑定账号后可用「账号 + 密码」登录；留空表示不修改</text>
      </view>

      <view class="field">
        <text class="label">个人头像</text>
        <view class="avatar-row">
          <view class="self-avatar" @click="chooseAvatar">
            <image
              v-if="form.avatar"
              class="self-avatar-img"
              :src="resolveUrl(form.avatar)"
              mode="aspectFill"
            />
            <view v-else class="self-avatar-placeholder">
              <uni-icons type="camera" size="22" color="#7C837D" />
            </view>
            <view v-if="uploadingAvatar" class="self-avatar-mask">上传中</view>
          </view>
          <view class="avatar-tip">
            <text class="hint">用于轮排表展示真实身份；支持 jpg / png / webp / gif，≤ 5MB</text>
            <text v-if="form.avatar" class="avatar-replace" @click="chooseAvatar">更换头像</text>
          </view>
        </view>
      </view>

      <button class="save-btn" type="button" :loading="saving" @click="save">保存</button>
    </view>

    <view v-else class="guest">
      <view class="guest-title">还没有登录</view>
      <view class="guest-desc">登录后即可编辑个人信息、发布球局、查看 ELO 积分</view>
      <button class="primary-btn" type="button" @click="goLogin">登录 / 注册</button>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding: 16px 0 30px;
}
.panel {
  margin: 0 16px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.field {
  margin-bottom: 14px;
}
.label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #1a2e2a;
}
.hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: #5a726d;
}
.gender {
  display: flex;
  gap: 10px;
}
.gender-item {
  flex: 1;
  height: 38px;
  line-height: 38px;
  text-align: center;
  border: 1px solid #e3e8e6;
  border-radius: 8px;
  background: #ffffff;
  color: #5a726d;
  font-size: 14px;
}
.gender-item.active {
  border-color: #14665b;
  background: #e0f1ec;
  color: #14665b;
  font-weight: 700;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.self-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px dashed #c3d5c9;
  background: #f0f5f3;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.self-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.self-avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
}
.self-avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #ffffff;
  font-size: 12px;
  border-radius: 50%;
}
.avatar-tip {
  flex: 1;
}
.avatar-replace {
  display: inline-block;
  margin-top: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #e0f1ec;
  color: #14665b;
  font-size: 11px;
  font-weight: 700;
}
.save-btn {
  height: 42px;
  line-height: 42px;
  border: none;
  border-radius: 10px;
  background: #14665b;
  color: #faf7f0;
  font-size: 15px;
  font-weight: 700;
}
.guest {
  margin: 60px 16px;
  text-align: center;
}
.guest-title {
  font-size: 18px;
  font-weight: 800;
  color: #1a2e2a;
}
.guest-desc {
  margin: 8px 0 18px;
  font-size: 12px;
  line-height: 1.7;
  color: #5a726d;
}
.primary-btn {
  height: 42px;
  line-height: 42px;
  border: none;
  border-radius: 10px;
  background: #e5c84b;
  color: #1a2e2a;
  font-size: 15px;
  font-weight: 700;
}
</style>
