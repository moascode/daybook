import { formatSignedMYR, type WhatChangedRow } from '@/modules/wallet/reports/insights'

interface WhatChangedProps {
  hasEnoughHistory: boolean
  rows: WhatChangedRow[]
  net: number
  explainsMostLabel: string | null
}

const MAX_BAR_PERCENT = 45

export function WhatChanged({ hasEnoughHistory, rows, net, explainsMostLabel }: WhatChangedProps) {
  const maxAbsDelta = Math.max(1, ...rows.map((r) => Math.abs(r.delta)))

  return (
    <section className="card card-pad c7" data-testid="what-changed">
      <div className="card-head">
        <div>
          <div className="card-title">What changed</div>
          <div className="card-sub">This month against your 12-month average</div>
        </div>
      </div>

      {!hasEnoughHistory ? (
        <p style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>Needs 3 months of history</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>This month was in line with your average.</p>
      ) : (
        <>
          {rows.map((row) => {
            const widthPct = (Math.abs(row.delta) / maxAbsDelta) * MAX_BAR_PERCENT
            const increase = row.delta > 0
            return (
              <div className="div-row" key={row.key} data-testid="what-changed-row">
                <span className="div-name">{row.label}</span>
                <div className="div-track">
                  <div
                    className="div-bar"
                    style={increase
                      ? { left: '50%', width: `${widthPct}%`, background: 'rgb(var(--neg))' }
                      : { right: '50%', width: `${widthPct}%`, background: 'rgb(var(--pos))' }}
                  />
                </div>
                <span className="div-val" style={{ color: increase ? 'rgb(var(--neg-fg))' : 'rgb(var(--pos-fg))' }}>
                  {formatSignedMYR(row.delta)}
                </span>
              </div>
            )
          })}
          <div className="divider" style={{ marginTop: 'auto' }} />
          <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }} data-testid="what-changed-net">
            Net effect: <b style={{ color: 'rgb(var(--fg))', fontWeight: 600 }}>{formatSignedMYR(net)}</b> versus a typical month.
            {explainsMostLabel && ` ${explainsMostLabel} alone explains most of it.`}
          </div>
        </>
      )}
    </section>
  )
}
