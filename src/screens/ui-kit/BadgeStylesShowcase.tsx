import type { CSSProperties, ReactNode } from 'react'
import { Ban, LogIn, LogOut, ParkingCircle, Wrench } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui'

// Five candidate looks for the shared Badge (owner request 2026-10-24),
// beside the current one. Sample data only, project tokens only; nothing
// here changes the real Badge until the owner picks a look.

type StyleId = 'current' | 'dot' | 'soft' | 'outline' | 'pill-dot' | 'text'

type Sample = { tone: BadgeTone; label: string; icon?: ReactNode }

const SAMPLES: Sample[] = [
  {
    tone: 'entry',
    label: 'دخول',
    icon: <LogIn size={12} aria-hidden="true" />,
  },
  {
    tone: 'exit',
    label: 'خروج',
    icon: <LogOut size={12} aria-hidden="true" />,
  },
  { tone: 'success', label: 'مفتوح' },
  { tone: 'neutral', label: 'مغلق' },
  { tone: 'warning', label: 'تحتاج تسعير' },
  {
    tone: 'warning',
    label: 'صيانة',
    icon: <Wrench size={12} aria-hidden="true" />,
  },
  {
    tone: 'info',
    label: 'وقوف',
    icon: <ParkingCircle size={12} aria-hidden="true" />,
  },
  {
    tone: 'danger',
    label: 'خارج الخدمة',
    icon: <Ban size={12} aria-hidden="true" />,
  },
]

const STYLES: { id: StyleId; title: string; note: string }[] = [
  {
    id: 'current',
    title: 'المعتمد',
    note: 'ناعم مربع (اختيار 2026-10-24) بحجم وسط بين الكبير والصغير السابقين. هذا هو مكون Badge الحقيقي.',
  },
  {
    id: 'dot',
    title: '1 · نقطة ونص',
    note: 'بلا خلفية ولا حد: نقطة ملونة ثم النص بلون الكلام العادي. اهدا شكل، ويخلي الجدول نظيف.',
  },
  {
    id: 'soft',
    title: '2 · ناعم مربع',
    note: 'خلفية فاتحة بلا حد، زوايا مدورة قليلا بدل الحبة. ثابت وواضح.',
  },
  {
    id: 'outline',
    title: '3 · حد فقط',
    note: 'بلا خلفية، حد ملون رفيع والنص بنفس اللون. خفيف ويبان على اي خلفية.',
  },
  {
    id: 'pill-dot',
    title: '4 · حبة بنقطة',
    note: 'نفس الحبة الحالية بلا حد، مع نقطة ملونة قبل النص. الحالة تبان من النقطة حتى لو اللون فاتح.',
  },
  {
    id: 'text',
    title: '5 · نص ملون',
    note: 'النص فقط بلون الحالة ووزن متوسط، بلا اي صندوق. اقل شي ممكن.',
  },
]

function toneVar(tone: BadgeTone) {
  return tone === 'neutral' ? 'var(--muted)' : `var(--${tone})`
}

function softVar(tone: BadgeTone) {
  return tone === 'neutral' ? 'var(--surface)' : `var(--${tone}-soft)`
}

function Dot({ tone }: { tone: BadgeTone }) {
  return (
    <span
      aria-hidden="true"
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: toneVar(tone) }}
    />
  )
}

/** One sample in one candidate look. */
function ProposalBadge({
  look,
  sample,
  small = false,
}: {
  look: StyleId
  sample: Sample
  small?: boolean
}) {
  const { tone, label, icon } = sample
  if (look === 'current')
    return (
      <Badge tone={tone} size={small ? 'sm' : 'md'} icon={icon}>
        {label}
      </Badge>
    )
  const size = small ? 'text-xs leading-4' : 'text-xs leading-5'
  const base = `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium ${size}`
  let style: CSSProperties = {}
  let extra = ''
  let lead: ReactNode = icon
  switch (look) {
    case 'dot':
      extra = 'text-fg'
      lead = <Dot tone={tone} />
      break
    case 'soft':
      extra = small ? 'rounded px-1.5' : 'rounded-md px-2 py-0.5'
      style =
        tone === 'neutral'
          ? { backgroundColor: softVar(tone) }
          : { color: toneVar(tone), backgroundColor: softVar(tone) }
      break
    case 'outline':
      extra = `border ${small ? 'rounded px-1.5' : 'rounded-md px-2 py-0.5'}`
      style = {
        color: tone === 'neutral' ? 'var(--muted)' : toneVar(tone),
        borderColor:
          tone === 'neutral'
            ? 'var(--border)'
            : `color-mix(in srgb, ${toneVar(tone)} 55%, transparent)`,
      }
      break
    case 'pill-dot':
      extra = `rounded-full ${small ? 'px-1.5' : 'px-2.5 py-0.5'} text-fg`
      style = { backgroundColor: softVar(tone) }
      lead = <Dot tone={tone} />
      break
    case 'text':
      style = { color: toneVar(tone) }
      break
  }
  return (
    <span className={`${base} ${extra}`} style={style}>
      {lead}
      {label}
    </span>
  )
}

/** A row of the PO list as it would look with the candidate. */
function SampleRow({ look }: { look: StyleId }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-bg px-3 py-2.5 text-[13px]">
      <bdi dir="ltr" className="font-semibold">
        SPO260044
      </bdi>
      <span className="min-w-0 flex-1 truncate">
        شركة الابراج المتحدة العربية المحدودة
      </span>
      <span className="flex items-center gap-1.5">
        <ProposalBadge look={look} sample={SAMPLES[2]} />
        <ProposalBadge look={look} sample={SAMPLES[4]} />
      </span>
    </div>
  )
}

export function BadgeStylesShowcase() {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">خمسة نماذج لشكل الشارة</h3>
        <p className="text-xs text-muted">
          كل نموذج بنفس الحالات: الدخول والخروج، مفتوح ومغلق، تحتاج تسعير،
          واغراض الورشة. تحتها الحجم الصغير، ثم صف من قائمة اوامر الشراء. الشارة
          الحقيقية ما تتغير الا بعد ما تختار.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {STYLES.map((look) => (
          <article
            key={look.id}
            className={`space-y-3 rounded-xl border p-4 ${look.id === 'current' ? 'bg-surface' : 'bg-bg'}`}
          >
            <div>
              <p className="text-sm font-semibold">{look.title}</p>
              <p className="text-xs text-muted">{look.note}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {SAMPLES.map((sample) => (
                <ProposalBadge
                  key={sample.label}
                  look={look.id}
                  sample={sample}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {SAMPLES.map((sample) => (
                <ProposalBadge
                  key={sample.label}
                  look={look.id}
                  sample={sample}
                  small
                />
              ))}
            </div>
            <SampleRow look={look.id} />
          </article>
        ))}
      </div>
    </section>
  )
}
