'use client'

/**
 * /po-test — a radical, self-contained re-imagining of the supplier PO page.
 *
 * Deliberately NOT built from the project's UI kit: no Card / Button /
 * StatCard / Badge, no palette tokens, no Tailwind theme classes. The whole
 * look lives in one scoped stylesheet below («سند»: an ink cover sheet, a
 * paper ledger, a receipt for the totals, a typographic rail).
 *
 * Sample data only — nothing is read from or written to Supabase, and no
 * other file in the project is imported or modified.
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react'

/* ────────────────────────────── data ────────────────────────────── */

const VAT_RATE = 0.15

interface Unit {
  id: string
  code: string
  type: string
  plate: string | null
  chassis: string | null
  supplier: string
  ownership: string
  periodFrom: string
  periodTo: string | null
  price: number | null
  note: string | null
}

const PO = {
  number: 'SPO260011',
  party: 'مؤسسة النخبة لتاجير المعدات',
  company: 'شركة عبدالله العزاني للمقاولات',
  project: 'مشروع طريق الملك فهد',
  startDate: '2026-09-01',
  createdBy: 'سارة المطيري',
  createdAt: '2026-09-02 08:15',
  notes: 'الاسعار لا تشمل ضريبة القيمة المضافة. الاحتساب شهري على 260 ساعة قياسية.',
}

const SEED_UNITS: Unit[] = [
  {
    id: 'u1',
    code: 'A055',
    type: 'BOOM TRUCK 10 TON',
    plate: 'ا ب ج 8631',
    chassis: null,
    supplier: 'شركة عبدالله العزاني للمقاولات',
    ownership: 'العزاني',
    periodFrom: '2026-09-01',
    periodTo: null,
    price: 4200,
    note: null,
  },
  {
    id: 'u2',
    code: 'F112',
    type: 'EXCAVATOR CAT 320',
    plate: null,
    chassis: 'CAT0320DXK1234567',
    supplier: 'مؤسسة النخبة لتاجير المعدات',
    ownership: 'مورد خارجي',
    periodFrom: '2026-09-03',
    periodTo: '2026-09-30',
    price: 7800,
    note: 'سعر تفاوضي لاربع وحدات.',
  },
  {
    id: 'u3',
    code: 'G240',
    type: 'WHEEL LOADER 966',
    plate: 'د هـ و 4412',
    chassis: null,
    supplier: 'مؤسسة النخبة لتاجير المعدات',
    ownership: 'مورد خارجي',
    periodFrom: '2026-09-08',
    periodTo: null,
    price: null,
    note: 'بانتظار عرض السعر من المورد.',
  },
  {
    id: 'u4',
    code: 'B031',
    type: 'FORKLIFT 5 TON',
    plate: 'ر ز س 1180',
    chassis: null,
    supplier: 'مؤسسة الرواد للنقليات',
    ownership: 'مورد خارجي',
    periodFrom: '2026-09-15',
    periodTo: null,
    price: 2600,
    note: 'السعر شامل الوقود.',
  },
  {
    id: 'u5',
    code: 'E778',
    type: 'MOTOR GRADER 140K',
    plate: null,
    chassis: 'CAT0140KAB98765',
    supplier: 'شركة الخليج للمعدات الثقيلة',
    ownership: 'مورد خارجي',
    periodFrom: '2026-09-20',
    periodTo: null,
    price: 11400,
    note: null,
  },
  {
    id: 'u6',
    code: 'C509',
    type: 'WATER TANKER 18M3',
    plate: 'ع ف ق 7745',
    chassis: null,
    supplier: 'مؤسسة النخبة لتاجير المعدات',
    ownership: 'مورد خارجي',
    periodFrom: '2026-10-12',
    periodTo: null,
    price: 3050,
    note: null,
  },
]

interface Event {
  id: string
  when: string
  kind: string
  detail: string
  actor: string
}

const SEED_EVENTS: Event[] = [
  {
    id: 'ev1',
    when: '2026-10-18 14:22',
    kind: 'تعديل سعر',
    detail: 'E778 · 10,800 ← 11,400',
    actor: 'سارة المطيري',
  },
  {
    id: 'ev2',
    when: '2026-10-12 09:05',
    kind: 'اضافة وحدة',
    detail: 'C509 · WATER TANKER 18M3',
    actor: 'سارة المطيري',
  },
  {
    id: 'ev3',
    when: '2026-10-03 11:40',
    kind: 'اضافة وحدة',
    detail: 'B031 · FORKLIFT 5 TON',
    actor: 'خالد الحربي',
  },
  {
    id: 'ev4',
    when: '2026-09-02 08:15',
    kind: 'انشاء السند',
    detail: 'ست وحدات باسم المورد',
    actor: 'سارة المطيري',
  },
]

/* ──────────────────────────── helpers ──────────────────────────── */

const money = (value: number) =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const shortDate = (iso: string) => iso.split('-').reverse().join('/')

/* ───────────────────────────── the page ───────────────────────────── */

type SortKey = 'as-is' | 'price-asc' | 'price-desc' | 'period'
type View = 'sheet' | 'ledger'

interface PoState {
  units: Unit[]
  events: Event[]
  status: 'open' | 'closed'
  locked: boolean
  total: number
  vat: number
  grand: number
  unpriced: number
  savePrice: (unitId: string, value: number) => void
  closePo: () => void
}

/** One source of truth for every variant: a price edited in one tab is the
 *  price every other tab shows, and closing the PO locks them all. */
function usePo(): PoState {
  const [units, setUnits] = useState<Unit[]>(SEED_UNITS)
  const [events, setEvents] = useState<Event[]>(SEED_EVENTS)
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const total = units.reduce((sum, unit) => sum + (unit.price ?? 0), 0)
  const vat = total * VAT_RATE
  const unpriced = units.filter((unit) => unit.price === null).length
  const locked = status === 'closed'

  const savePrice = (unitId: string, value: number) => {
    if (locked || !Number.isFinite(value) || value <= 0) return
    const unit = units.find((row) => row.id === unitId)
    if (!unit) return
    const previous = unit.price
    setUnits((current) =>
      current.map((row) => (row.id === unitId ? { ...row, price: value } : row)),
    )
    setEvents((current) => [
      {
        id: `ev-${Date.now()}`,
        when: 'الان',
        kind: previous === null ? 'تحديد سعر' : 'تعديل سعر',
        detail: `${unit.code} · ${
          previous === null ? 'بدون سعر' : money(previous)
        } ← ${money(value)}`,
        actor: PO.createdBy,
      },
      ...current,
    ])
  }

  const closePo = () => {
    if (locked) return
    setStatus('closed')
    setEvents((current) => [
      {
        id: `ev-${Date.now()}`,
        when: 'الان',
        kind: 'اغلاق السند',
        detail: `المجموع ${money(total)} ر.س`,
        actor: PO.createdBy,
      },
      ...current,
    ])
  }

  return {
    units,
    events,
    status,
    locked,
    total,
    vat,
    grand: total + vat,
    unpriced,
    savePrice,
    closePo,
  }
}

/* ── 01 · «سند»: ink cover + paper ledger ─────────────────────────── */

