// 加载失败的统一提示（替代"显示空列表假装没数据"）。
//
// 为什么需要：数据拉不到时如果只渲染"没有匹配的记忆"，和真的没有记忆长得一模一样，
// 手机上尤其吓人——会以为记忆丢了。这里按错误类型说人话，并给一个重试按钮。
import { RefreshCw, AlertTriangle } from 'lucide-react'

// 把技术错误翻译成"发生了什么 + 怎么办"
export function explainError(err) {
  const status = err?.status
  const msg = String(err?.message || '')
  if (status === 401 || status === 403) {
    return { title: '访问密钥不对', hint: '到设置页重新填写访问密钥就好，数据都在，没有丢。' }
  }
  if (status === 404) {
    return { title: '后端地址不对', hint: '接口没找到（404）。多半是后端地址配置有问题，喊 CC 看一眼。' }
  }
  if (status >= 500 || /1101|1102|Internal/i.test(msg)) {
    return { title: '后端出错了', hint: '服务端报错，稍等一下再重试；一直这样就喊 CC。数据本身没丢。' }
  }
  if (/Failed to fetch|NetworkError|network|超时|timeout/i.test(msg)) {
    return { title: '连不上后端', hint: '看看手机/电脑网络（或代理）是否正常，然后重试。数据都在云端，没有丢。' }
  }
  if (/部分数据加载失败/.test(msg)) {
    return { title: '数据没拉全', hint: '有一类数据没取到，已停下来避免显示半截内容。点重试通常就好了。' }
  }
  return { title: '加载失败', hint: msg ? `原因：${msg}` : '未知原因，点重试看看。数据都在云端，没有丢。' }
}

export default function LoadError({ err, onRetry, compact = false }) {
  const { title, hint } = explainError(err)
  return (
    <div className={'load-error' + (compact ? ' load-error--compact' : '')} role="alert">
      <div className="load-error__head">
        <AlertTriangle size={14} />
        <span>{title}</span>
      </div>
      <p className="load-error__hint">{hint}</p>
      {onRetry && (
        <button type="button" className="load-error__retry" onClick={onRetry}>
          <RefreshCw size={12} /> 重试
        </button>
      )}
    </div>
  )
}
