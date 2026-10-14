<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  enterTournament,
  getTournament,
  lookupPartner,
  TOURNAMENT_FORMAT,
} from '../../common/api/tournament'
import { navigateBack } from '../../common/nav'
import { AVATAR_COLORS, toastError } from '../../common/util'
import { useAuth } from '../../common/store/auth'
import SmartImage from '../../components/SmartImage/SmartImage.vue'

const { user } = useAuth()

const id = ref(null)
const detail = ref(null)
const submitting = ref(false)
const partnerAccount = ref('')
const partner = ref(null)
const looking = ref(false)
const contact = ref('')

/** 还能报的组别：已开报名、没报过、没满 */
const available = computed(() =>
  (detail.value?.formats || []).filter((f) => !f.joined && !f.full),
)
const chosen = ref(null)
const chosenMeta = computed(() =>
  chosen.value ? TOURNAMENT_FORMAT[chosen.value] : null,
)

/** 混双等组别在提交前就能判断性别是否匹配，省一次往返 */
const genderHint = computed(() => {
  if (!chosenMeta.value || !partner.value || !user.value) return ''
  const mine = user.value.gender
  const other = partner.value.gender
  if (!mine || !other) return '你的性别资料未填写，请先到「我的资料」补全'
  if (chosen.value === 2 && !(mine === 1 && other === 1)) return '男双需要两位男生，当前不满足'
  if (chosen.value === 3 && !(mine === 2 && other === 2)) return '女双需要两位女生，当前不满足'
  if (chosen.value === 4 && mine === other) return '混双需要一男一女，当前不满足'
  return ''
})

const canSubmit = computed(() => {
  if (!chosen.value || submitting.value || genderHint.value) return false
  if (chosenMeta.value?.needPartner) return !!partner.value
  return true
})

onLoad(async (options) => {
  id.value = Number(options.id)
  try {
    detail.value = await getTournament(id.value)
    // 默认选中第一个可报组别，减少一次点击
    if (available.value.length === 1) {
      choose(available.value[0].format)
    }
  } catch (e) {
    toastError(e, '赛事加载失败')
  }
})

function choose(format) {
  if (chosen.value === format) return
  chosen.value = format
  partner.value = null
  partnerAccount.value = ''
}

async function searchPartner() {
  if (!partnerAccount.value.trim()) {
    uni.showToast({ title: '请填写搭档账号', icon: 'none' })
    return
  }
  looking.value = true
  try {
    partner.value = await lookupPartner(partnerAccount.value.trim())
  } catch (e) {
    partner.value = null
    toastError(e, '查找失败')
  } finally {
    looking.value = false
  }
}

