import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
// Imported directly: Notice is not yet wired into the `ui` barrel
// (src/components/ui/index.ts), which is owned separately.
import { Notice, type NoticeTone } from '@/components/ui/Notice'

// Review of Notice on /ui-kit. All copy below is sample data. The demo
// language toggle only swaps the sample text below; shared chrome keeps
// following the app's real language.

type DemoLang = 'ar' | 'en'

const TONES: NoticeTone[] = ['neutral', 'info', 'success', 'warning', 'danger']

const LABELS: Record<
  DemoLang,
  {
    heading: string
    description: string
    compactTitle: string
    dismissibleNote: string
    dismissedNote: string
    retry: string
    tone: Record<NoticeTone, { title: string; body: string }>
  }
> = {
  ar: {
    heading: 'Notice',
    description:
      'شريط رسائل مضمن بخلفية ناعمة من الرموز اللونية المعتمدة، بديل عن Alert القديم.',
    compactTitle: 'النسخة المدمجة (compact)',
    dismissibleNote: 'يمكن اغلاقها',
    dismissedNote: 'تم اغلاق الرسالة اعلاه. اعد تحميل الصفحة لاظهارها مجددا.',
    retry: 'اعادة المحاولة',
    tone: {
      neutral: {
        title: 'تنبيه عام',
        body: 'رسالة معلوماتية عامة دون دلالة لونية خاصة.',
      },
      info: {
        title: 'معلومة',
        body: 'يتم تطبيق الاعدادات الجديدة عند الحفظ التالي.',
      },
      success: { title: 'تم الحفظ', body: 'تم حفظ التغييرات بنجاح.' },
      warning: {
        title: 'تنبيه',
        body: 'يرجى مراجعة البيانات قبل المتابعة.',
      },
      danger: {
        title: 'تعذر الحفظ',
        body: 'حدث خطا اثناء حفظ البيانات، حاول مرة اخرى.',
      },
    },
  },
  en: {
    heading: 'Notice',
    description:
      'An inline banner on the approved soft-tone backgrounds — replaces the legacy Alert.',
    compactTitle: 'Compact size',
    dismissibleNote: 'Dismissible',
    dismissedNote: 'Dismissed above. Reload the page to show it again.',
    retry: 'Retry',
    tone: {
      neutral: {
        title: 'General note',
        body: 'A general informational message with no specific tone.',
      },
      info: {
        title: 'Info',
        body: 'New settings apply on the next save.',
      },
      success: {
        title: 'Saved',
        body: 'Your changes were saved successfully.',
      },
      warning: {
        title: 'Warning',
        body: 'Please review the data before continuing.',
      },
      danger: {
        title: 'Save failed',
        body: 'Something went wrong while saving. Please try again.',
      },
    },
  },
}

export function NoticeShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const [dismissed, setDismissed] = useState(false)
  const label = LABELS[lang]
  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{label.heading}</h3>
          <p className="text-xs text-muted">{label.description}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={lang === 'ar' ? 'primary' : 'outline'}
            onClick={() => setLang('ar')}
          >
            عربي
          </Button>
          <Button
            size="sm"
            variant={lang === 'en' ? 'primary' : 'outline'}
            onClick={() => setLang('en')}
          >
            English
          </Button>
        </div>
      </div>

      <div dir={direction} lang={lang} className="space-y-3">
        {TONES.map((tone) => (
          <Notice key={tone} tone={tone} title={label.tone[tone].title}>
            {label.tone[tone].body}
          </Notice>
        ))}

        <Notice
          tone="danger"
          title={label.tone.danger.title}
          action={
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw size={14} aria-hidden="true" />}
            >
              {label.retry}
            </Button>
          }
        >
          {label.tone.danger.body}
        </Notice>

        {!dismissed ? (
          <Notice
            tone="info"
            title={`${label.tone.info.title} (${label.dismissibleNote})`}
            onDismiss={() => setDismissed(true)}
          >
            {label.tone.info.body}
          </Notice>
        ) : (
          <p className="text-xs text-muted">{label.dismissedNote}</p>
        )}

        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-fg">
            {label.compactTitle}
          </h4>
          <Notice tone="warning" size="compact">
            {label.tone.warning.body}
          </Notice>
        </div>
      </div>
    </section>
  )
}
