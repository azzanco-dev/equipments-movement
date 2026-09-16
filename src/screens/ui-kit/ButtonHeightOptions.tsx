import { LogIn, Pencil, Search } from 'lucide-react'
import { Badge, Button, IconButton, Input, cn } from '@/components/ui'

// Size options for the owner to compare before changing the Button and Input
// defaults. The `!` utilities override the current 32 px sizes for preview only.
const OPTIONS = [
  {
    id: 'current',
    title: 'الحالي — 32 بكسل',
    control: '',
    icon: '',
    note: 'مضغوط ومناسب للجداول والشاشات الكثيفة، لكنه صغير على اصبع المستخدم في الجوال.',
  },
  {
    id: '36',
    title: 'خيار 1 — 36 بكسل',
    control: '!h-9 !px-3.5 !text-sm',
    icon: '!h-9 !w-9',
    note: 'زيادة خفيفة. يحافظ على كثافة الشاشات مع راحة اكثر.',
  },
  {
    id: '40',
    title: 'خيار 2 — 40 بكسل',
    control: '!h-10 !px-4 !text-sm',
    icon: '!h-10 !w-10',
    note: 'مريح على الكمبيوتر والجوال، ويحتاج مسافات اكبر قليلا في النماذج.',
  },
  {
    id: 'responsive',
    title: 'خيار 3 — متجاوب: 40 جوال / 36 كمبيوتر',
    control: '!h-10 !px-4 !text-sm md:!h-9 md:!px-3.5',
    icon: '!h-10 !w-10 md:!h-9 md:!w-9',
    note: 'اكبر للاصابع في الجوال واصغر للماوس في الكمبيوتر. غير عرض الشاشة لتشوف الفرق.',
    recommended: true,
  },
  {
    id: '44',
    title: 'خيار 4 — 44 بكسل',
    control: '!h-11 !px-4 !text-[15px]',
    icon: '!h-11 !w-11',
    note: 'حجم اللمس الموصى به للجوال، لكنه كبير نسبيا على الكمبيوتر.',
  },
]

export function ButtonHeightOptions() {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">خيارات ارتفاع الازرار والحقول</h3>
        <p className="text-xs text-muted">
          الحقول تاخذ نفس ارتفاع الازرار عشان تصطف في نفس الصف. الحجم الصغير (28
          بكسل) يبقى للجداول وشريط الادوات في كل الخيارات.
        </p>
      </div>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <div
            key={option.id}
            className={cn(
              'space-y-3 rounded-lg border p-3',
              option.recommended && 'border-fg',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{option.title}</span>
              {option.recommended && <Badge tone="info">اقتراحي</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                icon={<LogIn size={16} />}
                className={option.control}
              >
                تسجيل دخول
              </Button>
              <Button variant="outline" className={option.control}>
                الغاء
              </Button>
              <IconButton
                label="تعديل"
                variant="outline"
                icon={<Pencil size={16} />}
                className={option.icon}
              />
              <Input
                aria-label="بحث"
                placeholder="ابحث برقم المعدة"
                startIcon={<Search size={15} />}
                className={cn(
                  'w-56',
                  option.control &&
                    '[&_input]:h-[inherit] [&_input]:text-[inherit]',
                  option.control.replace(/(md:)?!px-\S+/g, ''),
                )}
              />
            </div>
            <p className="text-xs text-muted">{option.note}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
