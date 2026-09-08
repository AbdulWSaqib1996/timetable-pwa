import { useEffect, useState } from 'react'

interface Props {
  text: string
  label?: string
}

/**
 * Clipboard action with honest feedback (R2 / TT-17): "Address copied" only
 * after the write resolves; on failure the text is exposed selectable with
 * "Copy unavailable here" so manual copying always works. Copying is never
 * treated as navigation.
 */
export function CopyButton({ text, label = 'Copy address' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 4000)
    return () => clearTimeout(t)
  }, [state])
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unsupported')
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <span className="copy-button">
      <button type="button" className="travel-link copy-address" onClick={() => void copy()}>
        {label}
      </button>
      <span className="filter-hint" role="status" aria-live="polite">
        {state === 'copied' ? ' Address copied' : state === 'failed' ? ' Copy unavailable here — select the text to copy it:' : ''}
      </span>
      {state === 'failed' && (
        <span className="copy-fallback" style={{ userSelect: 'all' }}>
          {text}
        </span>
      )}
    </span>
  )
}
