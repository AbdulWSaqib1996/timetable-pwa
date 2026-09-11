import { useEffect } from 'react'

/**
 * iOS Safari (and standalone PWAs) keep `position: fixed` elements where the
 * bottom of the screen WAS while the on-screen keyboard was open when the
 * focused input is removed from the page — the bottom navigation then floats
 * mid-screen (owner report, 11 Sep 2026). The fix is to position the nav from
 * the live visual viewport: `--vv-bottom-offset` is the height of the layout
 * viewport hidden below the visual one (the keyboard, or nothing). It is
 * recomputed on every visual-viewport resize/scroll, on window resize and
 * orientation change, and shortly after any focus change (keyboard animations
 * finish after the events fire), so it always settles back to 0.
 */
export const VV_OFFSET_VAR = '--vv-bottom-offset'

export function computeBottomOffset(): number {
  const vv = window.visualViewport
  if (!vv) return 0
  const hidden = window.innerHeight - vv.height - vv.offsetTop
  return Number.isFinite(hidden) && hidden > 1 ? Math.round(hidden) : 0
}

export function useVisualViewportOffset(): void {
  useEffect(() => {
    const root = document.documentElement
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = () => root.style.setProperty(VV_OFFSET_VAR, `${computeBottomOffset()}px`)
    const applySoon = () => {
      apply()
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 350)
    }
    apply()
    const vv = window.visualViewport
    vv?.addEventListener('resize', applySoon)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', applySoon)
    window.addEventListener('orientationchange', applySoon)
    document.addEventListener('focusin', applySoon)
    document.addEventListener('focusout', applySoon)
    return () => {
      if (timer) clearTimeout(timer)
      vv?.removeEventListener('resize', applySoon)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', applySoon)
      window.removeEventListener('orientationchange', applySoon)
      document.removeEventListener('focusin', applySoon)
      document.removeEventListener('focusout', applySoon)
      root.style.removeProperty(VV_OFFSET_VAR)
    }
  }, [])
}
