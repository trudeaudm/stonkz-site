function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/** Falling squares on successful filing — CSS `.confetti` + `@keyframes fall`. */
export function confetti() {
  const colors = ['#B7F0C6', '#FFD87A', '#FF8A3C', '#fff', '#6BF08E'] as const
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('div')
    c.className = 'confetti'
    c.style.left = Math.random() * 100 + 'vw'
    c.style.background = pick(colors)
    c.style.animationDuration = 2.2 + Math.random() * 2.5 + 's'
    c.style.animationDelay = Math.random() * 0.8 + 's'
    c.style.transform = `rotate(${Math.random() * 360}deg)`
    document.body.appendChild(c)
    setTimeout(() => c.remove(), 6000)
  }
}
