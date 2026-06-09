// 手绘风格简笔表情脸（线条用 currentColor，颜色由外层控制）。
// 7 种心情，每个 24x24。fill 元素（爱心/星星/眼点/张嘴）单独标 fill。
const FACES = {
  // 开心：微笑弧线眼 + 上扬嘴
  happy: (
    <>
      <path d="M6.5 10.8 Q8.5 8.8 10.5 10.8" />
      <path d="M13.5 10.8 Q15.5 8.8 17.5 10.8" />
      <path d="M8 14.5 Q12 18 16 14.5" />
    </>
  ),
  // 平静：横线眼 + 直线嘴
  calm: (
    <>
      <path d="M6.8 10.5 h3" />
      <path d="M14.2 10.5 h3" />
      <path d="M9 15 h6" />
    </>
  ),
  // 心动：爱心眼
  heart: (
    <>
      <path d="M8.5 11 C6.7 9.3 6.7 7.6 8.5 8.7 C10.3 7.6 10.3 9.3 8.5 11 Z" fill="currentColor" stroke="none" />
      <path d="M15.5 11 C13.7 9.3 13.7 7.6 15.5 8.7 C17.3 7.6 17.3 9.3 15.5 11 Z" fill="currentColor" stroke="none" />
      <path d="M9 14.6 Q12 17 15 14.6" />
    </>
  ),
  // 兴奋：星星眼 + 张嘴笑
  excited: (
    <>
      <path d="M8.5 7.4 Q8.5 9.8 10.9 9.8 Q8.5 9.8 8.5 12.2 Q8.5 9.8 6.1 9.8 Q8.5 9.8 8.5 7.4 Z" fill="currentColor" stroke="none" />
      <path d="M15.5 7.4 Q15.5 9.8 17.9 9.8 Q15.5 9.8 15.5 12.2 Q15.5 9.8 13.1 9.8 Q15.5 9.8 15.5 7.4 Z" fill="currentColor" stroke="none" />
      <path d="M8 14 Q12 18.5 16 14 Z" fill="currentColor" stroke="none" />
    </>
  ),
  // 难过：下弯眉 + 下弯嘴
  sad: (
    <>
      <path d="M6.5 8.3 L9.5 9.3" />
      <path d="M17.5 8.3 L14.5 9.3" />
      <circle cx="8" cy="11.4" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11.4" r="0.95" fill="currentColor" stroke="none" />
      <path d="M8 16 Q12 13.2 16 16" />
    </>
  ),
  // 焦虑：担忧眉 + 波浪嘴
  anxious: (
    <>
      <path d="M6.5 8.7 L9.5 8" />
      <path d="M17.5 8.7 L14.5 8" />
      <circle cx="8" cy="11.2" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11.2" r="0.95" fill="currentColor" stroke="none" />
      <path d="M8 15.2 q1.33 -1.4 2.67 0 t2.67 0 t2.67 0" />
    </>
  ),
  // 疲惫：闭眼 + 叹气嘴
  tired: (
    <>
      <path d="M6.5 10.4 Q8.5 12 10.5 10.4" />
      <path d="M13.5 10.4 Q15.5 12 17.5 10.4" />
      <path d="M9.3 15 q1.35 1.2 2.7 0 t2.7 0" />
    </>
  ),
}

export default function MoodFace({ mood, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {FACES[mood]}
    </svg>
  )
}
