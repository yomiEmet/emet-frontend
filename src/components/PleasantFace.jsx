// 愉悦度 7 档手绘脸（线条用 currentColor，颜色由外层控制）。
// 与 MoodFace 同风格：24x24，嘴形曲率 + 眉毛从「非常不愉快」到「非常愉快」渐变。
const FACES = {
  // 1 非常不愉快：担忧眉（内低）+ 点眼 + 深皱嘴
  1: (
    <>
      <path d="M6.4 8.2 L9.6 9.7" />
      <path d="M17.6 8.2 L14.4 9.7" />
      <circle cx="8" cy="11.7" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11.7" r="0.95" fill="currentColor" stroke="none" />
      <path d="M7.8 16.6 Q12 12.6 16.2 16.6" />
    </>
  ),
  // 2 不愉快：轻担忧眉 + 点眼 + 皱嘴
  2: (
    <>
      <path d="M6.6 8.9 L9.4 9.9" />
      <path d="M17.4 8.9 L14.6 9.9" />
      <circle cx="8" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8.3 16 Q12 13.3 15.7 16" />
    </>
  ),
  // 3 有点不愉快：点眼 + 微皱嘴
  3: (
    <>
      <circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8.7 15.4 Q12 14.1 15.3 15.4" />
    </>
  ),
  // 4 平静：横线眼 + 直线嘴
  4: (
    <>
      <path d="M6.8 11 h2.4" />
      <path d="M14.8 11 h2.4" />
      <path d="M9 15 h6" />
    </>
  ),
  // 5 有点愉快：点眼 + 微笑
  5: (
    <>
      <circle cx="8" cy="10.8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10.8" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8.7 14.5 Q12 16 15.3 14.5" />
    </>
  ),
  // 6 愉快：弯弯笑眼 + 上扬嘴
  6: (
    <>
      <path d="M6.6 10.7 Q8 9.4 9.4 10.7" />
      <path d="M14.6 10.7 Q16 9.4 17.4 10.7" />
      <path d="M8 14 Q12 17 16 14" />
    </>
  ),
  // 7 非常愉快：弯笑眼 + 张嘴大笑
  7: (
    <>
      <path d="M6.5 10.5 Q8 9 9.5 10.5" />
      <path d="M14.5 10.5 Q16 9 17.5 10.5" />
      <path d="M7.5 13.7 Q12 18.6 16.5 13.7 Z" fill="currentColor" stroke="none" />
    </>
  ),
}

export default function PleasantFace({ level, size = 22 }) {
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
      {FACES[level] || FACES[4]}
    </svg>
  )
}
