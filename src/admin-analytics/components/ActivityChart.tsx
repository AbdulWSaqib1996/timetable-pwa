import { useMemo, useState } from 'react'
import type { LegacyDaily } from '../lib/client'

interface Props {
  daily: LegacyDaily[] // oldest → newest
}

/**
 * Daily activity chart (A3 / ADM-04, §4.2): definite plot geometry, y-axis
 * from zero, date labels, new/returning legend and a SINGLE keyboard
 * navigator — the plot is one focusable element and arrow keys move the
 * selected day (no 62 tab stops). Values always exist as text: a visible
 * readout for the selection plus the full data table below the chart.
 */
export function ActivityChart({ daily }: Props) {
  const [selected, setSelected] = useState(daily.length - 1)
  const [tableOpen, setTableOpen] = useState(false)
  const max = useMemo(() => Math.max(1, ...daily.map((d) => d.active)), [daily])
  const sel = daily[Math.min(selected, daily.length - 1)]

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setSelected((i) => Math.min(daily.length - 1, i + 1))
    else if (e.key === 'ArrowLeft') setSelected((i) => Math.max(0, i - 1))
    else if (e.key === 'Home') setSelected(0)
    else if (e.key === 'End') setSelected(daily.length - 1)
    else return
    e.preventDefault()
  }

  const fmt = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <div className="chart-scroll">
      <div
        className="chart-plot"
        tabIndex={0}
        role="application"
        aria-label={`Daily active tokens chart, ${daily.length} days. Use left and right arrow keys to read each day; full values in the table below.`}
        onKeyDown={onKey}
      >
        <div className="chart-axis" style={{ bottom: '100%' }}>
          {max}
        </div>
        <div className="chart-axis" style={{ bottom: '75%' }}>
          {Math.round(max * 0.75)}
        </div>
        <div className="chart-axis" style={{ bottom: '50%' }}>
          {Math.round(max / 2)}
        </div>
        <div className="chart-axis" style={{ bottom: '25%' }}>
          {Math.round(max * 0.25)}
        </div>
        <div className="chart-axis" style={{ bottom: 0 }}>0</div>
        <div className="chart-bars">
          {daily.map((d, i) => {
            const newH = Math.round((d.newDevices / max) * 100)
            const retH = Math.round(((d.active - d.newDevices) / max) * 100)
            return (
              <div
                key={d.date}
                className={`chart-bar${i === selected ? ' selected' : ''}`}
                onClick={() => setSelected(i)}
                aria-hidden="true"
              >
                <div className="seg-returning" style={{ height: `${retH}%` }} />
                <div className="seg-new" style={{ height: `${newH}%` }} />
              </div>
            )
          })}
        </div>
      </div>
      <div className="chart-dates" aria-hidden="true">
        {daily.map((d, i) => (
          <span key={d.date}>{i % 5 === 0 || i === daily.length - 1 ? fmt(d.date) : ''}</span>
        ))}
      </div>
      </div>
      <p className="support" aria-hidden="true">
        <span className="legend-dot" style={{ background: 'var(--success)', marginLeft: 0 }} />
        new tokens
        <span className="legend-dot" style={{ background: 'var(--accent)' }} />
        returning
      </p>
      <p className="chart-readout" role="status">
        {sel
          ? `${sel.date}${sel.date === today ? ' (today, partial)' : ''}: ${sel.active} active — ${sel.newDevices} new, ${sel.active - sel.newDevices} returning, ${sel.installed} standalone reports`
          : 'No day selected.'}
      </p>
      <button type="button" onClick={() => setTableOpen((v) => !v)} aria-expanded={tableOpen}>
        {tableOpen ? 'Hide data table' : 'View data table'}
      </button>
      {tableOpen && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <caption>Daily values (UTC) — the accessible equivalent of the chart</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Active</th>
                <th scope="col">New</th>
                <th scope="col">Returning</th>
                <th scope="col">Standalone reports</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date}>
                  <th scope="row">{d.date}</th>
                  <td>{d.active}</td>
                  <td>{d.newDevices}</td>
                  <td>{d.active - d.newDevices}</td>
                  <td>{d.installed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
