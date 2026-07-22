// 发图前压缩：最长边 1280、JPEG 0.82——手机原图几 MB 压到几百 KB。
// 后端 KV 存 base64 且设了 2MB 硬上限，发布前必须过这一道。
// iOS 的 HEIC 经 <input type="file"> 选取时 Safari 会自动转 JPEG，这里不用特判。
export async function compressImage(file, { maxEdge = 1280, quality = 0.82 } = {}) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片读取失败'))
      el.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return { data: dataUrl.split(',')[1], media_type: 'image/jpeg', preview: dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}
