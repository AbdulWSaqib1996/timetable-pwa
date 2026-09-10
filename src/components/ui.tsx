import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useModalA11y } from '../lib/a11y'
import { useAttention } from '../lib/attention'

/**
 * Phase 4 shared primitives (P4-01). Small, semantic and token-driven — one
 * consistent SVG icon family (1.8px stroke outline) instead of mixed emoji.
 */

/* ---------- icons ---------- */

interface IconProps {
  size?: number
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const IconToday = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
  </svg>
)

export const IconSchedule = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </svg>
)

export const IconTasks = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 6.5l1.6 1.6L8.6 5M4 12.5l1.6 1.6 3-3.1M4 18.5l1.6 1.6 3-3.1" />
    <path d="M12 6.5h8M12 12.5h8M12 18.5h8" />
  </svg>
)

export const IconPGCE = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M12 4.5L2.8 9l9.2 4.5L21.2 9z" />
    <path d="M6.5 11.5v5c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-5M21.2 9v5" />
  </svg>
)

export const IconSettings = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
  </svg>
)

export const IconBell = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6zM10 19a2.2 2.2 0 0 0 4 0" />
  </svg>
)

export const IconSearch = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4" />
  </svg>
)

export const IconRefresh = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M20 5v5h-5" />
    <path d="M19.4 13a7.6 7.6 0 1 1-1.6-6.3L20 9" />
  </svg>
)

export const IconBack = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
)

export const IconHome = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.8v-6h-4.4v6H5a1 1 0 0 1-1-1z" />
  </svg>
)

export const IconPlus = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const IconClose = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const IconEdit = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M13.5 7.5l3 3" />
  </svg>
)
export const IconPrint = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M7 9V4h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
    <path d="M7 14h10v6H7z" />
  </svg>
)
export const IconChart = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)
export const IconSchool = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M12 12h.01" />
  </svg>
)

/* ---------- primitives ---------- */

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { label: string; onBack: () => void }
}) {
  return (
    <header className="page-header">
      {back && (
        <button type="button" className="page-back" onClick={back.onBack}>
          <IconBack size={18} /> {back.label}
        </button>
      )}
      <div className="page-header-row">
        {/* Focus target for route changes (R3 / §5): the shell moves focus
            here when the destination changes, never on a routine refresh. */}
        <h1 className="page-title" tabIndex={-1}>
          {title}
        </h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </header>
  )
}

/**
 * The same labelled Settings action in every primary page header (TT-19).
 * Hidden from 1024px, where the sidebar footer carries Settings.
 */
export function SettingsAction({ onOpen }: { onOpen: () => void }) {
  const attention = useAttention()
  const label = attention.length > 0 ? `Settings — ${attention.length} item${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} attention` : 'Settings'
  return (
    <button type="button" className="btn-icon page-settings-action" onClick={onOpen} aria-label={label} title={label}>
      <IconSettings />
      {attention.length > 0 && <span className="attention-dot" aria-hidden="true" />}
    </button>
  )
}

/**
 * A small action menu (R3 / TT-20, §5 interaction rules): one dominant
 * trigger, a `menu` of `menuitem`s, Escape closes and returns focus, arrow
 * keys move, clicking outside closes. Choosing an item closes the menu first
 * so the chosen action can move focus wherever it opens.
 */
export function QuickMenu({
  label,
  items,
  tone = 'primary',
}: {
  label: string
  items: { label: string; onSelect: () => void }[]
  tone?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])
  const onKey = (e: KeyboardEvent) => {
    const els = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(i + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(i - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }
  return (
    <div className="quick-menu">
      <button
        ref={buttonRef}
        type="button"
        className={tone === 'primary' ? 'btn-primary' : 'btn-secondary'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>
      {open && (
        <ul ref={listRef} id={id} role="menu" aria-label={label} className="quick-menu-list" onKeyDown={onKey}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className="quick-menu-item"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Card({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode
  tone?: 'default' | 'accent'
  className?: string
}) {
  return <div className={`ui-card${tone === 'accent' ? ' ui-card--accent' : ''} ${className}`.trim()}>{children}</div>
}

export function StatusMessage({
  tone,
  children,
  onDismiss,
}: {
  tone: 'info' | 'success' | 'danger'
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div className={`status-message status-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className="btn-icon" aria-label="Dismiss" onClick={onDismiss}>
          ✕
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
      {action}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={`segment${value === opt.value ? ' segment-on' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="ui-field">
      <span className="ui-field-label">{label}</span>
      {children}
      {hint && <span className="filter-hint">{hint}</span>}
    </label>
  )
}

/** Accessible modal wrapper (focus trap + Escape via lib/a11y). */
export function Dialog({
  label,
  onClose,
  children,
  className = '',
}: {
  label: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const ref = useModalA11y<HTMLDivElement>(onClose)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={ref}
        className={`modal-card sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