function SheetVariant({ po }: { po: PoState }) {
  const { units, events, status, total, vat, unpriced, locked } = po
  const [openId, setOpenId] = useState<string | null>(SEED_UNITS[0].id)
  const [view, setView] = useState<View>('sheet')
  const [sort, setSort] = useState<SortKey>('as-is')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)

  const ordered = useMemo(() => {
    const list = [...units]
    switch (sort) {
      case 'price-asc':
        return list.sort((a, b) => (a.price ?? -1) - (b.price ?? -1))
      case 'price-desc':
        return list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1))
      case 'period':
        return list.sort((a, b) => a.periodFrom.localeCompare(b.periodFrom))
      default:
        return list
    }
  }, [units, sort])

  const beginEdit = (unit: Unit) => {
    setEditingId(unit.id)
    setDraft(unit.price === null ? '' : String(unit.price))
  }

  const savePrice = (unit: Unit) => {
    const value = Number(draft.replace(/[^\d.]/g, ''))
    po.savePrice(unit.id, value)
    setEditingId(null)
  }

  const closePo = () => {
    po.closePo()
    setConfirmClose(false)
  }

  const actions = (
    <>
      <button
        className="pt-btn pt-btn--solid"
        type="button"
        disabled={locked}
        title="نموذج تجريبي: الاضافة غير موصولة بقاعدة البيانات"
      >
        اضف وحدة
      </button>
      <button
        className="pt-btn pt-btn--danger"
        type="button"
        disabled={locked}
        onClick={() => setConfirmClose(true)}
      >
        اغلاق السند
      </button>
    </>
  )

  return (
    <main className="pt-shell" dir="rtl">
      <style>{styles}</style>

      {/* ── cover sheet ───────────────────────────────────────────── */}
      <header className="pt-cover">
        <div className="pt-cover__top">
          <div className="pt-cover__id">
            <span className="pt-kicker">سند شراء · PURCHASE ORDER</span>
            <a className="pt-back" href="/purchasing/orders">
              <span aria-hidden="true">→</span> اوامر الشراء
            </a>
          </div>
          <span className="pt-stamp" data-status={status}>
            {status === 'open' ? 'مفتوح' : 'مغلق'}
          </span>
        </div>

        <div className="pt-cover__grid">
          <div className="pt-cover__headline">
            <span className="pt-label">رقم السند</span>
            <h1 className="pt-number">
              <bdi dir="ltr">{PO.number}</bdi>
            </h1>
            <span className="pt-number__rule" aria-hidden="true" />
            <p className="pt-party">
              <span className="pt-label">الطرف</span>
              {PO.party}
            </p>
          </div>

          <dl className="pt-cover__meta">
            <div>
              <dt>الشركة</dt>
              <dd>{PO.company}</dd>
            </div>
            <div>
              <dt>المشروع</dt>
              <dd>{PO.project}</dd>
            </div>
            <div>
              <dt>تاريخ البدء</dt>
              <dd className="pt-num">
                <bdi dir="ltr">{shortDate(PO.startDate)}</bdi>
              </dd>
            </div>
            <div>
              <dt>انشاه</dt>
              <dd>{PO.createdBy}</dd>
            </div>
            <div>
              <dt>تاريخ الانشاء</dt>
              <dd className="pt-num">
                <bdi dir="ltr">{PO.createdAt}</bdi>
              </dd>
            </div>
          </dl>
        </div>

        <div className="pt-cover__bar">
          <div className="pt-cover__actions">{actions}</div>
          <p className="pt-cover__note">{PO.notes}</p>
        </div>

        {confirmClose && (
          <div className="pt-confirm" role="alertdialog" aria-label="تاكيد اغلاق السند">
            <div>
              <p className="pt-confirm__title">اغلاق السند نهائيا؟</p>
              <p className="pt-confirm__text">
                لا يمكن اضافة وحدات او تعديل الاسعار بعد الاغلاق.
              </p>
            </div>
            <div className="pt-confirm__actions">
              <button className="pt-btn pt-btn--solid" type="button" onClick={closePo}>
                نعم، اغلقه
              </button>
              <button
                className="pt-btn pt-btn--ghost"
                type="button"
                onClick={() => setConfirmClose(false)}
              >
                تراجع
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── figures ──────────────────────────────────────────────── */}
      <section className="pt-metrics" aria-label="ارقام السند">
        <div className="pt-metric">
          <span className="pt-metric__label">الوحدات</span>
          <span className="pt-metric__value">{units.length}</span>
          <span className="pt-metric__hint">
            {unpriced > 0 ? `${unpriced} بدون سعر` : 'كل الوحدات مسعّرة'}
          </span>
        </div>
        <div className="pt-metric">
          <span className="pt-metric__label">الاجمالي قبل الضريبة</span>
          <span className="pt-metric__value" dir="ltr">
            {money(total)}
          </span>
          <span className="pt-metric__hint">ريال سعودي</span>
        </div>
        <div className="pt-metric">
          <span className="pt-metric__label">ضريبة القيمة المضافة 15%</span>
          <span className="pt-metric__value" dir="ltr">
            {money(vat)}
          </span>
          <span className="pt-metric__hint">تضاف على الفاتورة</span>
        </div>
        <div className="pt-metric pt-metric--accent">
          <span className="pt-metric__label">الاجمالي مع الضريبة</span>
          <span className="pt-metric__value" dir="ltr">
            {money(total + vat)}
          </span>
          <span className="pt-metric__hint">قيمة السند</span>
        </div>
      </section>

      {/* ── ledger + rail ────────────────────────────────────────── */}
      <div className="pt-body">
        <section className="pt-ledger">
          <div className="pt-ledger__head">
            <h2 className="pt-ledger__title">
              وحدات السند
              <sup className="pt-count">{units.length}</sup>
            </h2>
            <div className="pt-tools">
              <div className="pt-seg" role="group" aria-label="طريقة العرض">
                <button
                  type="button"
                  data-active={view === 'sheet'}
                  onClick={() => setView('sheet')}
                >
                  ورقة
                </button>
                <button
                  type="button"
                  data-active={view === 'ledger'}
                  onClick={() => setView('ledger')}
                >
                  كشف
                </button>
              </div>
              <label className="pt-sort">
                <span>ترتيب</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                >
                  <option value="as-is">كما ادخلت</option>
                  <option value="price-asc">السعر: الاقل</option>
                  <option value="price-desc">السعر: الاعلى</option>
                  <option value="period">تاريخ البدء</option>
                </select>
              </label>
            </div>
          </div>

          {view === 'sheet' ? (
            <ol className="pt-rows">
              {ordered.map((unit, index) => {
                const open = openId === unit.id
                return (
                  <li key={unit.id} className="pt-row" data-open={open}>
                    <button
                      type="button"
                      className="pt-row__main"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : unit.id)}
                    >
                      <span className="pt-row__index">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="pt-row__unit">
                        <span className="pt-row__line">
                          <span className="pt-row__code">{unit.code}</span>
                          <span className="pt-row__type">{unit.type}</span>
                        </span>
                        <span className="pt-row__meta">
                          <span className="pt-row__sub">
                            {unit.plate ?? unit.chassis ?? '—'}
                          </span>
                          <span aria-hidden="true" className="pt-row__dot">
                            ·
                          </span>
                          <span className="pt-row__period">
                            <span dir="ltr" className="pt-num">
                              {shortDate(unit.periodFrom)}
                            </span>
                            <span aria-hidden="true" className="pt-row__dash" />
                            {unit.periodTo ? (
                              <span dir="ltr" className="pt-num">
                                {shortDate(unit.periodTo)}
                              </span>
                            ) : (
                              <span className="pt-open-end">مفتوح</span>
                            )}
                          </span>
                        </span>
                      </span>
                      <span className="pt-row__price">
                        {unit.price === null ? (
                          <span className="pt-row__missing">بلا سعر</span>
                        ) : (
                          <>
                            <span dir="ltr" className="pt-num">
                              {money(unit.price)}
                            </span>
                            <span className="pt-cur">ر.س</span>
                          </>
                        )}
                      </span>
                      <span className="pt-row__toggle" aria-hidden="true">
                        {open ? '−' : '+'}
                      </span>
                    </button>

                    {open && (
                      <div className="pt-row__panel">
                        <div className="pt-row__facts">
                          <p>
                            <span className="pt-label">المورد</span>
                            {unit.supplier}
                          </p>
                          <p>
                            <span className="pt-label">الملكية</span>
                            {unit.ownership}
                          </p>
                          <p className="pt-row__wide">
                            <span className="pt-label">ملاحظة</span>
                            {unit.note ?? 'لا توجد ملاحظة على هذه الوحدة.'}
                          </p>
                        </div>
                        <div className="pt-row__act">
                          {editingId === unit.id ? (
                            <div className="pt-edit">
                              <label className="pt-edit__field">
                                <span className="pt-label">السعر قبل الضريبة</span>
                                <span className="pt-edit__input">
                                  <input
                                    autoFocus
                                    inputMode="decimal"
                                    value={draft}
                                    dir="ltr"
                                    aria-label="السعر قبل الضريبة"
                                    onChange={(event) => setDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') savePrice(unit)
                                      if (event.key === 'Escape') setEditingId(null)
                                    }}
                                  />
                                  <span className="pt-cur">ر.س</span>
                                </span>
                              </label>
                              <div className="pt-edit__actions">
                                <button
                                  className="pt-btn pt-btn--solid pt-btn--sm"
                                  type="button"
                                  onClick={() => savePrice(unit)}
                                >
                                  حفظ
                                </button>
                                <button
                                  className="pt-btn pt-btn--ghost pt-btn--sm"
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                >
                                  إلغاء
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="pt-btn pt-btn--ghost pt-btn--sm"
                              type="button"
                              disabled={locked}
                              onClick={() => beginEdit(unit)}
                            >
                              {unit.price === null ? 'تحديد السعر' : 'تعديل السعر'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="pt-table__wrap">
              <table className="pt-table">
                <thead>
                  <tr>
                    <th aria-label="رقم" />
                    <th>الوحدة</th>
                    <th>المورد</th>
                    <th>من</th>
                    <th>الى</th>
                    <th className="num">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((unit, index) => (
                    <tr key={unit.id}>
                      <td className="pt-table__index">
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td>
                        <span className="pt-row__code" dir="ltr">
                          {unit.code}
                        </span>
                        <span className="pt-row__type"> {unit.type}</span>
                      </td>
                      <td className="pt-table__muted">{unit.supplier}</td>
                      <td className="num">
                        <bdi dir="ltr">{shortDate(unit.periodFrom)}</bdi>
                      </td>
                      <td className="num">
                        <bdi dir="ltr">
                          {unit.periodTo ? shortDate(unit.periodTo) : '—'}
                        </bdi>
                      </td>
                      <td className="num">
                        {unit.price === null ? (
                          <span className="pt-row__missing">بلا سعر</span>
                        ) : (
                          money(unit.price)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* the totals as a till receipt */}
          <div className="pt-receipt">
            <p className="pt-receipt__caption">خلاصة السند</p>
            <div className="pt-lead">
              <span>
                {units.length} وحدة {unpriced > 0 ? `(${unpriced} بلا سعر)` : ''}
              </span>
              <span className="pt-lead__dots" aria-hidden="true" />
              <span className="pt-num" dir="ltr">
                {money(total)}
              </span>
            </div>
            <div className="pt-lead">
              <span>ضريبة القيمة المضافة 15%</span>
              <span className="pt-lead__dots" aria-hidden="true" />
              <span className="pt-num" dir="ltr">
                {money(vat)}
              </span>
            </div>
            <div className="pt-receipt__total">
              <span>الاجمالي</span>
              <span className="pt-receipt__sum" dir="ltr">
                {money(total + vat)}
                <span className="pt-cur">ر.س</span>
              </span>
            </div>
          </div>
        </section>

        {/* ── rail: facts + events ─────────────────────────────── */}
        <aside className="pt-rail">
          <section>
            <h2 className="pt-rail__title">بطاقة السند</h2>
            <dl className="pt-facts">
              <div>
                <dt>المرجع</dt>
                <dd className="pt-num">
                  <bdi dir="ltr">{PO.number}</bdi>
                </dd>
              </div>
              <div>
                <dt>المورد</dt>
                <dd>{PO.party}</dd>
              </div>
              <div>
                <dt>الشركة / المشروع</dt>
                <dd>
                  {PO.company}
                  <span className="pt-facts__sub">{PO.project}</span>
                </dd>
              </div>
              <div>
                <dt>الحالة</dt>
                <dd className={status === 'open' ? 'pt-state' : 'pt-state pt-state--off'}>
                  {status === 'open' ? 'مفتوح للاضافة' : 'مغلق'}
                </dd>
              </div>
              <div>
                <dt>الوحدات</dt>
                <dd className="pt-num">{units.length}</dd>
              </div>
              <div>
                <dt>انشاه</dt>
                <dd>{PO.createdBy}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="pt-rail__title">مسار السند</h2>
            <ol className="pt-timeline">
              {events.map((event, index) => (
                <li key={event.id} data-latest={index === 0}>
                  <span className="pt-tick__when" dir="ltr">
                    {event.when}
                  </span>
                  <span className="pt-tick__kind">{event.kind}</span>
                  <span className="pt-tick__detail">{event.detail}</span>
                  <span className="pt-tick__actor">{event.actor}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <footer className="pt-colophon">
        <span>سند شراء · نموذج تجريبي لاعادة تصميم صفحة اوامر الشراء</span>
        <span>بيانات وهمية · /po-test</span>
      </footer>

      <div className="pt-mobile-bar">{actions}</div>
    </main>
  )
}

/* ───────────────────────────── styles ───────────────────────────── */

const styles = `
@font-face {
  font-family: 'PoTestMono';
  src: url('https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.2.5/files/jetbrains-mono-latin-wght-normal.woff2') format('woff2');
  font-weight: 100 800;
  font-style: normal;
  font-display: swap;
}

.pt-shell {
  --ink: #16130f;
  --ink-soft: #57503f;
  --paper: #efe9dd;
  --paper-2: #e5ddcd;
  --card: #f8f4ea;
  --rule: rgba(22, 19, 15, 0.16);
  --rule-strong: rgba(22, 19, 15, 0.44);
  --verm: #b23a1d;
  --moss: #4d5a35;
  --on-ink: #efe9dd;
  --display: 'Thmanyah Serif Display', 'Thmanyah', Georgia, serif;
  --sans: 'Thmanyah', 'Segoe UI', Tahoma, system-ui, sans-serif;
  --mono: 'PoTestMono', ui-monospace, SFMono-Regular, Menlo, monospace;
  min-height: 100dvh;
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.5;
  position: relative;
  isolation: isolate;
  -webkit-font-smoothing: antialiased;
}

/* paper grain */
.pt-shell::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.55), transparent 42%),
    radial-gradient(circle at 82% 78%, rgba(178, 58, 29, 0.05), transparent 46%),
    repeating-linear-gradient(90deg, rgba(22, 19, 15, 0.028) 0 1px, transparent 1px 96px);
}
.pt-shell > * { position: relative; z-index: 1; }

.pt-shell button { font: inherit; }
.pt-shell :focus-visible { outline: 2px solid var(--verm); outline-offset: 3px; }

.pt-label {
  display: block;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-bottom: 5px;
}
.pt-num { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.pt-cur { font-family: var(--mono); font-size: 0.62em; color: var(--ink-soft); margin-inline-start: 5px; letter-spacing: 0.02em; }

/* ── cover ─────────────────────────────────────────────────────── */
.pt-cover {
  background: var(--ink);
  color: var(--on-ink);
  padding: 22px clamp(18px, 4.5vw, 64px) 0;
  position: relative;
  overflow: hidden;
}
.pt-cover::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(90deg, rgba(239, 233, 221, 0.055) 0 1px, transparent 1px 72px),
    linear-gradient(180deg, rgba(239, 233, 221, 0.05), transparent 38%);
}
.pt-cover::after {
  content: '';
  position: absolute;
  inset-inline-end: -120px;
  top: -160px;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  border: 1px solid rgba(239, 233, 221, 0.09);
  box-shadow: 0 0 0 40px rgba(239, 233, 221, 0.02), 0 0 0 120px rgba(239, 233, 221, 0.015);
  pointer-events: none;
}

.pt-cover__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(239, 233, 221, 0.18);
}
.pt-cover__id { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; }
.pt-kicker {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(239, 233, 221, 0.62);
}
.pt-back {
  font-size: 12.5px;
  color: rgba(239, 233, 221, 0.78);
  text-decoration: none;
  border-bottom: 1px solid rgba(239, 233, 221, 0.32);
  padding-bottom: 1px;
  transition: color 0.15s, border-color 0.15s;
}
.pt-back:hover { color: var(--on-ink); border-color: var(--on-ink); }

.pt-stamp {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  padding: 6px 14px;
  border: 1.5px solid currentColor;
  transform: rotate(-4deg);
  color: #c9d4ac;
  white-space: nowrap;
}
.pt-stamp[data-status='closed'] { color: #dda08c; }

.pt-cover__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(230px, 330px);
  gap: clamp(22px, 4vw, 64px);
  padding-block: clamp(26px, 5vw, 46px);
  align-items: start;
}
.pt-cover__headline .pt-label { color: rgba(239, 233, 221, 0.55); }
.pt-number {
  display: inline-block;
  direction: ltr;
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(42px, 8.5vw, 96px);
  line-height: 0.92;
  letter-spacing: -0.05em;
  margin: 0;
  color: var(--on-ink);
  animation: pt-rise 0.5s ease-out both;
}
.pt-number__rule {
  display: block;
  width: 74px;
  height: 3px;
  background: var(--verm);
  margin-block: 18px 22px;
}
.pt-party {
  font-family: var(--display);
  font-size: clamp(19px, 2.3vw, 29px);
  line-height: 1.35;
  margin: 0;
  max-width: 22ch;
}
.pt-party .pt-label { color: rgba(239, 233, 221, 0.5); margin-bottom: 8px; }

.pt-cover__meta { margin: 0; border-top: 1px solid rgba(239, 233, 221, 0.2); }
.pt-cover__meta > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(239, 233, 221, 0.11);
}
.pt-cover__meta dt {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(239, 233, 221, 0.5);
  white-space: nowrap;
}
.pt-cover__meta dd {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  text-align: end;
}
.pt-cover__meta .pt-num { font-size: 12px; letter-spacing: 0; }

.pt-cover__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-block: 14px 18px;
  border-top: 1px solid rgba(239, 233, 221, 0.18);
  flex-wrap: wrap;
}
.pt-cover__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pt-cover__note {
  margin: 0;
  font-size: 11.5px;
  color: rgba(239, 233, 221, 0.5);
  max-width: 46ch;
}

/* buttons */
.pt-btn {
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 9px 18px;
  border: 1px solid rgba(239, 233, 221, 0.4);
  background: transparent;
  color: var(--on-ink);
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s, opacity 0.16s;
  white-space: nowrap;
}
.pt-btn:hover:not(:disabled) { border-color: var(--on-ink); background: rgba(239, 233, 221, 0.1); }
.pt-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pt-btn--solid { background: var(--on-ink); color: var(--ink); border-color: var(--on-ink); }
.pt-btn--solid:hover:not(:disabled) { background: #fff; border-color: #fff; }
.pt-btn--danger { color: #e6a08b; border-color: rgba(230, 160, 139, 0.55); }
.pt-btn--danger:hover:not(:disabled) { background: rgba(178, 58, 29, 0.22); border-color: #e6a08b; }
.pt-btn--ghost { color: var(--ink); border-color: var(--rule-strong); }
.pt-btn--ghost:hover:not(:disabled) { background: rgba(22, 19, 15, 0.06); border-color: var(--ink); }
.pt-btn--sm { padding: 6px 13px; font-size: 12px; }

.pt-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid #e6a08b;
  background: rgba(178, 58, 29, 0.14);
  animation: pt-reveal 0.2s ease-out;
}
.pt-confirm__title { margin: 0 0 3px; font-size: 14px; font-weight: 700; }
.pt-confirm__text { margin: 0; font-size: 12px; color: rgba(239, 233, 221, 0.66); }
.pt-confirm__actions { display: flex; gap: 8px; }
.pt-confirm .pt-btn--ghost { color: var(--on-ink); border-color: rgba(239, 233, 221, 0.45); }
.pt-confirm .pt-btn--ghost:hover { background: rgba(239, 233, 221, 0.12); border-color: var(--on-ink); }

/* ── figures ───────────────────────────────────────────────────── */
.pt-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  padding-inline: clamp(18px, 4.5vw, 64px);
  border-bottom: 1px solid var(--rule-strong);
}
.pt-metric {
  padding: 20px clamp(10px, 1.8vw, 24px);
  border-inline-start: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.pt-metric:first-child { border-inline-start: 0; padding-inline-start: 0; }
.pt-metric__label {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
.pt-metric__value {
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(20px, 2.7vw, 34px);
  letter-spacing: -0.035em;
  line-height: 1.1;
}
.pt-metric--accent .pt-metric__value { color: var(--verm); }
.pt-metric__hint { font-size: 11px; color: var(--ink-soft); }

/* ── body ──────────────────────────────────────────────────────── */
.pt-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 296px;
  gap: clamp(24px, 4vw, 58px);
  padding: clamp(24px, 4vw, 44px) clamp(18px, 4.5vw, 64px) 0;
  align-items: start;
}

.pt-ledger__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--ink);
}
.pt-ledger__title {
  font-family: var(--display);
  font-weight: 500;
  font-size: clamp(20px, 2.4vw, 27px);
  margin: 0;
  letter-spacing: -0.01em;
}
.pt-count {
  font-family: var(--mono);
  font-size: 0.5em;
  color: var(--verm);
  margin-inline-start: 7px;
  vertical-align: super;
}
.pt-tools { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

.pt-seg { display: inline-flex; border: 1px solid var(--rule-strong); }
.pt-seg button {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  padding: 6px 12px;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--ink-soft);
  transition: background 0.15s, color 0.15s;
}
.pt-seg button + button { border-inline-start: 1px solid var(--rule-strong); }
.pt-seg button[data-active='true'] { background: var(--ink); color: var(--paper); }
.pt-seg button:hover:not([data-active='true']) { background: rgba(22, 19, 15, 0.06); }

.pt-sort { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-soft); }
.pt-sort select {
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink);
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  padding: 4px 2px;
  cursor: pointer;
}

/* ── rows ──────────────────────────────────────────────────────── */
.pt-rows { list-style: none; margin: 0; padding: 0; }
.pt-row { border-bottom: 1px solid var(--rule); }
.pt-row__main {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 152px 20px;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 15px 4px;
  background: none;
  border: 0;
  text-align: start;
  cursor: pointer;
  transition: background 0.16s;
}
.pt-row__main:hover { background: rgba(22, 19, 15, 0.035); }
.pt-row[data-open='true'] .pt-row__main { background: rgba(22, 19, 15, 0.05); }
.pt-row__index,
.pt-table__index {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-soft);
  letter-spacing: 0.06em;
}
.pt-row__unit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  text-align: start;
}
.pt-row__line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.pt-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pt-row__dot { color: rgba(87, 80, 63, 0.55); font-size: 12px; }
.pt-row__code {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 14.5px;
  letter-spacing: -0.01em;
  direction: ltr;
  unicode-bidi: isolate;
}
.pt-row__type {
  font-size: 12px;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}
.pt-row__sub {
  font-family: var(--mono);
  font-size: 10.5px;
  color: rgba(87, 80, 63, 0.75);
  letter-spacing: 0.04em;
  unicode-bidi: plaintext;
}
.pt-row__period {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: var(--ink-soft);
  white-space: nowrap;
}
.pt-row__dash { width: 10px; height: 1px; background: var(--rule-strong); display: inline-block; }
.pt-open-end {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  border-bottom: 1.5px dotted var(--rule-strong);
  color: var(--moss);
}
.pt-row__price {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 15px;
  font-weight: 600;
  text-align: end;
  white-space: nowrap;
}
.pt-row__missing {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--verm);
  border: 1px dashed var(--verm);
  padding: 2px 8px;
  white-space: nowrap;
}
.pt-row__toggle {
  font-family: var(--mono);
  font-size: 15px;
  color: var(--ink-soft);
  text-align: center;
}

.pt-row__panel {
  display: grid;
  gap: 16px;
  padding: 2px 4px 20px 46px;
  animation: pt-reveal 0.22s ease-out;
}
.pt-row__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  max-width: 480px;
  font-size: 12.5px;
}
.pt-row__facts p { margin: 0; }
.pt-row__wide { grid-column: 1 / -1; color: var(--ink-soft); }
.pt-row__facts .pt-label { margin-bottom: 3px; }
.pt-row__act { display: flex; align-items: center; gap: 10px; }
.pt-row__act .pt-btn { border-color: var(--rule-strong); }

.pt-edit { display: grid; gap: 10px; }
.pt-edit__input {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1.5px solid var(--ink);
  padding-bottom: 3px;
  background: #fff;
}
.pt-edit__input input {
  font-family: var(--mono);
  font-size: 15px;
  width: 110px;
  border: 0;
  background: transparent;
  padding: 3px 4px;
  color: var(--ink);
}
.pt-edit__input input:focus { outline: none; }
.pt-edit__actions { display: flex; gap: 6px; }

/* ── dense table ───────────────────────────────────────────────── */
.pt-table__wrap { overflow-x: auto; }
.pt-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pt-table th {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
  text-align: start;
  padding: 10px 8px;
  border-bottom: 1px solid var(--rule-strong);
  white-space: nowrap;
}
.pt-table td { padding: 11px 8px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
.pt-table tbody tr:hover { background: rgba(22, 19, 15, 0.035); }
.pt-table .num { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: end; white-space: nowrap; }
.pt-table th.num { text-align: end; }
.pt-table__muted { color: var(--ink-soft); }
.pt-table .pt-row__type { display: inline; margin-inline-start: 6px; }
.pt-table .pt-row__code { font-size: 13px; }

/* ── receipt ───────────────────────────────────────────────────── */
.pt-receipt {
  margin-top: 26px;
  padding: 20px 22px 22px;
  background: var(--card);
  border: 1.5px solid var(--ink);
  position: relative;
}
.pt-receipt::before,
.pt-receipt::after {
  content: '';
  position: absolute;
  inset-inline: 10px;
  height: 8px;
  background-image: radial-gradient(circle at 4px 4px, var(--paper) 3.4px, transparent 3.6px);
  background-size: 12px 8px;
  background-repeat: repeat-x;
}
.pt-receipt::before { top: -1px; }
.pt-receipt::after { bottom: -1px; transform: scaleY(-1); }
.pt-receipt__caption {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 14px;
}
.pt-lead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  padding-block: 5px;
}
.pt-lead__dots { flex: 1; border-bottom: 1.5px dotted var(--rule-strong); transform: translateY(-3px); }
.pt-lead .pt-num { font-size: 13.5px; }
.pt-receipt__total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 14px;
  border-top: 2px solid var(--ink);
  font-size: 13px;
  font-weight: 700;
}
.pt-receipt__sum {
  font-family: var(--mono);
  font-size: clamp(21px, 2.6vw, 27px);
  font-weight: 700;
  letter-spacing: -0.03em;
}

/* ── rail ──────────────────────────────────────────────────────── */
.pt-rail {
  display: grid;
  gap: 30px;
  padding-bottom: 40px;
  position: sticky;
  top: 22px;
  align-self: start;
}
.pt-rail__title {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--rule-strong);
}
.pt-facts { margin: 0; display: grid; }
.pt-facts > div { padding: 10px 0; border-bottom: 1px solid var(--rule); }
.pt-facts dt {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-bottom: 3px;
}
.pt-facts dd { margin: 0; font-size: 13px; line-height: 1.45; }
.pt-facts__sub { display: block; font-size: 11.5px; color: var(--ink-soft); }
.pt-state { color: var(--moss); font-weight: 500; }
.pt-state--off { color: var(--verm); }

.pt-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  border-inline-start: 1px solid var(--rule-strong);
  padding-inline-start: 16px;
}
.pt-timeline li {
  position: relative;
  padding-bottom: 16px;
  display: grid;
  gap: 1px;
}
.pt-timeline li::before {
  content: '';
  position: absolute;
  inset-inline-start: -21px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--paper);
  border: 1.5px solid var(--ink);
}
.pt-timeline li[data-latest='true']::before { background: var(--verm); border-color: var(--verm); }
.pt-tick__when {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  justify-self: start;
}
.pt-tick__kind { font-size: 12.5px; font-weight: 500; }
.pt-tick__detail { font-family: var(--mono); font-size: 11px; color: var(--ink-soft); letter-spacing: 0.01em; }
.pt-tick__actor { font-size: 11px; color: rgba(87, 80, 63, 0.8); }

/* ── footer / mobile ───────────────────────────────────────────── */
.pt-colophon > span:last-child { text-transform: none; }
.pt-colophon {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin: 30px clamp(18px, 4.5vw, 64px) 0;
  padding: 14px 0 26px;
  border-top: 1px solid var(--rule-strong);
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
.pt-mobile-bar {
  display: none;
  position: sticky;
  bottom: 0;
  z-index: 20;
  gap: 8px;
  padding: 10px 14px max(10px, env(safe-area-inset-bottom));
  background: var(--ink);
}
.pt-mobile-bar .pt-btn { flex: 1; }

@keyframes pt-reveal {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
@keyframes pt-rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}

/* ── responsive ────────────────────────────────────────────────── */
@media (max-width: 1080px) {
  .pt-body { grid-template-columns: minmax(0, 1fr); }
  .pt-rail { position: static; order: 2; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px; }
}
@media (max-width: 900px) {
  .pt-cover__grid { grid-template-columns: minmax(0, 1fr); }
  .pt-cover__meta { border-top: 1px solid rgba(239, 233, 221, 0.2); }
  .pt-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pt-metric:nth-child(2) { border-inline-start: 0; }
  .pt-metric:nth-child(odd) { padding-inline-start: 0; }
  .pt-metric:nth-child(n + 3) { border-top: 1px solid var(--rule); }
  .pt-row__main { grid-template-columns: 26px minmax(0, 1fr) 116px 18px; gap: 10px; }
  .pt-row__panel { padding-inline-start: 4px; }
}
@media (max-width: 760px) {
  .pt-cover__actions { display: none; }
  .pt-row__act { justify-content: flex-start; }
  .pt-number { font-size: clamp(34px, 11vw, 52px); }
  .pt-mobile-bar { display: flex; }
  .pt-rail { grid-template-columns: minmax(0, 1fr); }
  .pt-row__facts { grid-template-columns: minmax(0, 1fr); }
  .pt-receipt { padding: 18px 16px 20px; }
  .pt-cover { padding-bottom: 0; }
  .pt-colophon { padding-bottom: 90px; }
}

@media (prefers-reduced-motion: reduce) {
  .pt-shell *, .pt-shell *::before, .pt-shell *::after {
    animation: none !important;
    transition: none !important;
  }
}

@media print {
  .pt-shell::before { display: none; }
  .pt-cover { background: #fff; color: #000; }
  .pt-cover::before, .pt-cover::after { display: none; }
  .pt-number, .pt-party { color: #000; }
  .pt-cover__actions, .pt-mobile-bar, .pt-sort, .pt-seg, .pt-row__act, .pt-row__toggle { display: none !important; }
  .pt-row__panel { display: none; }
  .pt-metrics, .pt-body { padding-inline: 0; }
}
`

/* ══════════════════════════════════════════════════════════════════
   Variant switcher — one bar, six independent design systems.
   ══════════════════════════════════════════════════════════════════ */

type VariantProps = { po: PoState }

/** Green ladder (the owner's preference) plus the original blue for compare. */
const ACCENTS: { name: string; hex: string }[] = [
  { name: 'زمردي', hex: '#0f6b3f' },
  { name: 'صنوبري', hex: '#1c5a48' },
  { name: 'زيتوني', hex: '#4f6b2c' },
  { name: 'نعناعي', hex: '#2e7d6b' },
  { name: 'غامق', hex: '#0b3d2c' },
  { name: 'ازرق (السابق)', hex: '#1e4b9a' },
]

const VARIANTS: {
  id: string
  label: string
  note: string
  Render: (props: VariantProps) => ReactElement
}[] = [
  { id: 'sheet', label: 'سند', note: 'غلاف حبري + دفتر ورقي', Render: SheetVariant },
  { id: 'console', label: 'وحدة تحكم', note: 'لوحة تشغيل داكنة', Render: ConsoleVariant },
  { id: 'invoice', label: 'فاتورة', note: 'ورقة A4 مطبوعة', Render: InvoiceVariant },
  { id: 'deck', label: 'بطاقات', note: 'الوحدة بطاقة والسعر بطل', Render: DeckVariant },
  { id: 'grid', label: 'شبكة', note: 'جداول بيانات كثيفة', Render: GridVariant },
  { id: 'terminal', label: 'طرفية', note: 'سطر اوامر واحادي المسافة', Render: TerminalVariant },
  { id: 'desk', label: 'مكتبي', note: 'الشاشة اليومية على توكنز المشروع', Render: DeskVariant },
  { id: 'identity', label: 'هوية', note: 'ترويسة الشركة وخط مستندي', Render: IdentityVariant },
  { id: 'combo', label: 'هوية+', note: 'الهوية ممزوجة بافكار الخمسة الاولى', Render: ComboVariant },
  { id: 'po-register', label: 'اوامر · سجل', note: 'سجل رسمي بترويسة الشركة', Render: PoRegister },
  { id: 'po-admin', label: 'اوامر · اداري', note: 'جدول مع بحث وتصفية', Render: PoAdminTable },
  { id: 'po-cards', label: 'اوامر · بطاقات', note: 'امر شراء في كل بطاقة', Render: PoCards },
  { id: 'po-groups', label: 'اوامر · مجموعات', note: 'تجميع حسب الحالة', Render: PoGroups },
  { id: 'po-board', label: 'اوامر · كانبان', note: 'ثلاثة اعمدة حسب الحالة', Render: PoBoard },
  { id: 'po-dense', label: 'اوامر · كثيف', note: 'اكثر الصفوف في الشاشة', Render: PoDense },
  { id: 'po-dash', label: 'اوامر · مؤشرات', note: 'مؤشرات ثم اخر الاوامر', Render: PoDashboard },
  { id: 'po-wide', label: 'اوامر · صفوف', note: 'صف عريض مع نسبة التسعير', Render: PoWideRows },
  { id: 'po-archive', label: 'اوامر · ارشيف', note: 'مرتب بالشهور', Render: PoArchive },
  { id: 'po-inbox', label: 'اوامر · وارد', note: 'صندوق وارد مع مرشحات', Render: PoInbox },
  { id: 'po-xreg', label: 'اوامر · فتح صف', note: 'سجل بترويسة وصف يفتح جدول معدات', Render: PoExpandTable },
  { id: 'po-acc', label: 'اوامر · اكورديون', note: 'امر ثم قائمة معداته', Render: PoAccordion },
  { id: 'po-cards2', label: 'اوامر · بطاقات فتح', note: 'بطاقة وشرائح معدات', Render: PoCardsUnits },
  { id: 'po-sub', label: 'اوامر · لوحة فرعية', note: 'صف يفتح معدات + بيانات', Render: PoSubPanel },
  { id: 'po-dense2', label: 'اوامر · كثيف فتح', note: 'سطر معدات مختصر داخل الصف', Render: PoDenseExpand },
]
/* ── L6 · «كثيف»: maximum rows per screen ─────────────────────────── */

function PoDense() {
  return (
    <main dir="rtl" className="light-sheet flex min-h-[calc(100dvh-42px)] flex-col bg-bg text-fg">
      <style>{`.po-dense td, .po-dense th { padding-block: 3px; line-height: 1.4; }`}</style>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-[13px] font-semibold">
          اوامر الشراء <span className="font-normal text-muted">({PO_ROWS.length})</span>
        </h1>
        <span className="text-[10px] text-muted tabular-nums" dir="ltr">
          total {money(sumOf(PO_ROWS))}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="po-dense w-full min-w-[820px] border-collapse text-[11.5px]">
          <thead className="sticky top-0 bg-surface text-[9.5px] text-muted">
            <tr>
              <th className="px-2 py-1 text-start font-medium">رقم</th>
              <th className="px-2 py-1 text-start font-medium">المورد</th>
              <th className="px-2 py-1 text-start font-medium">الشركة</th>
              <th className="px-2 py-1 text-start font-medium">المشروع</th>
              <th className="whitespace-nowrap px-2 py-1 text-start font-medium">البدء</th>
              <th className="px-2 py-1 text-end font-medium">وحدات</th>
              <th className="px-2 py-1 text-end font-medium">بلا سعر</th>
              <th className="px-2 py-1 text-center font-medium">الحالة</th>
              <th className="whitespace-nowrap px-2 py-1 text-end font-medium">قبل الضريبة</th>
              <th className="whitespace-nowrap px-2 py-1 text-end font-medium">مع الضريبة</th>
            </tr>
          </thead>
          <tbody>
            {PO_ROWS.map((row) => (
              <tr key={row.number} className="border-t border-border hover:bg-surface">
                <td className="px-2 py-1 font-medium" dir="ltr">{row.number}</td>
                <td className="max-w-[220px] truncate px-2 py-1">{row.party}</td>
                <td className="whitespace-nowrap px-2 py-1 text-muted">{row.company}</td>
                <td className="whitespace-nowrap px-2 py-1 text-muted">{row.project}</td>
                <td className="px-2 py-1 text-[10.5px] tabular-nums text-muted" dir="ltr">
                  {shortDate(row.start)}
                </td>
                <td className="px-2 py-1 text-end tabular-nums">{row.units}</td>
                <td className={`px-2 py-1 text-end tabular-nums ${row.unpriced ? 'text-[#a35a12]' : 'text-muted'}`}>
                  {row.unpriced || '—'}
                </td>
                <td className="px-2 py-1">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      row.status === 'open' ? 'bg-[#15803d]' : 'bg-[#c9c2b4]'
                    }`}
                    title={row.status === 'open' ? 'مفتوح' : 'مغلق'}
                  />
                </td>
                <td className="px-2 py-1 text-end tabular-nums" dir="ltr">{money(row.total)}</td>
                <td className="px-2 py-1 text-end tabular-nums text-muted" dir="ltr">
                  {money(row.total + vatOf(row.total))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[10px] text-muted">
        <span>{PO_ROWS.length} صفوف</span>
        <span>جاهز</span>
      </div>
    </main>
  )
}

/* ── L7 · «مؤشرات + جدول» ─────────────────────────────────────────── */

function PoDashboard() {
  const stats = [
    ['اوامر الشراء', String(PO_ROWS.length), 'كل الفترات'],
    ['المفتوحة', String(openRows.length), 'قيد التنفيذ'],
    ['بحاجة اسعار', String(needsPrice.length), 'تحتاج متابعة'],
    ['قيمة ملتزم بها', money(sumOf(openRows)), 'قبل الضريبة'],
  ]

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-surface text-fg">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-5">
        <h1 className="text-lg font-bold">المشتريات</h1>
        <p className="text-xs text-muted">نظرة على اوامر الشراء</p>

        <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {stats.map(([label, value, hint], index) => (
            <div key={label} className="card p-3.5">
              <p className="text-[10.5px] text-muted">{label}</p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums ${
                  index === 2 && needsPrice.length > 0 ? 'text-[#a35a12]' : ''
                }`}
                dir="ltr"
              >
                {value}
              </p>
              <p className="text-[10px] text-muted">{hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-bg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-[13px] font-semibold">اخر الاوامر</h2>
            <button type="button" className="text-[11px] text-info">عرض الكل</button>
          </div>
          <ul className="divide-y divide-border">
            {PO_ROWS.slice(0, 6).map((row) => (
              <li key={row.number} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium" dir="ltr">{row.number}</p>
                  <p className="truncate text-[11px] text-muted">{row.party}</p>
                </div>
                <span className="hidden text-[11px] text-muted sm:block">{row.project}</span>
                <StatusText status={row.status} />
                <span className="w-[92px] text-end text-[12.5px] font-medium tabular-nums" dir="ltr">
                  {money(row.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}

/* ── L8 · «صفوف عريضة»: number, progress, amount ──────────────────── */

function PoWideRows() {
  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-bg text-fg">
      <div className="mx-auto w-full max-w-[980px] px-4 py-6">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-lg font-bold">اوامر الشراء</h1>
          <span className="text-[11px] text-muted">
            {needsPrice.length} اوامر بحاجة اسعار
          </span>
        </div>

        <ul className="mt-4 divide-y divide-border border-y border-border">
          {PO_ROWS.map((row) => {
            const priced = row.units - row.unpriced
            const ratio = row.units ? priced / row.units : 1
            return (
              <li key={row.number} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3 hover:bg-surface">
                <p className="w-[92px] shrink-0 text-[13px] font-bold" dir="ltr">
                  {row.number}
                </p>
                <div className="min-w-[180px] flex-1">
                  <p className="text-[12.5px]">{row.party}</p>
                  <p className="text-[10.5px] text-muted">
                    {row.project} · بداية {shortDate(row.start)}
                  </p>
                </div>
                <div className="w-[150px] shrink-0">
                  <div className="flex items-center justify-between text-[9.5px] text-muted">
                    <span>{priced}/{row.units} مسعّرة</span>
                    <span>{Math.round(ratio * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className={`block h-full rounded-full ${ratio === 1 ? 'bg-[#15803d]' : 'bg-[#c99a3f]'}`}
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </div>
                </div>
                <StatusText status={row.status} />
                <p className="w-[104px] shrink-0 text-end text-[13px] font-semibold tabular-nums" dir="ltr">
                  {money(row.total)}
                </p>
              </li>
            )
          })}
        </ul>
      </div>
    </main>
  )
}

/* ── L9 · «ارشيف»: chronological, month by month ──────────────────── */

function PoArchive() {
  const months = ['سبتمبر 2026', 'اغسطس 2026', 'يوليو 2026', 'يونيو 2026', 'مايو 2026']
  const monthOf = (iso: string) => {
    const [year, month] = iso.split('-')
    const names: Record<string, string> = {
      '05': 'مايو 2026', '06': 'يونيو 2026', '07': 'يوليو 2026',
      '08': 'اغسطس 2026', '09': 'سبتمبر 2026',
    }
    return names[month] ?? `${month}/${year}`
  }

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-[#faf9f6] text-fg">
      <div className="mx-auto w-full max-w-[760px] px-5 py-8">
        <p className="text-[10px] tracking-[0.2em] text-muted">ARCHIVE</p>
        <h1 className="mt-1 text-2xl font-bold">ارشيف اوامر الشراء</h1>
        <p className="text-xs text-muted">{PO_ROWS.length} امر · مرتبة بالتاريخ</p>

        <div className="mt-6 space-y-6">
          {months.map((month) => {
            const rows = PO_ROWS.filter((row) => monthOf(row.start) === month)
            if (!rows.length) return null
            return (
              <section key={month}>
                <h2 className="border-b border-fg pb-1 text-[12px] font-semibold">{month}</h2>
                <ul>
                  {rows.map((row) => (
                    <li key={row.number} className="flex items-baseline gap-3 border-b border-border py-2">
                      <span className="w-[84px] shrink-0 text-[11px] font-medium" dir="ltr">
                        {row.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px]">{row.party}</span>
                      <span className="hidden flex-1 border-b border-dotted border-border sm:block" aria-hidden="true" />
                      <span className="shrink-0 text-[11px] tabular-nums text-muted">{row.units} وحدة</span>
                      <span className="w-[92px] shrink-0 text-end text-[12px] font-semibold tabular-nums" dir="ltr">
                        {money(row.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}

/* ── L10 · «وارد»: inbox rows with update time ────────────────────── */

function PoInbox() {
  const [filter, setFilter] = useState<'all' | 'todo' | 'closed'>('all')
  const rows = PO_ROWS.filter((row) =>
    filter === 'all' ? true : filter === 'todo' ? row.unpriced > 0 : row.status === 'closed',
  )

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-bg text-fg">
      <div className="mx-auto grid w-full max-w-[1080px] md:grid-cols-[180px_minmax(0,1fr)]">
        <aside className="border-e border-border px-3 py-4">
          <p className="px-2 pb-2 text-[11px] font-semibold text-muted">اوامر الشراء</p>
          {(
            [
              ['all', 'الكل', PO_ROWS.length],
              ['todo', 'بحاجة اسعار', needsPrice.length],
              ['closed', 'مغلقة', PO_ROWS.length - openRows.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                filter === key ? 'bg-surface font-medium' : 'text-muted hover:bg-surface'
              }`}
            >
              <span>{label}</span>
              <span className="text-[11px] tabular-nums text-muted">{count}</span>
            </button>
          ))}
        </aside>

        <section>
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h1 className="text-sm font-semibold">الوارد</h1>
            <span className="text-[11px] text-muted">{rows.length} امر</span>
          </header>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.number} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    row.unpriced > 0 ? 'bg-[#c99a3f]' : row.status === 'open' ? 'bg-[#15803d]' : 'bg-[#c9c2b4]'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium">
                    <span dir="ltr">{row.number}</span> — {row.party}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {row.project} · اخر تحديث {shortDate(row.updated)}
                  </p>
                </div>
                <span className="w-[92px] shrink-0 text-end text-[12px] tabular-nums" dir="ltr">
                  {money(row.total)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

/* ══════════════════════════════════════════════════════════════════
   «اوامر الشراء» — ten designs for the LIST page (sample rows).
   ══════════════════════════════════════════════════════════════════ */

interface PoRow {
  number: string
  party: string
  company: string
  project: string
  start: string
  status: 'open' | 'closed'
  units: number
  total: number
  unpriced: number
  updated: string
}

const PO_ROWS: PoRow[] = [
  { number: 'SPO260011', party: 'مؤسسة النخبة لتاجير المعدات', company: 'العزاني', project: 'طريق الملك فهد', start: '2026-09-01', status: 'open', units: 6, total: 29050, unpriced: 1, updated: '2026-10-18' },
  { number: 'SPO260010', party: 'شركة الخليج للمعدات الثقيلة', company: 'البناء الحديث', project: 'حي الياسمين', start: '2026-08-20', status: 'open', units: 4, total: 41200, unpriced: 0, updated: '2026-10-14' },
  { number: 'SPO260009', party: 'مؤسسة الرواد للنقليات', company: 'العزاني', project: 'جسر الدمام', start: '2026-08-11', status: 'closed', units: 3, total: 16800, unpriced: 0, updated: '2026-09-30' },
  { number: 'SPO260008', party: 'شركة تكوين المعدات', company: 'العزاني', project: 'طريق الملك فهد', start: '2026-08-02', status: 'open', units: 2, total: 9400, unpriced: 2, updated: '2026-08-05' },
  { number: 'SPO260007', party: 'مؤسسة النخبة لتاجير المعدات', company: 'مجموعة الاعمار', project: 'حي الياسمين', start: '2026-07-19', status: 'closed', units: 5, total: 33250, unpriced: 0, updated: '2026-08-28' },
  { number: 'SPO260006', party: 'شركة الخليج للمعدات الثقيلة', company: 'العزاني', project: 'جسر الدمام', start: '2026-07-04', status: 'open', units: 7, total: 58600, unpriced: 3, updated: '2026-10-02' },
  { number: 'SPO260005', party: 'مؤسسة الرواد للنقليات', company: 'البناء الحديث', project: 'طريق الملك فهد', start: '2026-06-22', status: 'closed', units: 2, total: 7800, unpriced: 0, updated: '2026-07-30' },
  { number: 'SPO260004', party: 'شركة تكوين المعدات', company: 'مجموعة الاعمار', project: 'جسر الدمام', start: '2026-06-08', status: 'open', units: 1, total: 4200, unpriced: 0, updated: '2026-06-09' },
  { number: 'SPO260003', party: 'مؤسسة النخبة لتاجير المعدات', company: 'العزاني', project: 'حي الياسمين', start: '2026-05-17', status: 'closed', units: 4, total: 24500, unpriced: 0, updated: '2026-06-27' },
]

const vatOf = (value: number) => value * VAT_RATE
const openRows = PO_ROWS.filter((row) => row.status === 'open')
const sumOf = (rows: PoRow[]) => rows.reduce((sum, row) => sum + row.total, 0)
const needsPrice = PO_ROWS.filter((row) => row.unpriced > 0)

function StatusText({ status }: { status: 'open' | 'closed' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] ${
        status === 'open' ? 'text-[#15803d]' : 'text-[#8b857a]'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === 'open' ? 'bg-[#15803d]' : 'bg-[#c9c2b4]'}`}
        aria-hidden="true"
      />
      {status === 'open' ? 'مفتوح' : 'مغلق'}
    </span>
  )
}

/* Every PO belongs to ONE supplier, so a row's preview only lists the
   equipment inside it — no supplier column inside the panel. */
interface PoUnit {
  code: string
  type: string
  plate: string
  from: string
  to: string | null
  price: number | null
}

const EQUIP_POOL: [string, string, string][] = [
  ['A055', 'BOOM TRUCK 10 TON', 'ا ب ج 8631'],
  ['F112', 'EXCAVATOR CAT 320', 'CAT0320DXK1234567'],
  ['G240', 'WHEEL LOADER 966', 'د هـ و 4412'],
  ['B031', 'FORKLIFT 5 TON', 'ر ز س 1180'],
  ['E778', 'MOTOR GRADER 140K', 'CAT0140KAB98765'],
  ['C509', 'WATER TANKER 18M3', 'ع ف ق 7745'],
  ['D660', 'PICKUP 4X4', 'ب ك ل 2288'],
  ['H903', 'CRANE 50 TON', 'م ن هـ 5521'],
  ['J118', 'BACKHOE JCB 3CX', 'س ص ع 9034'],
  ['K442', 'COMPACTOR 12 TON', 'ش ت ث 6612'],
]

/** Deterministic sample equipment for a PO: the unit count and the total
 *  always match the row, and the unpriced ones match too. */
const PRICE_WEIGHTS = [1, 0.78, 1.24, 0.92, 1.1, 0.85, 1.32, 0.96]

function unitsOf(row: PoRow): PoUnit[] {
  const priced = Math.max(row.units - row.unpriced, 0)
  const weightSum = Array.from({ length: priced }, (_, i) => PRICE_WEIGHTS[i % PRICE_WEIGHTS.length]).reduce(
    (sum, weight) => sum + weight,
    0,
  )
  let used = 0
  const raw = Array.from({ length: priced }, (_, i) => {
    const weight = PRICE_WEIGHTS[i % PRICE_WEIGHTS.length]
    return Math.round((row.total * weight) / (weightSum || 1) / 10) * 10
  })
  const prices = raw.map((price, index) => {
    if (index === raw.length - 1) return Math.max(row.total - used, 0)
    used += price
    return price
  })
  return Array.from({ length: row.units }, (_, index) => {
    const [code, type, plate] = EQUIP_POOL[(index + row.number.charCodeAt(7)) % EQUIP_POOL.length]
    const isUnpriced = index < row.unpriced
    const price = isUnpriced ? null : prices[index - row.unpriced] ?? null
    return {
      code,
      type,
      plate,
      from: row.start,
      to: row.status === 'closed' ? row.updated : null,
      price,
    }
  })
}

/* ── L11 · «فتح صف»: the register, each row opens a sub-table ─────── */

function PoExpandTable() {
  const [open, setOpen] = useState<string | null>('SPO260011')

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-[#f7f6f3] text-[#15140f]">
      <style>{identityCss}</style>
      <div className="mx-auto w-full max-w-[1120px] px-5 py-7 sm:px-8">
        <header className="id-head">
          <div className="flex items-center gap-3">
            <img src="/azzanco-logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <p className="text-[13px] font-semibold leading-tight">شركة عبدالله العزاني للمقاولات</p>
              <p className="text-[10.5px] text-[#6f6a60]">ادارة المعدات · المشتريات</p>
            </div>
          </div>
          <div className="text-end">
            <p className="id-micro">Purchase orders</p>
            <p className="id-display mt-0.5 text-[23px] leading-none">اوامر الشراء</p>
          </div>
        </header>

        <p className="py-2.5 text-[11px] text-[#6f6a60]">
          {PO_ROWS.length} امر · امر واحد لكل مورد · اضغط الصف لعرض معداته
        </p>

        <table className="id-table">
          <thead>
            <tr>
              <th className="w-[26px]" />
              <th>رقم الامر</th>
              <th>المورد</th>
              <th className="hidden md:table-cell">المشروع</th>
              <th className="text-center">معدات</th>
              <th className="hidden sm:table-cell">الحالة</th>
              <th className="text-end">القيمة قبل الضريبة</th>
            </tr>
          </thead>
          <tbody>
            {PO_ROWS.map((row) => {
              const isOpen = open === row.number
              const units = unitsOf(row)
              return (
                <Fragment key={row.number}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : row.number)}
                    className={`cursor-pointer ${isOpen ? 'bg-[#fffdf7]' : ''}`}
                  >
                    <td className="text-center text-[10px] text-[#8b857a]">{isOpen ? '−' : '+'}</td>
                    <td className="id-code text-[12px]">{row.number}</td>
                    <td className="max-w-[150px] truncate text-[11.5px]">{row.party}</td>
                    <td className="hidden text-[11px] text-[#6f6a60] md:table-cell">{row.project}</td>
                    <td className="text-center text-[11px] tabular-nums">{row.units}</td>
                    <td className="hidden sm:table-cell">
                      <StatusText status={row.status} />
                    </td>
                    <td className="text-end">
                      <span className="id-price text-[12.5px]">
                        {money(row.total)}
                        <span className="id-cur hidden sm:inline">ر.س</span>
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="bg-[#fffdf7] p-0">
                        <div className="border-y border-[#e8e3d9] px-3 py-2">
                          <table className="w-full text-[11.5px]">
                            <thead>
                              <tr className="text-[9.5px] text-[#8b857a]">
                                <th className="pb-1 text-start font-normal">المعدة</th>
                                <th className="pb-1 text-start font-normal">النوع</th>
                                <th className="hidden pb-1 text-start font-normal sm:table-cell">اللوحة</th>
                                <th className="pb-1 text-end font-normal">السعر</th>
                              </tr>
                            </thead>
                            <tbody>
                              {units.map((unit) => (
                                <tr key={unit.code}>
                                  <td className="py-1 font-medium" dir="ltr">{unit.code}</td>
                                  <td className="py-1 text-[#6f6a60]">{unit.type}</td>
                                  <td className="hidden py-1 text-[10.5px] text-[#8b857a] sm:table-cell" dir="auto">
                                    {unit.plate}
                                  </td>
                                  <td className="py-1 text-end tabular-nums" dir="ltr">
                                    {unit.price === null ? (
                                      <span className="text-[10px] text-[#a35a12]">بلا سعر</span>
                                    ) : (
                                      money(unit.price)
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}

/* ── L12 · «اكورديون»: header row + simple equipment list ─────────── */

function PoAccordion() {
  const [open, setOpen] = useState<string | null>('SPO260010')

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-bg text-fg">
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <h1 className="text-lg font-bold">اوامر الشراء</h1>
        <p className="text-xs text-muted">اضغط الامر لعرض المعدات</p>

        <div className="mt-4 divide-y divide-border border-y border-border">
          {PO_ROWS.map((row) => {
            const isOpen = open === row.number
            return (
              <section key={row.number}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : row.number)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 py-2.5 text-start"
                >
                  <span className="w-3 text-[11px] text-muted" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                  <span className="w-[86px] shrink-0 text-[12px] font-semibold" dir="ltr">{row.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.party}</span>
                  <span className="hidden text-[11px] text-muted sm:block">{row.units} معدات</span>
                  <StatusText status={row.status} />
                  <span className="w-[92px] text-end text-[12.5px] font-medium tabular-nums" dir="ltr">
                    {money(row.total)}
                  </span>
                </button>
                {isOpen && (
                  <ul className="mb-2 grid gap-1 rounded-md bg-surface px-3 py-2 sm:grid-cols-2">
                    {unitsOf(row).map((unit) => (
                      <li key={unit.code} className="flex items-baseline gap-2 text-[11.5px]">
                        <span className="font-medium" dir="ltr">{unit.code}</span>
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{unit.type}</span>
                        <span className="tabular-nums" dir="ltr">
                          {unit.price === null ? '—' : money(unit.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}

/* ── L13 · «بطاقات مع معدات»: chips of units inside each card ─────── */

function PoCardsUnits() {
  const [open, setOpen] = useState<string | null>('SPO260011')

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-surface text-fg">
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6">
        <h1 className="text-lg font-bold">اوامر الشراء</h1>
        <p className="text-xs text-muted">{PO_ROWS.length} امر · مورد واحد لكل امر</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PO_ROWS.map((row) => {
            const isOpen = open === row.number
            const units = unitsOf(row)
            return (
              <article key={row.number} className="rounded-xl border border-border bg-bg p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-bold" dir="ltr">{row.number}</p>
                    <p className="mt-0.5 text-[11.5px]">{row.party}</p>
                  </div>
                  <StatusText status={row.status} />
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                  <span>{row.project}</span>
                  <span className="text-[13px] font-semibold text-fg tabular-nums" dir="ltr">
                    {money(row.total)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : row.number)}
                  aria-expanded={isOpen}
                  className="mt-2.5 flex w-full items-center justify-between border-t border-border pt-2 text-[11px] text-muted"
                >
                  <span>المعدات ({row.units})</span>
                  <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
                </button>

                {isOpen && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {units.map((unit) => (
                      <li
                        key={unit.code}
                        className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${
                          unit.price === null
                            ? 'border-dashed border-warning text-warning'
                            : 'border-border text-fg'
                        }`}
                        dir="ltr"
                      >
                        {unit.code}
                        <span className="ms-1 text-muted">
                          {unit.price === null ? '—' : money(unit.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </main>
  )
}

/* ── L14 · «لوحة فرعية»: row opens a two-column panel ─────────────── */

function PoSubPanel() {
  const [open, setOpen] = useState<string | null>('SPO260006')

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-bg text-fg">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-5">
        <div className="flex items-end justify-between">
          <h1 className="text-lg font-bold">اوامر الشراء</h1>
          <span className="text-[11px] text-muted">{PO_ROWS.length} امر</span>
        </div>

        <ul className="mt-3 divide-y divide-border border-y border-border">
          {PO_ROWS.map((row) => {
            const isOpen = open === row.number
            return (
              <li key={row.number}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : row.number)}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center gap-3 py-2.5 text-start ${isOpen ? 'bg-surface' : ''}`}
                >
                  <span className="w-8 text-[10px] text-muted" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                  <span className="w-[88px] shrink-0 text-[12px] font-semibold" dir="ltr">{row.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.party}</span>
                  <span className="hidden w-[110px] text-[10.5px] text-muted md:block">{row.project}</span>
                  <span className="hidden w-[74px] text-center text-[10.5px] text-muted sm:block">
                    {row.units} معدات
                  </span>
                  <StatusText status={row.status} />
                  <span className="w-[96px] text-end text-[12.5px] font-medium tabular-nums" dir="ltr">
                    {money(row.total)}
                  </span>
                </button>

                {isOpen && (
                  <div className="grid gap-4 bg-surface px-4 py-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                    <table className="w-full text-[11.5px]">
                      <thead>
                        <tr className="text-[9.5px] text-muted">
                          <th className="pb-1 text-start font-normal">الرمز</th>
                          <th className="pb-1 text-start font-normal">النوع</th>
                          <th className="hidden pb-1 text-start font-normal sm:table-cell">الفترة</th>
                          <th className="pb-1 text-end font-normal">السعر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unitsOf(row).map((unit) => (
                          <tr key={unit.code} className="border-t border-border">
                            <td className="py-1 font-medium" dir="ltr">{unit.code}</td>
                            <td className="py-1 text-muted">{unit.type}</td>
                            <td className="hidden py-1 text-[10px] text-muted sm:table-cell" dir="ltr">
                              {shortDate(unit.from)} — {unit.to ? shortDate(unit.to) : 'مفتوح'}
                            </td>
                            <td className="py-1 text-end tabular-nums" dir="ltr">
                              {unit.price === null ? '—' : money(unit.price)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <dl className="grid content-start gap-1.5 border-inline-start border-border ps-4 text-[11px]">
                      {[
                        ['الشركة', row.company],
                        ['المشروع', row.project],
                        ['البدء', shortDate(row.start)],
                        ['اخر تحديث', shortDate(row.updated)],
                        ['بحاجة اسعار', String(row.unpriced)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-2 border-b border-border pb-1">
                          <dt className="text-muted">{label}</dt>
                          <dd className="font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </main>
  )
}

/* ── L15 · «كثيف بفتح»: one-line preview of the units ─────────────── */

function PoDenseExpand() {
  const [open, setOpen] = useState<string | null>('SPO260006')

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-bg text-fg">
      <div className="mx-auto w-full max-w-[1000px] px-3 py-4">
        <h1 className="text-[13px] font-semibold">اوامر الشراء</h1>

        <table className="mt-2 w-full border-collapse text-[11.5px]">
          <thead className="text-[9.5px] text-muted">
            <tr>
              <th className="w-6" />
              <th className="px-1.5 py-1 text-start font-normal">رقم</th>
              <th className="px-1.5 py-1 text-start font-normal">المورد</th>
              <th className="hidden px-1.5 py-1 text-start font-normal sm:table-cell">المشروع</th>
              <th className="px-1.5 py-1 text-center font-normal">معدات</th>
              <th className="px-1.5 py-1 text-end font-normal">القيمة</th>
            </tr>
          </thead>
          <tbody>
            {PO_ROWS.map((row) => {
              const isOpen = open === row.number
              return (
                <Fragment key={row.number}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : row.number)}
                    className="cursor-pointer border-t border-border hover:bg-surface"
                  >
                    <td className="px-1 py-[3px] text-center text-[10px] text-muted">{isOpen ? '−' : '+'}</td>
                    <td className="px-1.5 py-[3px] font-medium" dir="ltr">{row.number}</td>
                    <td className="max-w-[240px] truncate px-1.5 py-[3px]">{row.party}</td>
                    <td className="hidden whitespace-nowrap px-1.5 py-[3px] text-muted sm:table-cell">
                      {row.project}
                    </td>
                    <td className="px-1.5 py-[3px] text-center tabular-nums">{row.units}</td>
                    <td className="px-1.5 py-[3px] text-end tabular-nums" dir="ltr">{money(row.total)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td />
                      <td colSpan={5} className="bg-surface px-2 py-1.5">
                        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10.5px] text-muted">
                          {unitsOf(row).map((unit) => (
                            <span key={unit.code} className="inline-flex items-baseline gap-1" dir="ltr">
                              <b className="font-medium text-fg">{unit.code}</b>
                              <span className={unit.price === null ? 'text-[10px] text-warning' : ''}>
                                {unit.price === null ? 'بلا سعر' : money(unit.price)}
                              </span>
                              <span aria-hidden="true" className="text-border">·</span>
                            </span>
                          ))}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}

/* ── L1 · «سجل رسمي»: letterhead + ruled register ─────────────────── */

function PoRegister() {
  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-[#f7f6f3] text-[#15140f]">
      <style>{identityCss}</style>
      <div className="mx-auto w-full max-w-[1120px] px-5 py-7 sm:px-8">
        <header className="id-head">
          <div className="flex items-center gap-3">
            <img src="/azzanco-logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <p className="text-[13px] font-semibold leading-tight">شركة عبدالله العزاني للمقاولات</p>
              <p className="text-[10.5px] text-[#6f6a60]">ادارة المعدات والاليات · المشتريات</p>
            </div>
          </div>
          <div className="text-end">
            <p className="id-micro">Purchase orders</p>
            <p className="id-display mt-0.5 text-[24px] leading-none">سجل اوامر الشراء</p>
          </div>
        </header>

        <div className="flex flex-wrap items-end justify-between gap-3 py-3 text-[11px] text-[#6f6a60]">
          <span>
            {PO_ROWS.length} امر · {openRows.length} مفتوح · {needsPrice.length} بحاجة اسعار
          </span>
          <span>
            قيمة ملتزم بها{' '}
            <b className="text-[#15140f] tabular-nums" dir="ltr">
              {money(sumOf(PO_ROWS))}
            </b>
          </span>
        </div>

        <table className="id-table">
          <thead>
            <tr>
              <th className="w-[30px] text-center">م</th>
              <th>رقم الامر</th>
              <th>المورد</th>
              <th className="hidden md:table-cell">المشروع</th>
              <th className="hidden sm:table-cell">البدء</th>
              <th className="text-center">الوحدات</th>
              <th>الحالة</th>
              <th className="text-end">القيمة قبل الضريبة</th>
            </tr>
          </thead>
          <tbody>
            {PO_ROWS.map((row, index) => (
              <tr key={row.number}>
                <td className="text-center text-[10.5px] tabular-nums text-[#a29b8e]">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td>
                  <span className="id-code text-[12px]">{row.number}</span>
                  {row.unpriced > 0 && (
                    <span className="mt-0.5 block text-[9.5px] text-[#a35a12]">
                      {row.unpriced} بلا سعر
                    </span>
                  )}
                </td>
                <td className="text-[11.5px]">{row.party}</td>
                <td className="hidden text-[11px] text-[#6f6a60] md:table-cell">{row.project}</td>
                <td className="hidden text-[10.5px] tabular-nums text-[#6f6a60] sm:table-cell" dir="ltr">
                  {shortDate(row.start)}
                </td>
                <td className="text-center text-[11px] tabular-nums">{row.units}</td>
                <td>
                  <StatusText status={row.status} />
                </td>
                <td className="text-end">
                  <span className="id-price text-[12.5px]">
                    {money(row.total)}
                    <span className="id-cur">ر.س</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="text-[11px] text-[#6f6a60]">
                الاجمالي قبل الضريبة
              </td>
              <td className="text-end">
                <span className="id-price text-[13px]">{money(sumOf(PO_ROWS))}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  )
}

/* ── L2 · «جدول إداري»: toolbar, checkboxes, pagination ───────────── */

function PoAdminTable() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'open' | 'closed' | 'todo'>('all')
  const rows = PO_ROWS.filter((row) => {
    if (tab === 'open' && row.status !== 'open') return false
    if (tab === 'closed' && row.status !== 'closed') return false
    if (tab === 'todo' && row.unpriced === 0) return false
    const term = query.trim().toLowerCase()
    return !term || `${row.number} ${row.party} ${row.project}`.toLowerCase().includes(term)
  })

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-surface text-fg">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted">المشتريات</p>
            <h1 className="text-xl font-bold">اوامر الشراء</h1>
          </div>
          <button type="button" className="h-9 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-contrast">
            + امر شراء
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-bg">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث برقم الامر او المورد"
              className="input h-9 max-w-[280px]"
              aria-label="بحث"
            />
            <div className="flex gap-1 text-xs">
              {(
                [
                  ['all', `الكل ${PO_ROWS.length}`],
                  ['open', `مفتوح ${openRows.length}`],
                  ['todo', `بلا اسعار ${needsPrice.length}`],
                  ['closed', `مغلق ${PO_ROWS.length - openRows.length}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-md px-2.5 py-1.5 ${
                    tab === key ? 'bg-surface font-medium' : 'text-muted hover:bg-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="ms-auto text-[11px] text-muted">{rows.length} نتيجة</span>
          </div>

          <table className="w-full text-sm">
            <thead className="text-[10.5px] text-muted">
              <tr className="border-b border-border">
                <th className="w-9 px-3 py-2">
                  <input type="checkbox" aria-label="تحديد الكل" className="h-3.5 w-3.5" />
                </th>
                <th className="px-3 py-2 text-start font-medium">رقم الامر</th>
                <th className="px-3 py-2 text-start font-medium">المورد</th>
                <th className="hidden px-3 py-2 text-start font-medium md:table-cell">المشروع</th>
                <th className="hidden px-3 py-2 text-center font-medium sm:table-cell">وحدات</th>
                <th className="px-3 py-2 text-start font-medium">الحالة</th>
                <th className="px-3 py-2 text-end font-medium">القيمة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.number} className="border-b border-border last:border-0 hover:bg-surface">
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={`تحديد ${row.number}`} className="h-3.5 w-3.5" />
                  </td>
                  <td className="px-3 py-2.5 font-medium" dir="ltr">
                    {row.number}
                  </td>
                  <td className="px-3 py-2.5">{row.party}</td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted md:table-cell">{row.project}</td>
                  <td className="hidden px-3 py-2.5 text-center text-xs tabular-nums sm:table-cell">
                    {row.units}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusText status={row.status} />
                  </td>
                  <td className="px-3 py-2.5 text-end text-[12.5px] tabular-nums" dir="ltr">
                    {money(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted">
            <span>1 – {rows.length} من {PO_ROWS.length}</span>
            <div className="flex gap-1">
              <button type="button" className="rounded border border-border px-2 py-1">السابق</button>
              <button type="button" className="rounded border border-border bg-surface px-2 py-1">1</button>
              <button type="button" className="rounded border border-border px-2 py-1">التالي</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

/* ── L3 · «بطاقات اوامر» ──────────────────────────────────────────── */

function PoCards() {
  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-[#f4f3f0] text-fg">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">اوامر الشراء</h1>
            <p className="text-xs text-muted">
              {PO_ROWS.length} امر · {needsPrice.length} بحاجة اسعار
            </p>
          </div>
          <button type="button" className="h-9 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-contrast">
            + امر شراء
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PO_ROWS.map((row) => (
            <article
              key={row.number}
              className="rounded-xl border border-border bg-bg p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-bold" dir="ltr">
                  {row.number}
                </p>
                <StatusText status={row.status} />
              </div>
              <p className="mt-1 line-clamp-1 text-[12px] font-medium">{row.party}</p>
              <p className="text-[11px] text-muted">
                {row.project} · {shortDate(row.start)}
              </p>

              <div className="mt-3 flex items-end justify-between gap-2 border-t border-border pt-2.5">
                <div>
                  <p className="text-[9.5px] text-muted">القيمة قبل الضريبة</p>
                  <p className="text-base font-bold tabular-nums" dir="ltr">
                    {money(row.total)}
                  </p>
                </div>
                <div className="text-end text-[10.5px] text-muted">
                  <p>{row.units} وحدة</p>
                  {row.unpriced > 0 ? (
                    <p className="text-[#a35a12]">{row.unpriced} بلا سعر</p>
                  ) : (
                    <p className="text-[#15803d]">مسعّر</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}

/* ── L4 · «مجموعات»: grouped by status, collapsible ───────────────── */

function PoGroups() {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const groups = [
    { key: 'todo', title: 'بحاجة اسعار', rows: PO_ROWS.filter((r) => r.unpriced > 0) },
    { key: 'open', title: 'مفتوحة', rows: PO_ROWS.filter((r) => r.status === 'open' && r.unpriced === 0) },
    { key: 'closed', title: 'مغلقة', rows: PO_ROWS.filter((r) => r.status === 'closed') },
  ]

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-bg text-fg">
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        <h1 className="text-lg font-bold">اوامر الشراء</h1>
        <p className="text-xs text-muted">{PO_ROWS.length} امر مرتبة حسب الحالة</p>

        <div className="mt-5 space-y-4">
          {groups.map((group) => {
            const isClosed = Boolean(closed[group.key])
            return (
              <section key={group.key} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setClosed((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  aria-expanded={!isClosed}
                  className="flex w-full items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 text-start"
                >
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span className="text-muted" aria-hidden="true">{isClosed ? '‹' : '⌄'}</span>
                    {group.title}
                    <span className="text-[11px] font-normal text-muted">{group.rows.length}</span>
                  </span>
                  <span className="text-[11px] tabular-nums text-muted" dir="ltr">
                    {money(sumOf(group.rows))}
                  </span>
                </button>
                {!isClosed && (
                  <ul className="divide-y divide-border">
                    {group.rows.map((row) => (
                      <li key={row.number} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        <span className="w-[86px] shrink-0 font-medium" dir="ltr">{row.number}</span>
                        <span className="min-w-0 flex-1 truncate">{row.party}</span>
                        <span className="hidden text-[11px] text-muted sm:block">{row.project}</span>
                        <span className="w-9 text-center text-[11px] tabular-nums text-muted">{row.units}</span>
                        <span className="w-[86px] text-end text-[12.5px] tabular-nums" dir="ltr">
                          {money(row.total)}
                        </span>
                      </li>
                    ))}
                    {group.rows.length === 0 && (
                      <li className="px-3 py-4 text-center text-xs text-muted">لا يوجد</li>
                    )}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}

/* ── L5 · «كانبان اوامر» ──────────────────────────────────────────── */

function PoBoard() {
  const columns = [
    { key: 'todo', title: 'بحاجة اسعار', rows: PO_ROWS.filter((r) => r.unpriced > 0) },
    { key: 'open', title: 'مفتوحة', rows: PO_ROWS.filter((r) => r.status === 'open' && r.unpriced === 0) },
    { key: 'closed', title: 'مغلقة', rows: PO_ROWS.filter((r) => r.status === 'closed') },
  ]

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-surface text-fg">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-5">
        <h1 className="text-lg font-bold">لوحة اوامر الشراء</h1>
        <p className="text-xs text-muted">{PO_ROWS.length} امر على ثلاث حالات</p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {columns.map((column) => (
            <section key={column.key} className="rounded-xl bg-[#eef0f3] p-2.5">
              <header className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold text-muted">
                <span>{column.title}</span>
                <span className="tabular-nums">{column.rows.length}</span>
              </header>
              <div className="grid gap-2">
                {column.rows.map((row) => (
                  <article key={row.number} className="rounded-lg border border-border bg-bg p-2.5">
                    <p className="text-[12px] font-bold" dir="ltr">{row.number}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px]">{row.party}</p>
                    <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted">
                      <span>{row.units} وحدة</span>
                      <span className="tabular-nums" dir="ltr">{money(row.total)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}

export default function PoTestPage() {
  const po = usePo()
  const [tab, setTab] = useState('sheet')
  const [accent, setAccent] = useState(ACCENTS[0].hex)
  const active = VARIANTS.find((variant) => variant.id === tab) ?? VARIANTS[0]

  // 1..6 switch designs without leaving the keyboard
  useEffectAddKeys(setTab)

  return (
    <div className="vt-app" style={{ '--accent': accent } as CSSProperties}>
      <style>{shellCss}</style>
      <nav className="vt-bar" aria-label="تصاميم الصفحة">
        <span className="vt-bar__mark">PO · {VARIANTS.length} تصاميم</span>
        <div className="vt-bar__tabs" role="tablist">
          {VARIANTS.map((variant, index) => (
            <button
              key={variant.id}
              role="tab"
              type="button"
              aria-selected={variant.id === active.id}
              data-active={variant.id === active.id}
              onClick={() => setTab(variant.id)}
              title={variant.note}
            >
              <span className="vt-bar__num">{String(index + 1).padStart(2, '0')}</span>
              {variant.label}
            </button>
          ))}
        </div>
        <div className="vt-colors" role="group" aria-label="لون التمييز">
          {ACCENTS.map((option) => (
            <button
              key={option.hex}
              type="button"
              title={option.name}
              aria-label={option.name}
              aria-pressed={accent === option.hex}
              data-active={accent === option.hex}
              onClick={() => setAccent(option.hex)}
              style={{ backgroundColor: option.hex }}
            />
          ))}
        </div>
        <label className="vt-jump">
          <span className="sr-only">اختر التصميم</span>
          <select value={tab} onChange={(event) => setTab(event.target.value)}>
            {VARIANTS.map((variant, index) => (
              <option key={variant.id} value={variant.id}>
                {String(index + 1).padStart(2, '0')} · {variant.label}
              </option>
            ))}
          </select>
        </label>
        <span className="vt-bar__hint">1–9</span>
      </nav>
      <active.Render po={po} />
    </div>
  )
}

function useEffectAddKeys(onPick: (id: string) => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const index = Number(event.key)
      if (!Number.isInteger(index) || index < 1 || index > Math.min(9, VARIANTS.length)) return
      onPick(VARIANTS[index - 1].id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPick])
}

const shellCss = `
.vt-app { min-height: 100dvh; }

/* 07–11 are light-mode designs on purpose: the scope restores the approved
   light palette even when the app itself is in dark mode. */
.light-sheet {
  color-scheme: light;
  --bg: #ffffff;
  --fg: #0a0a0a;
  --muted: #6b7280;
  --placeholder: #909090;
  --border: #e5e7eb;
  --surface: #f9fafb;
  --surface-hover: #f3f4f6;
  --overlay: rgba(0, 0, 0, 0.5);
  --primary: #0a0a0a;
  --primary-hover: #262626;
  --primary-contrast: #ffffff;
  --success: #15803d;
  --success-soft: #ecfdf3;
  --warning: #b45309;
  --warning-soft: #fff7ed;
  --danger: #c81e1e;
  --danger-soft: #fef2f2;
  --info: #0369a1;
  --info-soft: #f0f9ff;
  --ring: #0a0a0a;
  background-color: var(--surface);
  color: var(--fg);
}
.light-sheet .card { background-color: var(--bg); }
/* Latin blocks (codes, numbers, dates) keep their own order but must sit on
   the RTL start edge, not float to the left of their block. */
.light-sheet [dir='ltr'] { text-align: right; }
.light-sheet input[dir='ltr'] { text-align: right; }
.vt-bar {
  position: sticky;
  top: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  height: 42px;
  background: #0b0b0c;
  border-bottom: 1px solid #26262a;
  font-family: 'PoTestMono', ui-monospace, monospace;
  flex-wrap: nowrap;
  overflow: hidden;
}
.vt-bar__mark {
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: #6f6f78;
  text-transform: uppercase;
  white-space: nowrap;
}
.vt-bar__tabs {
  display: flex;
  flex: 1;
  gap: 1px;
  overflow-x: auto;
  scrollbar-width: none;
  min-width: 0;
}
.vt-bar__tabs::-webkit-scrollbar { display: none; }
.vt-bar__tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 8px 7px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #9a9aa4;
  font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.vt-bar__tabs button:hover { color: #f2f2f4; }
.vt-bar__tabs button[data-active='true'] {
  color: #fff;
  border-bottom-color: var(--accent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 26%, transparent), transparent);
}
.vt-bar__num {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #6f6f78;
}
.vt-bar__tabs button[data-active='true'] .vt-bar__num { color: var(--accent); }
.vt-colors { display: flex; align-items: center; gap: 4px; margin-inline-start: auto; }
.vt-colors button {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #3a3a42;
  padding: 0;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
}
.vt-colors button:hover { transform: scale(1.12); }
.vt-colors button[data-active='true'] {
  box-shadow: 0 0 0 2px #0b0b0c, 0 0 0 3.5px currentColor;
}
.vt-jump { display: flex; align-items: center; }
.vt-jump select {
  height: 24px;
  max-width: 150px;
  background: #141416;
  color: #cfcfd6;
  border: 1px solid #2b2b31;
  border-radius: 4px;
  font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif;
  font-size: 11.5px;
  padding-inline: 4px;
  cursor: pointer;
}
.vt-bar__hint {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: #55555e;
  border: 1px solid #2b2b31;
  padding: 2px 6px;
  border-radius: 3px;
}
@media (max-width: 1300px) {
  .vt-bar__mark { display: none; }
}
@media (max-width: 900px) {
  .vt-bar__hint { display: none; }
}
@media (max-width: 560px) {
  .vt-bar { padding: 0 6px; gap: 6px; }
  .vt-bar__tabs button { padding: 8px 7px 7px; font-size: 11.5px; }
  .vt-jump select { max-width: 92px; }
  .vt-jump select { max-width: 96px; }
}
`

/* ── 02 · «وحدة تحكم»: dark operations console ────────────────────── */

function ConsoleVariant({ po }: VariantProps) {
  const { units, events, total, vat, grand, unpriced, locked } = po
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = (id: string) => {
    po.savePrice(id, Number(draft.replace(/[^\d.]/g, '')))
    setEditId(null)
  }

  return (
    <main className="cs-root" dir="rtl">
      <style>{consoleCss}</style>

      <header className="cs-top">
        <nav className="cs-crumb">
          المشتريات <i>/</i> اوامر الشراء <i>/</i> <b>{PO.number}</b>
        </nav>
        <div className="cs-actions">
          <span className="cs-pill" data-off={locked}>
            {locked ? 'مغلق' : 'مفتوح'}
          </span>
          <button className="cs-btn" type="button" disabled={locked}>
            اضف وحدة
          </button>
          <button
            className="cs-btn cs-btn--danger"
            type="button"
            disabled={locked}
            onClick={po.closePo}
          >
            اغلاق
          </button>
        </div>
      </header>

      <section className="cs-hero">
        <div className="cs-hero__id">
          <p className="cs-eyebrow">امر شراء · مورد خارجي</p>
          <h1 className="cs-number" dir="ltr">
            {PO.number}
          </h1>
          <p className="cs-party">{PO.party}</p>
          <div className="cs-chips">
            <span>{PO.company}</span>
            <span>{PO.project}</span>
            <span dir="ltr">{shortDate(PO.startDate)}</span>
          </div>
        </div>

        <div className="cs-kpis">
          <div className="cs-kpi">
            <span className="cs-kpi__label">الوحدات</span>
            <strong>{units.length}</strong>
            <span className="cs-kpi__sub">{unpriced} بلا سعر</span>
            <span className="cs-kpi__bar" aria-hidden="true">
              <i style={{ width: `${((units.length - unpriced) / units.length) * 100}%` }} />
            </span>
          </div>
          <div className="cs-kpi">
            <span className="cs-kpi__label">قبل الضريبة</span>
            <strong>{money(total)}</strong>
            <span className="cs-kpi__sub">ريال سعودي</span>
          </div>
          <div className="cs-kpi">
            <span className="cs-kpi__label">الضريبة 15%</span>
            <strong>{money(vat)}</strong>
            <span className="cs-kpi__sub">تضاف على الفاتورة</span>
          </div>
          <div className="cs-kpi cs-kpi--accent">
            <span className="cs-kpi__label">الاجمالي</span>
            <strong>{money(grand)}</strong>
            <span className="cs-kpi__sub">مع الضريبة</span>
          </div>
        </div>
      </section>

      <div className="cs-grid">
        <section className="cs-panel">
          <header className="cs-panel__head">
            <h2>وحدات السند</h2>
            <span className="cs-tag">{units.length} سجل</span>
          </header>

          <table className="cs-table">
            <thead>
              <tr>
                <th>الوحدة</th>
                <th>النوع</th>
                <th>المورد</th>
                <th>الفترة</th>
                <th className="cs-num">السعر</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id} data-missing={unit.price === null}>
                  <td>
                    <span className="cs-code">{unit.code}</span>
                    <span className="cs-plate">{unit.plate ?? unit.chassis ?? '—'}</span>
                  </td>
                  <td className="cs-muted">{unit.type}</td>
                  <td className="cs-muted">{unit.supplier}</td>
                  <td>
                    <span className="cs-period" dir="ltr">
                      {shortDate(unit.periodFrom)} →{' '}
                      {unit.periodTo ? shortDate(unit.periodTo) : '∞'}
                    </span>
                  </td>
                  <td className="cs-num">
                    {editId === unit.id ? (
                      <input
                        autoFocus
                        className="cs-input"
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={`سعر ${unit.code}`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commit(unit.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commit(unit.id)
                          if (event.key === 'Escape') setEditId(null)
                        }}
                      />
                    ) : (
                      <button
                        className="cs-price"
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          setEditId(unit.id)
                          setDraft(unit.price === null ? '' : String(unit.price))
                        }}
                        title={locked ? 'السند مغلق' : 'انقر للتعديل'}
                      >
                        {unit.price === null ? (
                          <span className="cs-unpriced">حدد السعر</span>
                        ) : (
                          <>
                            {money(unit.price)} <i>ر.س</i>
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="cs-sum">
            <span>
              الاجمالي قبل الضريبة <b>{money(total)}</b>
            </span>
            <span>
              الضريبة <b>{money(vat)}</b>
            </span>
            <span className="cs-sum__grand">
              الاجمالي <b>{money(grand)}</b>
            </span>
          </footer>
        </section>

        <aside className="cs-side">
          <section className="cs-panel">
            <header className="cs-panel__head">
              <h2>النشاط</h2>
              <span className="cs-tag">اخر {events.length}</span>
            </header>
            <ol className="cs-log">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="cs-log__dot" aria-hidden="true" />
                  <div>
                    <p className="cs-log__kind">{event.kind}</p>
                    <p className="cs-log__detail">{event.detail}</p>
                    <p className="cs-log__meta">
                      <span dir="ltr">{event.when}</span> · {event.actor}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="cs-panel cs-facts">
            <dl>
              <div>
                <dt>المورد</dt>
                <dd>{PO.party}</dd>
              </div>
              <div>
                <dt>المشروع</dt>
                <dd>{PO.project}</dd>
              </div>
              <div>
                <dt>البدء</dt>
                <dd dir="ltr">{shortDate(PO.startDate)}</dd>
              </div>
              <div>
                <dt>انشاه</dt>
                <dd>{PO.createdBy}</dd>
              </div>
            </dl>
            <p className="cs-note">{PO.notes}</p>
          </section>
        </aside>
      </div>
    </main>
  )
}

const consoleCss = `
.cs-root {
  --cs-bg: #070a0f;
  --cs-panel: #0d1219;
  --cs-line: #1a2531;
  --cs-text: #dfe7f1;
  --cs-muted: #7d8b9c;
  --cs-teal: #25d0b0;
  --cs-amber: #f5b544;
  --cs-danger: #ff5f57;
  background:
    radial-gradient(1100px 420px at 82% -10%, rgba(37, 208, 176, 0.09), transparent 60%),
    var(--cs-bg);
  color: var(--cs-text);
  font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif;
  min-height: 100dvh;
  padding-bottom: 40px;
}
.cs-root :focus-visible { outline: 2px solid var(--cs-teal); outline-offset: 2px; }

.cs-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px clamp(14px, 3vw, 34px);
  border-bottom: 1px solid var(--cs-line);
  background: rgba(8, 12, 18, 0.86);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 42px;
  z-index: 20;
  flex-wrap: wrap;
}
.cs-crumb { font-size: 12px; color: var(--cs-muted); letter-spacing: 0.01em; }
.cs-crumb i { font-style: normal; color: #3a4757; margin-inline: 6px; }
.cs-crumb b { color: var(--cs-text); font-weight: 500; }
.cs-actions { display: flex; align-items: center; gap: 8px; }
.cs-pill {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--cs-teal);
  background: rgba(37, 208, 176, 0.1);
  border: 1px solid rgba(37, 208, 176, 0.32);
}
.cs-pill[data-off='true'] {
  color: var(--cs-danger);
  background: rgba(255, 95, 87, 0.1);
  border-color: rgba(255, 95, 87, 0.3);
}
.cs-btn {
  font: inherit;
  font-size: 12.5px;
  padding: 7px 14px;
  border-radius: 7px;
  border: 1px solid #24313f;
  background: #131b24;
  color: var(--cs-text);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.cs-btn:hover:not(:disabled) { background: #1a2431; border-color: #2f4054; }
.cs-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cs-btn--danger { color: #ffb3ae; border-color: rgba(255, 95, 87, 0.34); }
.cs-btn--danger:hover:not(:disabled) { background: rgba(255, 95, 87, 0.14); }

.cs-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: clamp(18px, 3vw, 40px);
  align-items: end;
  padding: clamp(22px, 3.4vw, 38px) clamp(14px, 3vw, 34px);
}
.cs-eyebrow {
  margin: 0 0 8px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--cs-teal);
}
.cs-number {
  margin: 0;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-weight: 700;
  font-size: clamp(28px, 4.6vw, 50px);
  letter-spacing: -0.04em;
  direction: ltr;
  display: inline-block;
  background: linear-gradient(180deg, #ffffff, #9fb3c8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.cs-party { margin: 6px 0 12px; font-size: clamp(16px, 1.8vw, 21px); font-weight: 500; }
.cs-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.cs-chips span {
  font-size: 11px;
  color: var(--cs-muted);
  border: 1px solid var(--cs-line);
  border-radius: 6px;
  padding: 3px 9px;
  background: #0b1017;
}

.cs-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.cs-kpi {
  background: linear-gradient(180deg, #101822, #0b1119);
  border: 1px solid var(--cs-line);
  border-radius: 10px;
  padding: 13px 14px;
  display: grid;
  gap: 2px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.cs-kpi--accent { border-color: rgba(37, 208, 176, 0.4); background: linear-gradient(180deg, #0e2320, #08110f); }
.cs-kpi__label {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--cs-muted);
}
.cs-kpi strong {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: clamp(16px, 1.9vw, 23px);
  letter-spacing: -0.03em;
  font-weight: 600;
  direction: ltr;
  text-align: right;
}
.cs-kpi--accent strong { color: var(--cs-teal); }
.cs-kpi__sub { font-size: 10.5px; color: #5d6b7c; }
.cs-kpi__bar {
  margin-top: 7px;
  height: 3px;
  border-radius: 2px;
  background: #1a2431;
  overflow: hidden;
}
.cs-kpi__bar i { display: block; height: 100%; background: var(--cs-teal); border-radius: 2px; }

.cs-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(0, 1fr);
  gap: 14px;
  padding: 0 clamp(14px, 3vw, 34px);
  align-items: start;
}
.cs-panel {
  background: var(--cs-panel);
  border: 1px solid var(--cs-line);
  border-radius: 12px;
  overflow: hidden;
}
.cs-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 15px;
  border-bottom: 1px solid var(--cs-line);
}
.cs-panel__head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.cs-tag {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  color: var(--cs-muted);
  border: 1px solid var(--cs-line);
  border-radius: 4px;
  padding: 2px 7px;
}

.cs-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.cs-table th {
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cs-muted);
  font-weight: 500;
  text-align: start;
  padding: 9px 15px;
  border-bottom: 1px solid var(--cs-line);
  background: #0a0f16;
  white-space: nowrap;
}
.cs-table td { padding: 10px 15px; border-bottom: 1px solid #131c26; vertical-align: middle; }
.cs-table tbody tr { transition: background 0.14s; }
.cs-table tbody tr:hover { background: #101a25; }
.cs-table tbody tr[data-missing='true'] { background: rgba(245, 181, 68, 0.045); }
.cs-code {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-weight: 600;
  font-size: 12.5px;
  display: block;
  direction: ltr;
  text-align: right;
}
.cs-plate {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10px;
  color: #5f6d7e;
  display: block;
  margin-top: 2px;
}
.cs-muted { color: var(--cs-muted); }
.cs-period { font-family: 'PoTestMono', ui-monospace, monospace; font-size: 10.5px; color: #94a3b3; }
.cs-num { text-align: end; font-family: 'PoTestMono', ui-monospace, monospace; }
.cs-table th.cs-num { text-align: end; }
.cs-price {
  font: inherit;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  background: none;
  border: 1px dashed transparent;
  border-radius: 5px;
  padding: 3px 6px;
  color: var(--cs-text);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.cs-price i { font-style: normal; font-size: 9.5px; color: var(--cs-muted); margin-inline-start: 3px; }
.cs-price:hover:not(:disabled) { border-color: #2f4054; background: #0a1119; }
.cs-price:disabled { cursor: default; opacity: 0.85; }
.cs-unpriced {
  font-family: 'Thmanyah', sans-serif;
  font-size: 11px;
  color: var(--cs-amber);
  border: 1px solid rgba(245, 181, 68, 0.4);
  border-radius: 5px;
  padding: 3px 8px;
}
.cs-input {
  width: 108px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 13px;
  background: #060a0f;
  color: #fff;
  border: 1px solid var(--cs-teal);
  border-radius: 5px;
  padding: 4px 7px;
  direction: ltr;
  text-align: right;
}

.cs-sum {
  display: flex;
  justify-content: flex-end;
  gap: 22px;
  padding: 12px 15px;
  background: #0a0f16;
  border-top: 1px solid var(--cs-line);
  font-size: 11.5px;
  color: var(--cs-muted);
  flex-wrap: wrap;
}
.cs-sum b { font-family: 'PoTestMono', ui-monospace, monospace; color: var(--cs-text); margin-inline-start: 5px; }
.cs-sum__grand { color: var(--cs-text); }
.cs-sum__grand b { color: var(--cs-teal); font-size: 14px; }

.cs-side { display: grid; gap: 14px; }
.cs-log { list-style: none; margin: 0; padding: 12px 15px; display: grid; gap: 14px; }
.cs-log li { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 10px; position: relative; }
.cs-log li::before {
  content: '';
  position: absolute;
  inset-inline-start: 3.5px;
  top: 14px;
  bottom: -16px;
  width: 1px;
  background: var(--cs-line);
}
.cs-log li:last-child::before { display: none; }
.cs-log__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  background: #24313f;
  box-shadow: 0 0 0 3px rgba(37, 208, 176, 0.1);
}
.cs-log li:first-child .cs-log__dot { background: var(--cs-teal); }
.cs-log p { margin: 0; }
.cs-log__kind { font-size: 12.5px; font-weight: 600; }
.cs-log__detail {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #8fa0b3;
  margin-top: 1px !important;
}
.cs-log__meta { font-size: 10px; color: #5b6a7b; margin-top: 3px !important; }

.cs-facts { padding: 13px 15px; }
.cs-facts dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px 14px; }
.cs-facts dt { font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cs-muted); margin-bottom: 2px; }
.cs-facts dd { margin: 0; font-size: 12px; line-height: 1.4; }
.cs-note { margin: 14px 0 0; font-size: 11px; color: #6b7a8b; border-top: 1px solid var(--cs-line); padding-top: 11px; line-height: 1.6; }

@media (max-width: 1080px) {
  .cs-hero { grid-template-columns: minmax(0, 1fr); }
  .cs-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 720px) {
  .cs-top { position: static; }
  .cs-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cs-table th:nth-child(2), .cs-table td:nth-child(2),
  .cs-table th:nth-child(3), .cs-table td:nth-child(3) { display: none; }
  .cs-table th, .cs-table td { padding: 9px 10px; }
  .cs-period { font-size: 9.5px; white-space: nowrap; }
  .cs-period i { display: none; }
  .cs-price { font-size: 11.5px; white-space: nowrap; padding: 3px 2px; }
  .cs-price i { display: none; }
  .cs-unpriced { font-size: 10px; padding: 2px 5px; white-space: nowrap; }
  .cs-code { font-size: 11.5px; }
  .cs-plate { font-size: 9px; }
  .cs-facts dl { grid-template-columns: minmax(0, 1fr); }
  .cs-sum { gap: 10px; font-size: 10.5px; }
}
`

/* ── 03 · «فاتورة»: a printed A4 document ─────────────────────────── */

function InvoiceVariant({ po }: VariantProps) {
  const { units, total, vat, grand, unpriced, locked } = po

  return (
    <main className="iv-desk" dir="rtl">
      <style>{invoiceCss}</style>

      <div className="iv-tools">
        <span className="iv-tools__state">{locked ? 'مغلق' : 'مسودة'}</span>
        <button className="iv-print" type="button" onClick={() => window.print()}>
          طباعة
        </button>
      </div>

      <article className="iv-sheet">
        <header className="iv-head">
          <div className="iv-brand">
            <span className="iv-mark" aria-hidden="true">
              ع
            </span>
            <div>
              <p className="iv-brand__name">شركة عبدالله العزاني للمقاولات</p>
              <p className="iv-brand__meta">
                ادارة المعدات والاليات · الرياض · الرقم الضريبي 310000000000003
              </p>
            </div>
          </div>
          <div className="iv-title">
            <h1>امر شراء</h1>
            <p className="iv-title__en">PURCHASE ORDER</p>
            <dl>
              <div>
                <dt>الرقم</dt>
                <dd dir="ltr">{PO.number}</dd>
              </div>
              <div>
                <dt>التاريخ</dt>
                <dd dir="ltr">{shortDate(PO.startDate)}</dd>
              </div>
            </dl>
          </div>
        </header>

        <section className="iv-parties">
          <div>
            <h2>المورد</h2>
            <p className="iv-strong">{PO.party}</p>
            <p>طرف خارجي · عقود شهرية</p>
            <p>الرقم الضريبي عند الاصدار</p>
          </div>
          <div>
            <h2>الجهة الطالبة</h2>
            <p className="iv-strong">{PO.company}</p>
            <p>{PO.project}</p>
            <p>اصدره: {PO.createdBy}</p>
          </div>
          <div className="iv-termsbox">
            <h2>الشروط</h2>
            <p>{PO.notes}</p>
          </div>
        </section>

        <div className="iv-tablewrap">
        <table className="iv-table">
          <thead>
            <tr>
              <th className="iv-c">م</th>
              <th>البيان</th>
              <th>اللوحة / الشاسيه</th>
              <th>من</th>
              <th>الى</th>
              <th className="iv-c">السعر</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit, index) => (
              <tr key={`${unit.id}-${index}`}>
                <td className="iv-c iv-mono">{String(index + 1).padStart(2, '0')}</td>
                <td>
                  <span className="iv-mono iv-code">{unit.code}</span>{' '}
                  <span className="iv-type">{unit.type}</span>
                  <span className="iv-supplier">{unit.supplier}</span>
                </td>
                <td className="iv-mono iv-small">{unit.plate ?? unit.chassis ?? '—'}</td>
                <td className="iv-mono iv-small" dir="ltr">
                  {shortDate(unit.periodFrom)}
                </td>
                <td className="iv-mono iv-small" dir="ltr">
                  {unit.periodTo ? shortDate(unit.periodTo) : '—'}
                </td>
                <td className="iv-c iv-mono iv-amount">
                  {unit.price === null ? '—' : money(unit.price)}
                </td>
              </tr>
            ))}
            <tr className="iv-blank">
              <td colSpan={6}>نهاية البنود</td>
            </tr>
          </tbody>
        </table>
        </div>

        {unpriced > 0 && (
          <p className="iv-flag">
            تنبيه: {unpriced} وحدة بدون سعر ولم تدخل في المجاميع.
          </p>
        )}

        <section className="iv-totals">
          <div>
            <p className="iv-termsline">
              الاسعار شهرية ولا تشمل ضريبة القيمة المضافة. تصدر الفاتورة في نهاية
              كل شهر على اساس الساعات القياسية.
            </p>
          </div>
          <dl>
            <div>
              <dt>المجموع قبل الضريبة</dt>
              <dd dir="ltr">{money(total)}</dd>
            </div>
            <div>
              <dt>ضريبة القيمة المضافة 15%</dt>
              <dd dir="ltr">{money(vat)}</dd>
            </div>
            <div className="iv-total">
              <dt>الاجمالي المستحق</dt>
              <dd dir="ltr">
                {money(grand)} <span>ر.س</span>
              </dd>
            </div>
          </dl>
        </section>

        <footer className="iv-foot">
          <div className="iv-sign">
            <span>اعداد</span>
            <i />
            <b>{PO.createdBy}</b>
          </div>
          <div className="iv-sign">
            <span>اعتماد</span>
            <i />
            <b>ادارة المشتريات</b>
          </div>
          <div className="iv-sign">
            <span>المورد</span>
            <i />
            <b>الاسم والتوقيع</b>
          </div>
          <p className="iv-page">
            صفحة 1 من 1 · {PO.number}
          </p>
        </footer>
      </article>
    </main>
  )
}

const invoiceCss = `
.iv-desk {
  --iv-ink: #1d1c1a;
  --iv-soft: #6b6862;
  --iv-rule: #d7d3ca;
  --iv-red: #8c2f27;
  min-height: 100dvh;
  background:
    radial-gradient(circle at 20% 0%, #efece5, transparent 60%),
    #d8d4cb;
  color: var(--iv-ink);
  font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif;
  padding: 26px 16px 60px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  gap: 14px;
}
.iv-tools {
  width: min(794px, 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6a675f;
}
.iv-tools__state { border: 1px solid #b9b4a9; padding: 3px 8px; background: #e9e5dc; }
.iv-print {
  font: inherit;
  font-family: 'Thmanyah', sans-serif;
  font-size: 12px;
  letter-spacing: 0;
  text-transform: none;
  background: #1d1c1a;
  color: #f6f4ef;
  border: 0;
  padding: 7px 16px;
  cursor: pointer;
}
.iv-print:hover { background: var(--iv-red); }

.iv-sheet {
  min-width: 0;
  width: min(794px, 100%);
  background: #fdfcf9;
  padding: clamp(24px, 5vw, 54px);
  box-shadow: 0 22px 60px rgba(35, 30, 20, 0.22), 0 1px 0 rgba(0, 0, 0, 0.06);
  position: relative;
  font-size: 12.5px;
  line-height: 1.55;
}
.iv-sheet::after {
  content: '';
  position: absolute;
  inset: 14px;
  border: 1px solid #e3ded4;
  pointer-events: none;
}

.iv-head {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 20px;
  border-bottom: 2px solid var(--iv-ink);
  flex-wrap: wrap;
}
.iv-brand { display: flex; gap: 12px; align-items: flex-start; }
.iv-mark {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  background: var(--iv-ink);
  color: #fdfcf9;
  font-family: 'Thmanyah Serif Display', serif;
  font-size: 22px;
  line-height: 1;
}
.iv-brand__name { margin: 0; font-weight: 700; font-size: 14px; }
.iv-brand__meta { margin: 2px 0 0; font-size: 10px; color: var(--iv-soft); letter-spacing: 0.02em; }
.iv-title { text-align: end; }
.iv-title h1 {
  margin: 0;
  font-family: 'Thmanyah Serif Display', serif;
  font-size: 30px;
  line-height: 1.1;
  color: var(--iv-red);
  letter-spacing: -0.01em;
}
.iv-title__en {
  margin: 0 0 8px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 8.5px;
  letter-spacing: 0.28em;
  color: var(--iv-soft);
}
.iv-title dl { margin: 0; display: flex; gap: 16px; justify-content: flex-end; }
.iv-title dl div { text-align: end; }
.iv-title dt { font-size: 9px; letter-spacing: 0.08em; color: var(--iv-soft); }
.iv-title dd {
  margin: 1px 0 0;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 600;
}

.iv-parties {
  display: grid;
  grid-template-columns: 1fr 1fr 1.1fr;
  gap: 18px;
  padding: 18px 0 16px;
  border-bottom: 1px solid var(--iv-rule);
}
.iv-parties h2 {
  margin: 0 0 5px;
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--iv-soft);
  font-weight: 600;
}
.iv-parties p { margin: 0; font-size: 11.5px; color: #4c4a45; }
.iv-strong { font-weight: 700; font-size: 13px !important; color: var(--iv-ink) !important; margin-bottom: 2px !important; }
.iv-termsbox { border-inline-start: 1px solid var(--iv-rule); padding-inline-start: 16px; }
.iv-termsbox p { font-size: 10.5px; line-height: 1.6; }

.iv-tablewrap { overflow-x: auto; max-width: 100%; margin-top: 14px; }
.iv-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.iv-table th {
  background: #f1eee7;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
  color: #57544d;
  text-align: start;
  padding: 8px 9px;
  border-block: 1px solid var(--iv-rule);
  white-space: nowrap;
}
.iv-table td { padding: 9px; border-bottom: 1px solid #ece8df; vertical-align: top; }
.iv-table tbody tr:nth-child(even) { background: #faf8f3; }
.iv-c { text-align: center; }
.iv-mono { font-family: 'PoTestMono', ui-monospace, monospace; }
.iv-small { font-size: 10px; color: #55524b; white-space: nowrap; }
.iv-code { font-weight: 700; font-size: 11.5px; }
.iv-type { display: block; font-size: 10px; color: var(--iv-soft); letter-spacing: 0.02em; }
.iv-supplier { display: block; font-size: 10px; color: #7d7a72; }
.iv-amount { font-weight: 600; white-space: nowrap; }
.iv-blank td {
  text-align: center;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: #b3aea3;
  border-bottom: 1.5px solid var(--iv-ink);
  padding: 7px;
}
.iv-flag {
  margin: 10px 0 0;
  font-size: 10px;
  color: var(--iv-red);
  border: 1px solid rgba(140, 47, 39, 0.3);
  background: rgba(140, 47, 39, 0.05);
  padding: 6px 9px;
}

.iv-totals {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 24px;
  margin-top: 16px;
  align-items: start;
}
.iv-termsline { margin: 0; font-size: 10px; color: var(--iv-soft); line-height: 1.7; }
.iv-totals dl { margin: 0; }
.iv-totals dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  border-bottom: 1px dotted #ddd8cd;
  font-size: 11.5px;
}
.iv-totals dt { color: #55524b; }
.iv-totals dd { margin: 0; font-family: 'PoTestMono', ui-monospace, monospace; font-weight: 600; }
.iv-total {
  margin-top: 6px;
  background: var(--iv-ink);
  color: #fdfcf9;
  border-bottom: 0 !important;
  padding: 9px 11px !important;
  align-items: center;
}
.iv-total dt { color: #e8e4da; font-weight: 600; }
.iv-total dd { font-size: 17px; letter-spacing: -0.02em; }
.iv-total dd span { font-size: 9px; color: #b8b3a8; margin-inline-start: 4px; }

.iv-foot {
  margin-top: 30px;
  padding-top: 16px;
  border-top: 1px solid var(--iv-rule);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.iv-sign { display: grid; gap: 4px; font-size: 10px; }
.iv-sign span { color: var(--iv-soft); letter-spacing: 0.08em; font-size: 9px; }
.iv-sign i { display: block; height: 26px; border-bottom: 1px solid #7c7972; }
.iv-sign b { font-weight: 600; font-size: 10.5px; }
.iv-page {
  grid-column: 1 / -1;
  margin: 8px 0 0;
  text-align: center;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 8.5px;
  letter-spacing: 0.14em;
  color: #a8a49b;
}

@media (max-width: 700px) {
  .iv-head { flex-direction: column; align-items: stretch; gap: 14px; }
  .iv-title { text-align: start; }
  .iv-title dl { justify-content: flex-start; }
  .iv-title dl div { text-align: start; }
  .iv-parties { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .iv-termsbox { border-inline-start: 0; padding-inline-start: 0; border-top: 1px solid var(--iv-rule); padding-top: 12px; }
  .iv-totals { grid-template-columns: minmax(0, 1fr); }
  .iv-table { min-width: 600px; }
  .iv-table td, .iv-table th { padding: 7px 7px; }
  .iv-sheet { padding: 20px 16px; }
  .iv-foot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media print {
  .iv-desk { background: #fff; padding: 0; }
  .iv-tools { display: none; }
  .iv-sheet { box-shadow: none; width: 100%; padding: 14mm; }
}
`

/* ── 04 · «بطاقات»: the unit is a card, the price is the hero ──────── */

const DECK_HUES = ['#e2703a', '#3f8f7d', '#c9a227', '#9a6bb8', '#4f7ec9', '#c0504d']

function hueFor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 9973
  return DECK_HUES[hash % DECK_HUES.length]
}

function DeckVariant({ po }: VariantProps) {
  const { units, total, vat, grand, unpriced, locked } = po
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [closing, setClosing] = useState(false)

  const commit = (id: string) => {
    po.savePrice(id, Number(draft.replace(/[^\d.]/g, '')))
    setEditId(null)
  }

  return (
    <main className="dk-root" dir="rtl">
      <style>{deckCss}</style>

      <header className="dk-head">
        <div>
          <p className="dk-kicker">امر شراء · {PO.number}</p>
          <h1 className="dk-title">{PO.party}</h1>
          <p className="dk-sub">
            {PO.company} · {PO.project}
          </p>
        </div>
        <div className="dk-head__act">
          <span className="dk-state" data-off={locked}>
            {locked ? 'مغلق' : 'مفتوح'}
          </span>
          {closing ? (
            <>
              <button className="dk-btn dk-btn--fire" type="button" onClick={po.closePo}>
                تاكيد الاغلاق
              </button>
              <button className="dk-btn" type="button" onClick={() => setClosing(false)}>
                تراجع
              </button>
            </>
          ) : (
            <button
              className="dk-btn"
              type="button"
              disabled={locked}
              onClick={() => setClosing(true)}
            >
              اغلاق السند
            </button>
          )}
        </div>
      </header>

      <section className="dk-strip">
        <div>
          <span>الوحدات</span>
          <strong>{units.length}</strong>
        </div>
        <div>
          <span>قبل الضريبة</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>الضريبة</span>
          <strong>{money(vat)}</strong>
        </div>
        <div className="dk-strip__total">
          <span>الاجمالي</span>
          <strong>{money(grand)}</strong>
        </div>
      </section>

      <section className="dk-grid">
        {units.map((unit, index) => (
          <article
            key={unit.id}
            className="dk-card"
            style={{ ['--hue' as string]: hueFor(unit.supplier) }}
            data-open={editId === unit.id}
          >
            <div className="dk-card__top">
              <span className="dk-card__idx">{String(index + 1).padStart(2, '0')}</span>
              <span className="dk-card__supplier">{unit.supplier}</span>
            </div>

            <h2 className="dk-card__code" dir="ltr">
              {unit.code}
            </h2>
            <p className="dk-card__type">{unit.type}</p>
            <p className="dk-card__meta">
              <span dir="auto">{unit.plate ?? unit.chassis ?? '—'}</span>
              <i aria-hidden="true">/</i>
              <span dir="ltr">
                {shortDate(unit.periodFrom)} → {unit.periodTo ? shortDate(unit.periodTo) : '∞'}
              </span>
            </p>

            {unit.note && <p className="dk-card__note">{unit.note}</p>}

            <div className="dk-card__price">
              {editId === unit.id ? (
                <div className="dk-edit">
                  <input
                    autoFocus
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={`سعر ${unit.code}`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(unit.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(unit.id)
                      if (event.key === 'Escape') setEditId(null)
                    }}
                  />
                  <span>ر.س</span>
                </div>
              ) : (
                <button
                  className="dk-price"
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setEditId(unit.id)
                    setDraft(unit.price === null ? '' : String(unit.price))
                  }}
                >
                  {unit.price === null ? (
                    <span className="dk-price__empty">حدد السعر</span>
                  ) : (
                    <>
                      <span className="dk-price__num" dir="ltr">
                        {money(unit.price)}
                      </span>
                      <span className="dk-price__cur">ر.س / شهر</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <span className="dk-card__rule" aria-hidden="true" />
          </article>
        ))}

        <article className="dk-card dk-card--sum">
          <div className="dk-sumcap">
            <p className="dk-card__type">خلاصة السند</p>
            {unpriced > 0 && (
              <p className="dk-card__note">{unpriced} وحدة بلا سعر</p>
            )}
          </div>
          <p className="dk-sumline">
            <span>{units.length} وحدة</span>
            <b>{money(total)}</b>
          </p>
          <p className="dk-sumline">
            <span>ضريبة 15%</span>
            <b>{money(vat)}</b>
          </p>
          <p className="dk-sumline dk-sumline--grand">
            <span>الاجمالي</span>
            <b>{money(grand)}</b>
          </p>
        </article>
      </section>
    </main>
  )
}

const deckCss = `
.dk-root {
  --dk-bg: #17130f;
  --dk-card: #211b16;
  --dk-line: #33291f;
  --dk-text: #f4ece1;
  --dk-muted: #a2937f;
  --dk-gold: #d9a441;
  min-height: 100dvh;
  color: var(--dk-text);
  font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif;
  padding: clamp(16px, 3vw, 34px) clamp(14px, 3.4vw, 46px) 60px;
  background:
    radial-gradient(900px 500px at 88% -8%, rgba(217, 164, 65, 0.16), transparent 62%),
    radial-gradient(700px 460px at 4% 100%, rgba(63, 143, 125, 0.12), transparent 60%),
    var(--dk-bg);
}

.dk-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--dk-line);
}
.dk-kicker {
  margin: 0 0 6px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--dk-gold);
}
.dk-title {
  margin: 0;
  font-family: 'Thmanyah Serif Display', 'Thmanyah', serif;
  font-size: clamp(24px, 3.4vw, 40px);
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.dk-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--dk-muted); }
.dk-head__act { display: flex; align-items: center; gap: 8px; }
.dk-state {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.16em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(63, 143, 125, 0.5);
  color: #7bd3bd;
  background: rgba(63, 143, 125, 0.12);
}
.dk-state[data-off='true'] { color: #e8846b; border-color: rgba(232, 132, 107, 0.45); background: rgba(232, 132, 107, 0.1); }
.dk-btn {
  font: inherit;
  font-size: 12.5px;
  padding: 8px 15px;
  border-radius: 999px;
  background: transparent;
  color: var(--dk-text);
  border: 1px solid #4a3b2c;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.dk-btn:hover:not(:disabled) { background: #2c231b; border-color: #6b543c; }
.dk-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.dk-btn--fire { background: #b8452c; border-color: #b8452c; }
.dk-btn--fire:hover { background: #cf5334; border-color: #cf5334; }

.dk-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 18px 0 22px;
  border: 1px solid var(--dk-line);
  border-radius: 14px;
  overflow: hidden;
  background: rgba(33, 27, 22, 0.7);
}
.dk-strip > div {
  padding: 12px 16px;
  border-inline-start: 1px solid var(--dk-line);
  display: grid;
  gap: 2px;
}
.dk-strip > div:first-child { border-inline-start: 0; }
.dk-strip span {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dk-muted);
}
.dk-strip strong {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: clamp(15px, 1.7vw, 20px);
  letter-spacing: -0.03em;
  direction: ltr;
  text-align: right;
}
.dk-strip__total strong { color: var(--dk-gold); }

.dk-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.dk-card {
  position: relative;
  background: linear-gradient(165deg, #241d17, #1b1511 60%);
  border: 1px solid var(--dk-line);
  border-radius: 18px;
  padding: 18px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  transition: transform 0.18s ease, border-color 0.18s, box-shadow 0.18s;
}
.dk-card::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--hue, var(--dk-gold));
  opacity: 0.85;
}
.dk-card:hover {
  transform: translateY(-3px);
  border-color: #4a3b2c;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
}
.dk-card[data-open='true'] { border-color: var(--dk-gold); }
.dk-card__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dk-card__idx {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--dk-muted);
}
.dk-card__supplier {
  font-size: 10.5px;
  color: var(--dk-muted);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dk-card__code {
  margin: 12px 0 0;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: clamp(30px, 3.4vw, 42px);
  line-height: 1;
  letter-spacing: -0.05em;
  direction: ltr;
  text-align: right;
}
.dk-card__type {
  margin: 6px 0 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--dk-muted);
}
.dk-card__meta {
  margin: 8px 0 0;
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10px;
  color: #8d7f6d;
}
.dk-card__meta i { font-style: normal; color: #4a3b2c; }

.dk-card__price { margin-top: auto; padding-top: 16px; }
.dk-price {
  font: inherit;
  width: 100%;
  text-align: start;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  display: grid;
  gap: 2px;
}
.dk-price:disabled { cursor: default; }
.dk-price__num {
  text-align: right;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: clamp(24px, 2.6vw, 32px);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.05;
  display: block;
  transition: color 0.15s;
}
.dk-price:hover:not(:disabled) .dk-price__num { color: var(--dk-gold); }
.dk-price__cur {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  color: var(--dk-muted);
}
.dk-price__empty {
  font-size: 13px;
  color: var(--dk-gold);
  border: 1px dashed rgba(217, 164, 65, 0.55);
  border-radius: 8px;
  padding: 8px 0;
  text-align: center;
  display: block;
}
.dk-edit { display: flex; align-items: baseline; gap: 6px; }
.dk-edit input {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.04em;
  width: 100%;
  background: #120e0b;
  color: var(--dk-text);
  border: 0;
  border-bottom: 2px solid var(--dk-gold);
  padding: 2px 0;
  direction: ltr;
  text-align: right;
}
.dk-edit input:focus { outline: none; }
.dk-edit span { font-family: 'PoTestMono', ui-monospace, monospace; font-size: 9.5px; color: var(--dk-muted); }
.dk-card__note { margin: 8px 0 0; font-size: 10.5px; color: #8d7f6d; line-height: 1.5; }
.dk-card__rule { display: block; }

.dk-card--sum {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1.2fr repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 22px;
  background: linear-gradient(165deg, #2a2118, #1d1712);
  border-color: #4a3b2c;
}
.dk-sumcap { display: grid; gap: 2px; align-content: center; }
.dk-card--sum .dk-card__note { margin: 0; }
.dk-card--sum .dk-sumline { margin: 0; padding: 0; border-bottom: 0; flex-direction: column; align-items: flex-start; gap: 2px; }
.dk-card--sum .dk-sumline--grand { border-inline-start: 1px solid var(--dk-line); padding-inline-start: 22px; }
.dk-card--sum::before { background: var(--dk-gold); }
.dk-sumline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--dk-muted);
  border-bottom: 1px dotted #3d3127;
  padding-bottom: 6px;
}
.dk-sumline b { font-family: 'PoTestMono', ui-monospace, monospace; font-size: 13px; color: var(--dk-text); }
.dk-sumline--grand { border-bottom: 0; margin-top: 14px; }
.dk-sumline--grand span { color: var(--dk-text); font-weight: 600; }
.dk-sumline--grand b { font-size: clamp(22px, 2.4vw, 28px); color: var(--dk-gold); letter-spacing: -0.04em; }

@media (max-width: 980px) {
  .dk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .dk-grid { grid-template-columns: minmax(0, 1fr); }
  .dk-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dk-strip > div:nth-child(3) { border-inline-start: 0; border-top: 1px solid var(--dk-line); }
  .dk-strip > div:nth-child(4) { border-top: 1px solid var(--dk-line); }
}
`

/* ── 05 · «شبكة»: a spreadsheet, cells and all ────────────────────── */

const GRID_COLS = ['م', 'الوحدة', 'النوع', 'المورد', 'من', 'الى', 'السعر']
const GRID_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

function GridVariant({ po }: VariantProps) {
  const { units, total, vat, grand, unpriced, locked } = po
  const [sel, setSel] = useState<{ row: number; col: number }>({ row: 1, col: 6 })
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const selectedUnit = units[sel.row - 1]
  const formula =
    sel.col === 6
      ? selectedUnit
        ? selectedUnit.price === null
          ? 'NULL'
          : money(selectedUnit.price)
        : ''
      : ''

  const commit = (id: string) => {
    po.savePrice(id, Number(draft.replace(/[^\d.]/g, '')))
    setEditId(null)
  }

  return (
    <main className="gr-root" dir="rtl">
      <style>{gridCss}</style>

      <div className="gr-titlebar">
        <span className="gr-file">امر_الشراء_{PO.number}.xlsx</span>
        <span className="gr-file__meta">
          {locked ? 'للقراءة فقط' : 'قابل للتعديل'} · {PO.party}
        </span>
        <div className="gr-file__act">
          <button className="gr-btn" type="button" disabled={locked}>
            + وحدة
          </button>
          <button
            className="gr-btn gr-btn--danger"
            type="button"
            disabled={locked}
            onClick={po.closePo}
          >
            اغلاق السند
          </button>
        </div>
      </div>

      <div className="gr-formula">
        <span className="gr-namebox">{GRID_LETTERS[sel.col]}{sel.row + 1}</span>
        <span className="gr-fx">fx</span>
        <span className="gr-formula__value">
          <bdi dir="ltr">{formula}</bdi>
        </span>
      </div>

      <div className="gr-sheetwrap">
        <div className="gr-sheet">
          <div className="gr-row gr-row--head">
            <span className="gr-gutter" />
            {GRID_LETTERS.map((letter, index) => (
              <span key={letter} className="gr-letter" data-active={index === sel.col}>
                {letter}
              </span>
            ))}
          </div>
          <div className="gr-row gr-row--names">
            <span className="gr-gutter">1</span>
            {GRID_COLS.map((name, index) => (
              <span key={name} className="gr-colname" data-active={index === sel.col}>
                {name}
              </span>
            ))}
          </div>

          {units.map((unit, rowIndex) => {
            const rowNumber = rowIndex + 2
            return (
              <div
                key={unit.id}
                className="gr-row gr-row--data"
                data-missing={unit.price === null}
                data-sel={sel.row === rowNumber}
              >
                <span className="gr-gutter">{rowNumber}</span>
                <span className="gr-cell gr-cell--num">{rowIndex + 1}</span>
                <span className="gr-cell gr-code">{unit.code}</span>
                <span className="gr-cell gr-muted">{unit.type}</span>
                <span className="gr-cell gr-muted">{unit.supplier}</span>
                <span className="gr-cell gr-cell--date" dir="ltr">
                  {shortDate(unit.periodFrom)}
                </span>
                <span className="gr-cell gr-cell--date" dir="ltr">
                  {unit.periodTo ? shortDate(unit.periodTo) : '—'}
                </span>
                <span
                  className="gr-cell gr-cell--money"
                  data-sel={sel.row === rowNumber && sel.col === 6}
                  onClick={() => setSel({ row: rowNumber, col: 6 })}
                >
                  {editId === unit.id ? (
                    <input
                      autoFocus
                      inputMode="decimal"
                      dir="ltr"
                      aria-label={`سعر ${unit.code}`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => commit(unit.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commit(unit.id)
                        if (event.key === 'Escape') setEditId(null)
                      }}
                    />
                  ) : (
                    <button
                      className="gr-money"
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        setEditId(unit.id)
                        setDraft(unit.price === null ? '' : String(unit.price))
                      }}
                    >
                      {unit.price === null ? (
                        <span className="gr-null">NULL</span>
                      ) : (
                        money(unit.price)
                      )}
                    </button>
                  )}
                </span>
              </div>
            )
          })}

          <div className="gr-row gr-row--sum">
            <span className="gr-gutter">Σ</span>
            <span className="gr-cell gr-sumlabel">المجموع</span>
            <span className="gr-cell gr-muted" />
            <span className="gr-cell gr-muted" />
            <span className="gr-cell gr-muted">
              {unpriced > 0 ? `${unpriced} بلا سعر` : 'مسعّرة'}
            </span>
            <span className="gr-cell" />
            <span className="gr-cell" />
            <span className="gr-cell gr-cell--money gr-sumvalue" dir="ltr">
              {money(total)}
            </span>
          </div>
          <div className="gr-row gr-row--sum">
            <span className="gr-gutter" />
            <span className="gr-cell gr-sumlabel" dir="ltr">
              VAT 15%
            </span>
            <span className="gr-cell gr-muted" />
            <span className="gr-cell gr-muted" />
            <span className="gr-cell gr-muted" />
            <span className="gr-cell" />
            <span className="gr-cell" />
            <span className="gr-cell gr-cell--money" dir="ltr">
              {money(vat)}
            </span>
          </div>
          <div className="gr-row gr-row--grand">
            <span className="gr-gutter" />
            <span className="gr-cell gr-sumlabel" dir="ltr">
              TOTAL
            </span>
            <span className="gr-cell gr-muted" />
            <span className="gr-cell gr-muted" />
            <span className="gr-cell gr-muted" />
            <span className="gr-cell" />
            <span className="gr-cell" />
            <span className="gr-cell gr-cell--money gr-grand" dir="ltr">
              {money(grand)}
            </span>
          </div>

          {Array.from({ length: 26 }, (_, index) => (
            <div className="gr-row gr-row--ghost" key={`ghost-${index}`}>
              <span className="gr-gutter">{units.length + index + 2}</span>
              {GRID_LETTERS.map((letter) => (
                <span className="gr-cell" key={`ghost-${index}-${letter}`} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="gr-status">
        <span className="gr-tab">السند</span>
        <span className="gr-tab gr-tab--ghost">الاحداث</span>
        <span className="gr-status__msg">
          {units.length} صفوف · {units.length - unpriced} مسعّرة · جاهز
        </span>
        <span className="gr-status__zoom">100%</span>
      </div>
    </main>
  )
}

const gridCss = `
.gr-root {
  --gr-bg: #f3f5f3;
  min-height: calc(100dvh - 42px);
  --gr-line: #dfe4df;
  --gr-line2: #cfd6cf;
  --gr-head: #eef1ee;
  --gr-ink: #1d241f;
  --gr-muted: #6d7a70;
  --gr-green: #217346;
  --gr-select: #e6f0e8;
  background: var(--gr-bg);
  color: var(--gr-ink);
  font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif;
  display: flex;
  flex-direction: column;
}

.gr-titlebar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 14px;
  background: var(--gr-green);
  color: #eaf5ee;
  flex-wrap: wrap;
}
.gr-file { font-size: 13px; font-weight: 500; }
.gr-file__meta { font-size: 11px; color: rgba(234, 245, 238, 0.72); }
.gr-file__act { margin-inline-start: auto; display: flex; gap: 6px; }
.gr-btn {
  font: inherit;
  font-size: 11.5px;
  padding: 4px 11px;
  border-radius: 4px;
  border: 1px solid rgba(234, 245, 238, 0.4);
  background: rgba(255, 255, 255, 0.1);
  color: #eaf5ee;
  cursor: pointer;
}
.gr-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
.gr-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.gr-btn--danger { border-color: rgba(255, 210, 200, 0.55); color: #ffe3db; }

.gr-formula {
  display: flex;
  align-items: stretch;
  background: #fff;
  border-bottom: 1px solid var(--gr-line2);
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 11.5px;
}
.gr-namebox {
  min-width: 62px;
  padding: 5px 10px;
  border-inline-end: 1px solid var(--gr-line2);
  color: var(--gr-muted);
  text-align: center;
}
.gr-fx {
  padding: 5px 9px;
  color: #9aa79c;
  border-inline-end: 1px solid var(--gr-line);
  font-style: italic;
}
.gr-formula__value { flex: 1; padding: 5px 10px; color: #33403a; text-align: start; }

.gr-sheetwrap { flex: 1; overflow: auto; background: #fff; padding: 0 0 0; }
.gr-sheet { min-width: 860px; background: #fff; }
.gr-row--ghost { color: #b3bdb5; }
.gr-row--ghost .gr-gutter { color: #b3bdb5; }

.gr-row {
  display: grid;
  grid-template-columns: 38px 46px 92px minmax(0, 1.15fr) minmax(0, 1.25fr) 92px 92px 128px;
  border-bottom: 1px solid var(--gr-line);
  align-items: stretch;
}
.gr-row--head { background: var(--gr-head); border-bottom: 1px solid var(--gr-line2); }
.gr-row--names { background: #f7f9f7; }
.gr-row--data:hover { background: #fbfcfb; }
.gr-row--data[data-sel='true'] { background: var(--gr-select); }
.gr-row--data[data-missing='true'] .gr-cell--money { background: #fdf6e6; }

.gr-gutter {
  display: grid;
  place-items: center;
  background: var(--gr-head);
  border-inline-end: 1px solid var(--gr-line2);
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9.5px;
  color: #93a094;
}
.gr-letter,
.gr-colname {
  display: grid;
  place-items: center;
  padding: 4px 6px;
  border-inline-end: 1px solid var(--gr-line);
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: #7d8a7f;
}
.gr-colname {
  font-family: 'Thmanyah', sans-serif;
  font-size: 11px;
  letter-spacing: 0;
  color: #4f5c53;
  font-weight: 500;
}
.gr-letter[data-active='true'],
.gr-colname[data-active='true'] {
  background: #d8e8dc;
  color: var(--gr-green);
  font-weight: 700;
}
.gr-cell {
  padding: 6px 8px;
  border-inline-end: 1px solid var(--gr-line);
  font-size: 12px;
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gr-cell--num { justify-content: center; color: var(--gr-muted); font-size: 10px; }
.gr-code {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-weight: 600;
  font-size: 12px;
  direction: ltr;
  justify-content: flex-end;
}
.gr-muted { color: var(--gr-muted); font-size: 11.5px; }
.gr-cell--date {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #55635a;
  justify-content: flex-end;
}
.gr-cell--money { justify-content: flex-end; font-family: 'PoTestMono', ui-monospace, monospace; }
.gr-cell--money[data-sel='true'] { box-shadow: inset 0 0 0 2px var(--gr-green); background: #f2f9f4; }
.gr-money {
  font: inherit;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12px;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 1px 3px;
  border-radius: 2px;
}
.gr-money:hover:not(:disabled) { background: #eef4ef; box-shadow: inset 0 0 0 1px #b9cdbe; }
.gr-money:disabled { cursor: default; }
.gr-null {
  font-size: 10px;
  color: #b07b1e;
  border: 1px solid #e0c88d;
  border-radius: 2px;
  padding: 0 4px;
  background: #fdf6e6;
}
.gr-cell--money input {
  width: 100%;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12px;
  border: 0;
  outline: 2px solid var(--gr-green);
  padding: 3px 5px;
  direction: ltr;
  text-align: right;
  background: #fff;
}

.gr-row--sum { background: #f7f9f7; border-top: 1px solid var(--gr-line2); }
.gr-row--grand { background: #eef4ef; border-top: 1px solid var(--gr-green); }
.gr-sumlabel { font-size: 11px; font-weight: 600; color: #3c4a41; }
.gr-sumvalue { font-weight: 600; }
.gr-grand { font-weight: 700; color: var(--gr-green); font-size: 13px; }

.gr-status {
  display: flex;
  align-items: center;
  gap: 0;
  background: #e9ece9;
  border-top: 1px solid var(--gr-line2);
  font-size: 10.5px;
  color: #5c6a60;
  padding: 0 8px;
}
.gr-tab {
  padding: 4px 14px;
  background: #fff;
  border: 1px solid var(--gr-line2);
  border-bottom: 0;
  font-size: 11px;
  color: var(--gr-green);
  font-weight: 600;
}
.gr-tab--ghost { background: #eef1ee; color: #7f8c83; font-weight: 400; }
.gr-status__msg { margin-inline-start: 12px; }
.gr-status__zoom { margin-inline-start: auto; font-family: 'PoTestMono', ui-monospace, monospace; }

@media (max-width: 700px) {
  .gr-formula { font-size: 10.5px; }
  .gr-status__zoom { display: none; }
}
`

/* ── 06 · «طرفية»: the PO as a command-line session ───────────────── */

function TerminalVariant({ po }: VariantProps) {
  const { units, events, total, vat, grand, unpriced, locked } = po
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = (id: string) => {
    po.savePrice(id, Number(draft.replace(/[^\d.]/g, '')))
    setEditId(null)
  }

  return (
    <main className="tm-root" dir="rtl">
      <style>{terminalCss}</style>

      <div className="tm-window">
        <div className="tm-title">
          <span className="tm-title__dots" aria-hidden="true">
            <i /> <i /> <i />
          </span>
          <span>purchasing — po — 132×40</span>
          <span className="tm-title__state" data-off={locked}>
            {locked ? 'closed' : 'open'}
          </span>
        </div>

        <div className="tm-body">
          <p className="tm-cmd">
            <b>$</b> po show {PO.number} <span className="tm-flag">--items</span>
          </p>
          <p className="tm-out">
            <span className="tm-ok">[ok]</span> {units.length} units ·{' '}
            {unpriced > 0 ? (
              <span className="tm-warn">{unpriced} unpriced</span>
            ) : (
              'all priced'
            )}{' '}
            · {locked ? 'locked' : 'editable'}
          </p>

          <dl className="tm-meta">
            <div>
              <dt>party</dt>
              <dd>{PO.party}</dd>
            </div>
            <div>
              <dt>company</dt>
              <dd>{PO.company}</dd>
            </div>
            <div>
              <dt>project</dt>
              <dd>{PO.project}</dd>
            </div>
            <div>
              <dt>start</dt>
              <dd>
                <bdi dir="ltr">{shortDate(PO.startDate)}</bdi>
              </dd>
            </div>
            <div>
              <dt>author</dt>
              <dd>{PO.createdBy}</dd>
            </div>
          </dl>

          <p className="tm-section" aria-hidden="true">
            <span>units</span>
          </p>

          <div className="tm-table" role="table" aria-label="وحدات السند">
            <div className="tm-tr tm-tr--head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">code</span>
              <span role="columnheader" className="tm-type">
                type
              </span>
              <span role="columnheader" className="tm-supplier">
                supplier
              </span>
              <span role="columnheader" className="tm-period">
                period
              </span>
              <span role="columnheader" className="tm-end">
                price
              </span>
            </div>
            {units.map((unit, index) => (
              <div className="tm-tr" role="row" key={unit.id} data-missing={unit.price === null}>
                <span className="tm-dim" role="cell">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="tm-code" role="cell">
                  {unit.code}
                </span>
                <span className="tm-type" role="cell">
                  {unit.type}
                </span>
                <span className="tm-supplier" role="cell">
                  {unit.supplier}
                </span>
                <span className="tm-period" role="cell" dir="ltr">
                  {shortDate(unit.periodFrom)}→{unit.periodTo ? shortDate(unit.periodTo) : 'now'}
                </span>
                <span className="tm-end tm-money" role="cell">
                  {editId === unit.id ? (
                    <span className="tm-input">
                      <b>$</b>
                      <input
                        autoFocus
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={`سعر ${unit.code}`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commit(unit.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commit(unit.id)
                          if (event.key === 'Escape') setEditId(null)
                        }}
                      />
                    </span>
                  ) : (
                    <button
                      className="tm-price"
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        setEditId(unit.id)
                        setDraft(unit.price === null ? '' : String(unit.price))
                      }}
                    >
                      {unit.price === null ? (
                        <span className="tm-warn">set price…</span>
                      ) : (
                        money(unit.price)
                      )}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="tm-sums">
            <p>
              <span className="tm-dim">subtotal</span>
              <span className="tm-dots" aria-hidden="true" />
              <b dir="ltr">{money(total)}</b>
            </p>
            <p>
              <span className="tm-dim">vat 15%</span>
              <span className="tm-dots" aria-hidden="true" />
              <b dir="ltr">{money(vat)}</b>
            </p>
            <p className="tm-sums__total">
              <span>total</span>
              <span className="tm-dots" aria-hidden="true" />
              <b dir="ltr">{money(grand)} SAR</b>
            </p>
          </div>

          <p className="tm-section" aria-hidden="true">
            <span>log</span>
          </p>
          <ol className="tm-log">
            {events.map((event) => (
              <li key={event.id}>
                <span className="tm-dim tm-log__when">
                  <bdi dir="ltr">[{event.when}]</bdi>
                </span>
                <span className="tm-ok tm-log__kind">{event.kind}</span>
                <span className="tm-log__detail">
                  <bdi dir="ltr">{event.detail}</bdi>
                </span>
                <span className="tm-dim tm-log__actor">{event.actor}</span>
              </li>
            ))}
          </ol>

          <div className="tm-prompt">
            {locked ? (
              <>
                <b>$</b> po close {PO.number} <span className="tm-flag">--yes</span>
                <p className="tm-out">
                  <span className="tm-ok">[done]</span>{' '}
                  <bdi dir="ltr">document closed, writes disabled.</bdi>
                </p>
              </>
            ) : (
              <button className="tm-close" type="button" onClick={po.closePo}>
                <b>$</b>
                <bdi dir="ltr">
                  po close {PO.number} <span className="tm-flag">--yes</span>
                </bdi>
                <i className="tm-caret" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

const terminalCss = `
.tm-root {
  --tm-bg: #060807;
  --tm-panel: #0a0d0b;
  --tm-text: #b8c9bc;
  --tm-dim: #56645b;
  --tm-green: #4ade80;
  --tm-amber: #d9a441;
  --tm-red: #ef6b5a;
  --tm-rule: #1b241e;
  min-height: 100dvh;
  background: var(--tm-bg);
  color: var(--tm-text);
  font-family: 'PoTestMono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: clamp(10px, 2.4vw, 30px);
  display: flex;
  justify-content: center;
}
.tm-root :focus-visible { outline: 1px solid var(--tm-green); outline-offset: 2px; }

.tm-window {
  width: min(1080px, 100%);
  background: var(--tm-panel);
  border: 1px solid #1e2a22;
  border-radius: 6px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  align-self: flex-start;
}
.tm-title {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #101713;
  border-bottom: 1px solid #1e2a22;
  font-size: 10.5px;
  color: var(--tm-dim);
}
.tm-title__dots { display: inline-flex; gap: 5px; }
.tm-title__dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #24302a;
  display: block;
}
.tm-title__state { margin-inline-start: auto; color: var(--tm-green); letter-spacing: 0.1em; }
.tm-title__state[data-off='true'] { color: var(--tm-red); }

.tm-body { padding: 18px 18px 22px; line-height: 1.75; }

.tm-cmd { margin: 0; color: #e6f0e8; }
.tm-cmd b, .tm-prompt b { color: var(--tm-green); margin-inline-end: 6px; }
.tm-flag { color: var(--tm-amber); }
.tm-out { margin: 2px 0 14px; color: var(--tm-text); }
.tm-ok { color: var(--tm-green); }
.tm-warn { color: var(--tm-amber); }
.tm-dim { color: var(--tm-dim); }

.tm-meta { margin: 0 0 16px; display: grid; gap: 0; }
.tm-meta div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  border-bottom: 1px dotted #182018;
  padding: 3px 0;
}
.tm-meta dt { color: var(--tm-dim); }
.tm-meta dd { margin: 0; color: #d3e0d6; font-family: 'Thmanyah', 'Segoe UI', Tahoma, sans-serif; font-size: 12.5px; }

.tm-section {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 0 10px;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #41594b;
}
.tm-section::after {
  content: '';
  flex: 1;
  border-top: 1px dashed #23332b;
}

.tm-table { display: grid; gap: 0; }
.tm-tr {
  display: grid;
  grid-template-columns: 30px 76px minmax(0, 1fr) minmax(0, 1fr) 156px 118px;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid #121a15;
  align-items: center;
}
.tm-tr--head {
  color: #43544a;
  border-bottom: 1px solid #22302a;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.tm-tr[data-missing='true'] { background: rgba(217, 164, 65, 0.04); }
.tm-tr:not(.tm-tr--head):hover { background: #0d1411; }
.tm-code { color: #eaf6ee; font-weight: 700; direction: ltr; text-align: right; }
.tm-type { color: #8fa195; font-size: 11px; letter-spacing: 0.01em; direction: ltr; text-align: right; }
.tm-period { color: #6f8175; font-size: 10.5px; }
.tm-supplier { color: #7f9187; font-size: 10.5px; }
.tm-end { text-align: end; }
.tm-money { justify-self: end; }
.tm-price {
  font: inherit;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12px;
  background: none;
  border: 1px dashed transparent;
  color: #eaf6ee;
  padding: 1px 5px;
  cursor: pointer;
  border-radius: 2px;
}
.tm-price:hover:not(:disabled) { border-color: #2c3d33; color: var(--tm-green); }
.tm-price:disabled { cursor: default; color: #8fa195; }
.tm-input { display: inline-flex; align-items: center; gap: 4px; }
.tm-input b { color: var(--tm-green); font-weight: 400; }
.tm-input input {
  width: 92px;
  font: inherit;
  font-family: 'PoTestMono', ui-monospace, monospace;
  background: #040705;
  border: 0;
  border-bottom: 1px solid var(--tm-green);
  color: var(--tm-green);
  padding: 1px 3px;
  direction: ltr;
  text-align: right;
}
.tm-input input:focus { outline: none; }

.tm-sums { margin: 12px 0 4px; }
.tm-sums p {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding: 2px 0;
}
.tm-dots { flex: 1; border-bottom: 1px dotted #1d2820; transform: translateY(-3px); }
.tm-sums b { color: #eaf6ee; font-weight: 600; }
.tm-sums__total { margin-top: 6px !important; border-top: 1px solid #22302a; padding-top: 8px !important; }
.tm-sums__total span { color: var(--tm-green); }
.tm-sums__total b { color: var(--tm-green); font-size: 14px; }

.tm-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.tm-log li {
  display: grid;
  grid-template-columns: 132px 84px minmax(0, 1fr) 104px;
  gap: 10px;
  align-items: baseline;
  font-size: 11px;
  color: #93a598;
}
.tm-log__detail { color: #b8c9bc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-log__actor { text-align: end; }

.tm-prompt { margin-top: 22px; border-top: 1px solid #22302a; padding-top: 14px; }
.tm-close {
  gap: 6px;
  font: inherit;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12px;
  background: none;
  border: 0;
  color: #d6e3d8;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.tm-close:hover { color: var(--tm-red); }
.tm-close:hover .tm-flag { color: var(--tm-red); }
.tm-caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--tm-green);
  margin-inline-start: 6px;
  animation: tm-blink 1.1s steps(1) infinite;
}
@keyframes tm-blink { 50% { opacity: 0; } }

@media (max-width: 820px) {
  .tm-root { font-size: 11.5px; }
  .tm-tr { grid-template-columns: 26px minmax(0, 1fr) 104px; }
  .tm-tr .tm-type, .tm-tr .tm-supplier, .tm-tr .tm-period { display: none; }
  .tm-log li {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 2px 10px;
  }
  .tm-log__when { grid-column: 1; grid-row: 1; }
  .tm-log__actor { grid-column: 2; grid-row: 1; text-align: end; }
  .tm-log__kind { grid-column: 1; grid-row: 2; }
  .tm-log__detail { grid-column: 2; grid-row: 2; }
  .tm-meta div { grid-template-columns: 74px minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .tm-caret { animation: none; }
}
`

/* ══════════════════════════════════════════════════════════════════
   07–11 · light-mode directions built on the product's own UI
   (tokens, .card, .badge, .table-header, Thmanyah) for a real office.
   ══════════════════════════════════════════════════════════════════ */

/** Shared inline price editor for the light variants. */
function usePriceEditor(po: PoState) {
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const begin = (unit: Unit) => {
    if (po.locked) return
    setEditId(unit.id)
    setDraft(unit.price === null ? '' : String(unit.price))
  }
  const commit = () => {
    if (editId) po.savePrice(editId, Number(draft.replace(/[^\d.]/g, '')))
    setEditId(null)
  }
  const cancel = () => setEditId(null)
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') cancel()
  }
  return { editId, draft, setDraft, begin, commit, cancel, onKeyDown }
}

function StatusPill({ locked }: { locked: boolean }) {
  return (
    <span
      className={`badge ${
        locked ? 'bg-surface text-muted' : 'bg-success-soft text-success'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${locked ? 'bg-muted' : 'bg-success'}`}
        aria-hidden="true"
      />
      {locked ? 'مغلق' : 'مفتوح'}
    </span>
  )
}

/* ── 28 · «هوية+»: the identity blended with the first five ──────── */

function ComboVariant({ po }: VariantProps) {
  const { units, total, vat, grand, unpriced, locked } = po
  const edit = usePriceEditor(po)

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-[#f6f4ef] text-[#15140f]">
      <style>{identityCss}</style>
      <style>{comboCss}</style>
      <div className="cb-band" aria-hidden="true" />

      <div className="mx-auto w-full max-w-[1100px] px-5 pb-8 pt-5 sm:px-8">
        <header className="cb-head">
          <div className="flex items-center gap-3">
            <img src="/azzanco-logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <p className="text-[13px] font-semibold leading-tight">
                شركة عبدالله العزاني للمقاولات
              </p>
              <p className="text-[10.5px] text-[#6f6a60]">ادارة المعدات والاليات · الرياض</p>
            </div>
          </div>

          <div className="flex items-start gap-5">
            <div className="text-end">
              <p className="id-micro">Purchase order</p>
              <p className="id-display mt-0.5 text-[15px] leading-none text-[#15140f]">امر شراء</p>
              <p className="cb-number mt-1">
                <bdi dir="ltr">{PO.number}</bdi>
              </p>
            </div>
            <span className="cb-stamp" data-off={locked}>
              {locked ? 'مغلق' : 'مفتوح'}
            </span>
          </div>
        </header>

        <section className="cb-figs" aria-label="ارقام السند">
          {[
            ['الوحدات', String(units.length), `${unpriced} بلا سعر`],
            ['قبل الضريبة', money(total), 'ريال'],
            ['الضريبة 15%', money(vat), 'قيمة مضافة'],
            ['الاجمالي المستحق', money(grand), 'مع الضريبة'],
          ].map(([label, value, hint], index) => (
            <div key={label} className={index === 3 ? 'cb-fig cb-fig--total' : 'cb-fig'}>
              <p className="cb-fig__label">{label}</p>
              <p className="cb-fig__value">
                <bdi dir="ltr">{value}</bdi>
              </p>
              <p className="cb-fig__hint">{hint}</p>
            </div>
          ))}
        </section>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="id-display text-[21px] leading-tight">وحدات السند</h1>
            <p className="mt-0.5 text-[11px] text-[#6f6a60]">
              {PO.party} · {PO.project}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="id-btn">
              طباعة
            </button>
            <button type="button" disabled={locked} className="id-btn">
              اضافة وحدة
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={po.closePo}
              className="id-btn id-btn--solid"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              اغلاق السند
            </button>
          </div>
        </div>

        <table className="id-table cb-table mt-3">
          <thead>
            <tr>
              <th className="w-[30px] text-center">م</th>
              <th>الوحدة</th>
              <th className="hidden sm:table-cell">البيان</th>
              <th className="hidden md:table-cell">المورد</th>
              <th>الفترة</th>
              <th className="text-end">السعر الشهري</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit, index) => (
              <tr key={unit.id}>
                <td className="text-center text-[10.5px] tabular-nums text-[#a29b8e]">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td>
                  <span className="id-code text-[13px]">{unit.code}</span>
                  <span className="mt-0.5 block text-[10px] text-[#8b857a]">
                    {unit.plate ?? unit.chassis ?? '—'}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#6f6a60] sm:hidden">
                    {unit.type}
                  </span>
                </td>
                <td className="hidden text-[12px] sm:table-cell">{unit.type}</td>
                <td className="hidden text-[11px] text-[#6f6a60] md:table-cell">{unit.supplier}</td>
                <td className="whitespace-nowrap text-[10.5px] tabular-nums text-[#4b4740]" dir="ltr">
                  {shortDate(unit.periodFrom)} —{' '}
                  {unit.periodTo ? shortDate(unit.periodTo) : 'مفتوح'}
                </td>
                <td className="text-end">
                  {edit.editId === unit.id ? (
                    <input
                      autoFocus
                      inputMode="decimal"
                      dir="ltr"
                      value={edit.draft}
                      onChange={(event) => edit.setDraft(event.target.value)}
                      onBlur={edit.commit}
                      onKeyDown={edit.onKeyDown}
                      className="id-input"
                      aria-label={`سعر ${unit.code}`}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => edit.begin(unit)}
                      className={`id-price text-[13.5px] ${unit.price === null ? 'id-price--none' : ''}`}
                    >
                      {unit.price === null ? 'حدد السعر' : money(unit.price)}
                      {unit.price !== null && <span className="id-cur">ر.س</span>}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col justify-between gap-6">
            <p className="max-w-[430px] text-[10.5px] leading-relaxed text-[#6f6a60]">{PO.notes}</p>
            <div className="grid max-w-[380px] grid-cols-2 gap-6">
              {[
                ['اعداد', PO.createdBy],
                ['اعتماد', 'ادارة المشتريات'],
              ].map(([role, name]) => (
                <div key={role}>
                  <p className="text-[9px] tracking-[0.06em] text-[#8b857a]">{role}</p>
                  <div className="mt-7 border-b border-[#c9c2b4]" />
                  <p className="mt-1 text-[10px] text-[#4b4740]">{name}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="cb-receipt">
            <p className="cb-receipt__cap">خلاصة السند</p>
            <div className="cb-lead">
              <span>{units.length} وحدة</span>
              <span className="cb-lead__dots" aria-hidden="true" />
              <bdi dir="ltr">{money(total)}</bdi>
            </div>
            <div className="cb-lead">
              <span>ضريبة القيمة المضافة 15%</span>
              <span className="cb-lead__dots" aria-hidden="true" />
              <bdi dir="ltr">{money(vat)}</bdi>
            </div>
            <div className="cb-lead cb-lead--total">
              <span>الاجمالي المستحق</span>
              <span className="cb-lead__dots" aria-hidden="true" />
              <span className="cb-sum">
                <bdi dir="ltr">{money(grand)}</bdi>
                <span className="id-cur">ر.س</span>
              </span>
            </div>
          </div>
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#ddd8cf] pt-2.5 text-[9.5px] tracking-[0.05em] text-[#8b857a]">
          <span>
            اصدره {PO.createdBy} · {shortDate(PO.startDate)}
            {unpriced > 0 ? ` · ${unpriced} وحدة تحتاج سعرًا` : ''}
          </span>
          <span dir="ltr">{PO.number} · page 1/1</span>
        </footer>
      </div>
    </main>
  )
}

const comboCss = `
.cb-band { height: 3px; background: var(--accent); }
.cb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid #15140f;
}
.cb-number {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1;
}
.cb-stamp {
  margin-top: 2px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
  border: 1.5px solid var(--accent);
  padding: 5px 9px;
  transform: rotate(-5deg);
  white-space: nowrap;
}
.cb-stamp[data-off='true'] { color: #a2402c; border-color: #a2402c; }

.cb-figs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid #ddd8cf;
}
@media (max-width: 719px) {
  .cb-fig:nth-child(odd) { border-inline-start: 0; }
  .cb-fig:nth-child(n + 3) { border-top: 1px solid #e8e3d9; }
}
@media (min-width: 720px) {
  .cb-figs { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.cb-fig { padding: 12px 14px 11px; border-inline-start: 1px solid #e8e3d9; }
.cb-fig:first-child { border-inline-start: 0; padding-inline-start: 0; }
.cb-fig__label { margin: 0; font-size: 9px; letter-spacing: 0.08em; color: #8b857a; }
.cb-fig__value {
  margin: 2px 0 0;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.cb-fig__hint { margin: 1px 0 0; font-size: 9.5px; color: #a29b8e; }
.cb-fig--total .cb-fig__value { color: var(--accent); }

.cb-table td { padding-block: 9px; }

.cb-receipt {
  border: 1px solid #d8d2c6;
  background: #fbf9f4;
  padding: 12px 14px 13px;
  position: relative;
}
.cb-receipt::before {
  content: '';
  position: absolute;
  inset-inline: 12px;
  top: 5px;
  border-top: 1px dashed #dfd9cd;
}
.cb-receipt__cap {
  margin: 4px 0 8px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 8.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #8b857a;
}
.cb-lead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-block: 3px;
  font-size: 11.5px;
  color: #4b4740;
}
.cb-lead bdi {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #15140f;
}
.cb-lead__dots { flex: 1; border-bottom: 1px dotted #c9c2b4; transform: translateY(-2px); }
.cb-lead--total {
  margin-top: 5px;
  padding-top: 7px;
  border-top: 2px solid #15140f;
  font-weight: 600;
  color: #15140f;
}
.cb-sum {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--accent);
}
@media print {
  .vt-bar { display: none !important; }
  .cb-band { display: none; }
}
`

/* ── 27 · «هوية»: letterhead + document typography ───────────────── */

function IdentityVariant({ po }: VariantProps) {
  const { units, total, vat, grand, unpriced, locked } = po
  const edit = usePriceEditor(po)

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-[#f7f6f3] text-[#15140f]">
      <style>{identityCss}</style>
      <div className="mx-auto w-full max-w-[1120px] px-5 py-7 sm:px-8">
        {/* letterhead */}
        <header className="id-head">
          <div className="flex items-center gap-3">
            <img src="/azzanco-logo.png" alt="" className="h-11 w-11 object-contain" />
            <div>
              <p className="text-[13.5px] font-semibold leading-tight">
                شركة عبدالله العزاني للمقاولات
              </p>
              <p className="text-[11px] text-[#6f6a60]">ادارة المعدات والاليات · الرياض</p>
            </div>
          </div>
          <div className="text-end">
            <p className="id-micro">Purchase order</p>
            <p className="id-display mt-0.5 text-[26px] leading-none text-[#15140f]">امر شراء</p>
            <p className="mt-1 text-[12px] tabular-nums tracking-[0.06em] text-[#4b4740]" dir="ltr">
              {PO.number}
            </p>
          </div>
        </header>

        {/* meta strip */}
        <dl className="id-meta">
          {[
            ['المورد', PO.party, ''],
            ['المشروع', PO.project, ''],
            ['تاريخ البدء', shortDate(PO.startDate), 'id-num'],
            ['الحالة', locked ? 'مغلق' : 'مفتوح للاضافة', ''],
          ].map(([label, value, extra]) => (
            <div key={label} className={extra}>
              <dt>{label}</dt>
              <dd className={extra === 'id-num' ? 'tabular-nums' : ''}>{value}</dd>
            </div>
          ))}
        </dl>

        {/* section head + actions */}
        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="id-display text-[22px] leading-tight">وحدات السند</h1>
            <p className="mt-1 text-[11.5px] text-[#6f6a60]">
              {units.length} وحدة
              {unpriced > 0 ? ` · ${unpriced} تحتاج سعرًا` : ' · كل الوحدات مسعّرة'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={locked} className="id-btn">
              اضافة وحدة
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={po.closePo}
              className="id-btn id-btn--solid"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              اغلاق السند
            </button>
          </div>
        </div>

        {/* the ledger */}
        <table className="id-table mt-3">
          <thead>
            <tr>
              <th className="w-[34px] text-center">م</th>
              <th>الوحدة</th>
              <th className="hidden sm:table-cell">البيان</th>
              <th className="hidden md:table-cell">المورد</th>
              <th>الفترة</th>
              <th className="text-end">السعر الشهري</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit, index) => (
              <tr key={unit.id}>
                <td className="text-center text-[11px] text-[#8b857a] tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td>
                  <span className="id-code">{unit.code}</span>
                  <span className="mt-0.5 block text-[10.5px] text-[#8b857a]">
                    {unit.plate ?? unit.chassis ?? '—'}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-[#6f6a60] sm:hidden">
                    {unit.type}
                  </span>
                </td>
                <td className="hidden text-[12.5px] sm:table-cell">{unit.type}</td>
                <td className="hidden text-[11.5px] text-[#6f6a60] md:table-cell">{unit.supplier}</td>
                <td className="whitespace-nowrap text-[11px] text-[#4b4740] tabular-nums" dir="ltr">
                  {shortDate(unit.periodFrom)} —{' '}
                  {unit.periodTo ? shortDate(unit.periodTo) : 'مفتوح'}
                </td>
                <td className="text-end">
                  {edit.editId === unit.id ? (
                    <input
                      autoFocus
                      inputMode="decimal"
                      dir="ltr"
                      value={edit.draft}
                      onChange={(event) => edit.setDraft(event.target.value)}
                      onBlur={edit.commit}
                      onKeyDown={edit.onKeyDown}
                      className="id-input"
                      aria-label={`سعر ${unit.code}`}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => edit.begin(unit)}
                      className={`id-price ${unit.price === null ? 'id-price--none' : ''}`}
                    >
                      {unit.price === null ? 'حدد السعر' : money(unit.price)}
                      {unit.price !== null && <span className="id-cur">ر.س</span>}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* summary */}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-8">
          <p className="max-w-[380px] text-[11px] leading-relaxed text-[#6f6a60]">{PO.notes}</p>
          <dl className="id-totals">
            <div>
              <dt>المجموع قبل الضريبة</dt>
              <dd>{money(total)}</dd>
            </div>
            <div>
              <dt>ضريبة القيمة المضافة 15%</dt>
              <dd>{money(vat)}</dd>
            </div>
            <div className="id-total">
              <dt>الاجمالي المستحق</dt>
              <dd>
                {money(grand)}
                <span className="id-cur">ر.س</span>
              </dd>
            </div>
          </dl>
        </div>

        <footer className="mt-7 flex flex-wrap items-center justify-between gap-2 border-t border-[#ddd8cf] pt-3 text-[10px] tracking-[0.04em] text-[#8b857a]">
          <span>
            اصدره {PO.createdBy} · {shortDate(PO.startDate)}
          </span>
          <span dir="ltr">
            {PO.number} · {units.length} items · page 1/1
          </span>
        </footer>
      </div>
    </main>
  )
}

const identityCss = `
.id-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 14px;
  border-bottom: 2px solid #15140f;
}
.id-micro {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: #8b857a;
}
.id-display {
  font-family: 'Thmanyah Serif Display', 'Thmanyah', serif;
  font-weight: 500;
  letter-spacing: -0.01em;
}
.id-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid #ddd8cf;
}
@media (min-width: 640px) {
  .id-meta { grid-template-columns: 1.5fr 1.15fr 0.95fr 0.85fr; }
}
.id-meta > div {
  padding: 10px 14px 9px;
  border-inline-start: 1px solid #e8e3d9;
}
.id-meta > div:first-child { border-inline-start: 0; padding-inline-start: 0; }
.id-meta dt {
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: #8b857a;
  margin-bottom: 2px;
}
.id-meta dd {
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: #15140f;
}
.id-btn {
  height: 34px;
  padding: 0 14px;
  border: 1px solid #cfc9bd;
  border-radius: 5px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: #15140f;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.id-btn:hover:not(:disabled) { background: #ffffff; border-color: #9d968a; }
.id-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.id-btn--solid {
  border-color: transparent;
  color: #fff;
  font-weight: 500;
}
.id-btn--solid:hover:not(:disabled) { filter: brightness(1.08); background-color: var(--accent); }

.id-table { width: 100%; border-collapse: collapse; }
.id-table th {
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: #8b857a;
  text-align: start;
  padding: 8px 10px;
  border-top: 1px solid #15140f;
  border-bottom: 1px solid #ddd8cf;
  white-space: nowrap;
}
.id-table th:first-child { padding-inline-start: 0; }
.id-table th.text-end { text-align: end; }
.id-table td {
  padding: 10px;
  border-bottom: 1px solid #e8e3d9;
  vertical-align: middle;
}
.id-table td:first-child { padding-inline-start: 0; }
.id-table td:last-child { padding-inline-end: 14px; }
.id-table tbody tr { transition: background 0.12s; }
.id-table tbody tr:hover { background: #fffefb; }
.id-code {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  direction: ltr;
  unicode-bidi: isolate;
}
.id-price {
  font: inherit;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  direction: ltr;
  background: none;
  border: 0;
  padding: 3px 6px;
  border-radius: 4px;
  color: #15140f;
  cursor: pointer;
  transition: background 0.13s;
}
.id-price:hover:not(:disabled) { background: #f0ece3; }
.id-price:disabled { cursor: default; }
.id-price--none {
  font-family: 'Thmanyah', sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: #a35a12;
  border: 1px dashed #d9b384;
  padding: 2px 8px;
}
.id-cur {
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: #8b857a;
  margin-inline-start: 4px;
}
.id-input {
  width: 104px;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  text-align: end;
  direction: ltr;
  padding: 4px 6px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: #fff;
  color: #15140f;
}
.id-input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent); }

.id-totals { width: 300px; margin: 0; }
.id-totals > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dotted #cfc9bd;
}
.id-totals dt { font-size: 11.5px; color: #6f6a60; }
.id-totals dd {
  margin: 0;
  font-family: 'PoTestMono', ui-monospace, monospace;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  direction: ltr;
}
.id-total {
  margin-top: 4px;
  padding-top: 10px !important;
  border-bottom: 0 !important;
  border-top: 2px solid #15140f;
}
.id-total dt { font-size: 12.5px; font-weight: 600; color: #15140f; }
.id-total dd {
  font-size: 19px !important;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #15140f;
}
`

/* ── 07 · «مكتبي»: the everyday screen on the product tokens ──────── */

function DeskVariant({ po }: VariantProps) {
  const { units, total, vat, grand, unpriced, locked } = po
  const edit = usePriceEditor(po)

  return (
    <main dir="rtl" className="light-sheet min-h-[calc(100dvh-42px)] bg-surface text-fg">
      <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-6">
        <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>المشتريات</span>
          <span aria-hidden="true">/</span>
          <span>اوامر الشراء</span>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-fg" dir="ltr">
            {PO.number}
          </span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold sm:text-2xl">
                امر الشراء <span dir="ltr">{PO.number}</span>
              </h1>
              <StatusPill locked={locked} />
              {unpriced > 0 && (
                <span className="badge bg-warning-soft text-warning">
                  {unpriced} بلا سعر
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {PO.party} · {PO.company} · {PO.project}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={locked}
              className="h-9 rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-surface-hover disabled:opacity-40"
            >
              اضف وحدة
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={po.closePo}
              className="h-9 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-contrast hover:bg-primary-hover disabled:opacity-40"
            >
              اغلاق السند
            </button>
          </div>
        </div>

        <section className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4" aria-label="ارقام السند">
          {[
            { label: 'الوحدات', value: String(units.length), hint: `${unpriced} بلا سعر` },
            { label: 'قبل الضريبة', value: money(total), hint: 'ريال سعودي' },
            { label: 'ضريبة القيمة المضافة', value: money(vat), hint: '15%' },
            { label: 'الاجمالي المستحق', value: money(grand), hint: 'مع الضريبة', strong: true },
          ].map((kpi) => (
            <div key={kpi.label} className="card p-4">
              <p className="text-xs font-medium text-muted">{kpi.label}</p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums ${
                  kpi.strong ? 'text-success' : 'text-fg'
                }`}
                dir="ltr"
              >
                {kpi.value}
              </p>
              <p className="text-[11px] text-muted">{kpi.hint}</p>
            </div>
          ))}
        </section>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card overflow-hidden p-0">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">
                وحدات السند <span className="text-muted">({units.length})</span>
              </h2>
              <button
                type="button"
                disabled={locked}
                className="h-8 rounded-lg border border-border px-2.5 text-xs hover:bg-surface-hover disabled:opacity-40"
              >
                + اضافة
              </button>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-header bg-surface">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">الوحدة</th>
                    <th className="hidden px-3 py-2.5 text-start font-medium sm:table-cell">
                      النوع
                    </th>
                    <th className="hidden px-3 py-2.5 text-start font-medium md:table-cell">
                      المورد
                    </th>
                    <th className="hidden px-3 py-2.5 text-start font-medium sm:table-cell">
                      الفترة
                    </th>
                    <th className="px-4 py-2.5 text-end font-medium">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id} className="border-t border-border hover:bg-surface">
                      <td className="px-4 py-2.5">
                        <span className="block font-semibold" dir="ltr">
                          {unit.code}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {unit.plate ?? unit.chassis ?? '—'}
                        </span>
                        <span className="block text-[10px] text-muted sm:hidden" dir="ltr">
                          {shortDate(unit.periodFrom)} —{' '}
                          {unit.periodTo ? shortDate(unit.periodTo) : 'مفتوح'}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 text-muted sm:table-cell">
                        {unit.type}
                      </td>
                      <td className="hidden px-3 py-2.5 text-muted md:table-cell">
                        {unit.supplier}
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs text-muted sm:table-cell" dir="ltr">
                        {shortDate(unit.periodFrom)} —{' '}
                        {unit.periodTo ? shortDate(unit.periodTo) : 'مفتوح'}
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        {edit.editId === unit.id ? (
                          <input
                            autoFocus
                            inputMode="decimal"
                            dir="ltr"
                            value={edit.draft}
                            onChange={(event) => edit.setDraft(event.target.value)}
                            onBlur={edit.commit}
                            onKeyDown={edit.onKeyDown}
                            className="input h-8 w-28 text-end tabular-nums"
                            aria-label={`سعر ${unit.code}`}
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => edit.begin(unit)}
                            className="tabular-nums font-semibold underline-offset-4 hover:text-success hover:underline disabled:no-underline"
                          >
                            {unit.price === null ? (
                              <span className="whitespace-nowrap rounded-md border border-warning bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                                حدد السعر
                              </span>
                            ) : (
                              money(unit.price)
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface text-sm">
                  <tr className="border-t border-border">
                    <td colSpan={4} className="px-4 py-2 text-muted">
                      الاجمالي قبل الضريبة
                    </td>
                    <td className="px-4 py-2 text-end font-semibold tabular-nums" dir="ltr">
                      {money(total)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-muted">
                      ضريبة القيمة المضافة 15%
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums" dir="ltr">
                      {money(vat)}
                    </td>
                  </tr>
                  <tr className="border-t border-border">
                    <td colSpan={4} className="px-4 py-2.5 font-semibold">
                      الاجمالي المستحق
                    </td>
                    <td
                      className="px-4 py-2.5 text-end text-base font-bold tabular-nums text-success"
                      dir="ltr"
                    >
                      {money(grand)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <aside className="grid gap-4">
            <section className="card">
              <h2 className="mb-3 text-sm font-semibold">بيانات السند</h2>
              <dl className="grid gap-2.5 text-sm">
                {[
                  ['المورد', PO.party],
                  ['الشركة', PO.company],
                  ['المشروع', PO.project],
                  ['تاريخ البدء', shortDate(PO.startDate)],
                  ['انشاه', PO.createdBy],
                  ['الحالة', locked ? 'مغلق' : 'مفتوح للاضافة'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="text-end text-[13px] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted">
                {PO.notes}
              </p>
            </section>

            <section className="card">
              <h2 className="mb-3 text-sm font-semibold">اخر التحديثات</h2>
              <ol className="grid gap-3">
                {po.events.slice(0, 4).map((event) => (
                  <li key={event.id} className="flex gap-2.5">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{event.kind}</p>
                      <p className="truncate text-xs text-muted" dir="ltr">
                        {event.detail}
                      </p>
                      <p className="text-[11px] text-muted">
                        {event.when} · {event.actor}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}