import { useEffect } from 'react'

/**
 * iOS Safari (and standalone PWAs) can leave a `position: fixed` element where
 * the bottom of the screen WAS while the on-screen keyboard was open, and can
 * keep reporting a shrunken visual viewport after the keyboard has gone — the
 * bottom navigation then floats mid-screen (owner reports, 11 Sep 2026, twice).
 *
 * Rule: `--vv-bottom-offset` (the layout height hidden below the visual
 * viewport) is applied ONLY while an editable element has focus — the only
 * time a keyboard can be open — and only at no pinch zoom. With nothing
 * focused the offset is 0 whatever the viewport reports, and a reflow nudge
 * after focus leaves lets WebKit re-anchor the fixed element. Recomputed on
 * visual-viewport resize/scroll, window resize, orientation change and shortly
 * after any focus change (keyboard animations finish after the events fire).
 */
export const VV_OFFSET_VAR = '--vv-bottom-offset'

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

export function keyboardCanBeOpen(): boolean {
  const el = document.activeElement
  return !!el && el !== document.body && (el as Element).matches?.(EDITABLE) === true
}

export function computeBottomOffset(): number {
  const vv = window.visualViewport
  if (!vv || !keyboardCanBeOpen()) return 0
  if (typeof vv.scale === 'number' && Math.abs(vv.scale - 1) > 0.01) return 0
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
    // After focus leaves an input, force the fixed nav to re-anchor: toggle a
    // compositing hint for one frame (cheap, invisible) once the keyboard has closed.
    const nudge = () => {
      applySoon()
      setTimeout(() => {
        apply()
        root.classList.add('vv-reflow')
        requestAnimationFrame(() => root.classList.remove('vv-reflow'))
      }, 400)
    }
    apply()
    const vv = window.visualViewport
    vv?.addEventListener('resize', applySoon)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', applySoon)
    window.addEventListener('orientationchange', applySoon)
    document.addEventListener('focusin', applySoon)
    document.addEventListener('focusout', nudge)
    return () => {
      if (timer) clearTimeout(timer)
      vv?.removeEventListener('resize', applySoon)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', applySoon)
      window.removeEventListener('orientationchange', applySoon)
      document.removeEventListener('focusin', applySoon)
      document.removeEventListener('focusout', nudge)
      root.style.removeProperty(VV_OFFSET_VAR)
    }
  }, [])
}