function clearPartner() {
  partner.value = null
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await enterTournament(id.value, {
      format: chosen.value,
      partnerId: chosenMeta.value?.needPartner ? partner.value.userId : undefined,
      contact: contact.value.trim() || undefined,
    })
    uni.showToast({ title: '报名成功', icon: 'success' })
    setTimeout(() => navigateBack(), 800)
  } catch (e) {
    toastError(e, '报名失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <view v-if="!detail" class="state">加载中…</view>

    <template v-else>
      <view class="head">
        <text class="title">{{ detail.title }}</text>
        <text class="sub">
          每组 {{ detail.groupSize }} 队随机抽签 · 每组前 {{ detail.advancePerGroup }} 名晋级
        </text>
      </view>

      <view v-if="!available.length" class="block">
        <view class="empty">
          当前没有可报名的组别{{ detail.myEntries && detail.myEntries.length ? '，你已报过名' : '（各组别均已报满）' }}
        </view>
      </view>

      <template v-else>
        <view class="block">
          <view class="block-title">1 · 选择组别</view>
          <view
            v-for="f in available"
            :key="f.format"
            :class="['fmt', { on: chosen === f.format }]"
            @click="choose(f.format)"
          >
            <view class="fmt-head">
              <text class="dot" :class="{ on: chosen === f.format }" />
              <text class="fmt-name">{{ f.formatName }}</text>
              <text class="fmt-left">{{ f.maxEntries - f.entryCount }} 队名额</text>
            </view>
            <text class="fmt-tip">{{ TOURNAMENT_FORMAT[f.format].gender }} · 每队 {{ f.teamSize }} 人</text>
          </view>
        </view>

        <view v-if="chosenMeta && chosenMeta.needPartner" class="block">
          <view class="block-title">2 · 填写搭档</view>
          <view class="tip">双打需要和搭档一起参赛，请填写对方的注册账号</view>

          <view v-if="!partner" class="row">
            <input
              v-model="partnerAccount"
              class="input"
              placeholder="搭档的注册账号"
              placeholder-class="ph"
            />
            <view class="btn small" @click="searchPartner">{{ looking ? '查找中…' : '查找' }}</view>
          </view>

          <view v-else class="partner">
            <view
              v-if="partner.avatar"
              class="avatar avatar-img-wrap"
            >
              <SmartImage class="avatar-img" :src="partner.avatar" mode="aspectFill" />
            </view>
            <view v-else class="avatar" :style="{ background: AVATAR_COLORS[partner.userId % AVATAR_COLORS.length] }">
              {{ (partner.name || '?').charAt(0) }}
            </view>
            <view class="p-info">
              <text class="p-name">{{ partner.name }}</text>
              <text class="p-gender">{{ partner.gender === 1 ? '男' : partner.gender === 2 ? '女' : '性别未知' }}</text>
            </view>
            <text class="link" @click="clearPartner">重选</text>
          </view>

          <view v-if="genderHint" class="warn">{{ genderHint }}</view>
        </view>

        <view class="block">
          <view class="block-title">{{ chosenMeta && chosenMeta.needPartner ? '3' : '2' }} · 其他信息（选填）</view>
          <input v-model="contact" class="input full" placeholder="联系电话，方便赛务通知" placeholder-class="ph" />
        </view>

        <view class="tip-note">
          本赛事不计入ELO积分，报名与分组完全随机。
        </view>

        <view class="submit" :class="{ off: !canSubmit }" @click="submit">
          {{ submitting ? '提交中…' : '确认报名' }}
        </view>
      </template>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  padding: 14px 16px 40px;
}
.state {
  margin-top: 60px;
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
.head {
  padding: 16px;
  border-radius: 12px;
  background: #0c3125;
  color: #faf7f0;
}
.title {
  display: block;
  font-size: 17px;
  font-weight: 800;
}
.sub {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.9;
}
.block {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #e3e8e6;
  border-radius: 12px;
  background: #ffffff;
}
.block-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 800;
  color: #14665b;
}
.tip {
  font-size: 11px;
  color: #5a726d;
}
.empty {
  text-align: center;
  font-size: 13px;
  color: #5a726d;
}
.fmt {
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid #e3e8e6;
  border-radius: 10px;
}
.fmt:last-child {
  margin-bottom: 0;
}
.fmt.on {
  border-color: #14665b;
  background: #f4f8f6;
}
.fmt-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 14px;
  height: 14px;
  border: 1px solid #cfdfd9;
  border-radius: 50%;
}
.dot.on {
  border-width: 4px;
  border-color: #14665b;
}
.fmt-name {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.fmt-left {
  font-size: 11px;
  color: #5a726d;
}
.fmt-tip {
  display: block;
  margin-top: 4px;
  margin-left: 22px;
  font-size: 11px;
  color: #5a726d;
}
.row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e3e8e6;
  border-radius: 8px;
  font-size: 13px;
  background: #faf7f0;
}
.input.full {
  width: 100%;
}
.ph {
  color: #9aa8a4;
}
.btn.small {
  padding: 0 18px;
  height: 40px;
  line-height: 40px;
  border-radius: 8px;
  background: #14665b;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
}
.partner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 10px;
  border-radius: 10px;
  background: #f4f8f6;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
}
.avatar-img-wrap {
  background: transparent;
}
.avatar-img {
  width: 100%;
  height: 100%;
}
.p-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.p-name {
  font-size: 14px;
  font-weight: 700;
  color: #1a2e2a;
}
.p-gender {
  font-size: 11px;
  color: #5a726d;
}
.link {
  font-size: 12px;
  color: #b0483b;
}
.warn {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fdf3e3;
  font-size: 11px;
  color: #a06a12;
}
.tip-note {
  margin-top: 14px;
  text-align: center;
  font-size: 11px;
  color: #5a726d;
}
.submit {
  margin-top: 16px;
  padding: 12px 0;
  border-radius: 8px;
  background: #e5c84b;
  text-align: center;
  font-size: 14px;
  font-weight: 800;
  color: #1a2e2a;
}
.submit.off {
  background: #e3e8e6;
  color: #9aa8a4;
}
</style>