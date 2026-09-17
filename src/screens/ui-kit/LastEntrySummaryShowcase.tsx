import type { ReactNode } from 'react'
import { LastEntrySummary } from '@/components/movement/LastEntrySummary'

// Compact "last entry data" summary for the site EXIT form, pending owner
// approval before it replaces the explanatory sentence + driver field in
// EntryExitForm.tsx. Sample copy only.

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function LastEntrySummaryShowcase() {
  return (
    <>
      <Section
        title="بيانات اخر دخول (بيانات كاملة)"
        description="الحالة المعتادة عند تسجيل خروج من الموقع: كل الحقول متوفرة."
      >
        <LastEntrySummary
          recordedAt="2026-09-10T07:15:00Z"
          driverName="سالم عبدالله بن سعيد القحطاني الحربي"
          driverMobile="0555123456"
          contractorCode="C-102934"
          companyName="شركة البناء والتعمير المتحدة للمقاولات العامة والمتخصصة"
          projectName="مشروع توسعة الطريق الدائري الشمالي - المرحلة الثانية"
        />
      </Section>

      <Section
        title="Last entry data (full data, English)"
        description="Long English company and project names to prove wrapping behavior."
      >
        <LastEntrySummary
          recordedAt="2026-09-10T07:15:00Z"
          driverName="Abdullah Mohammed Saeed Al-Qahtani Al-Harbi"
          driverMobile="0555123456"
          contractorCode="C-102934"
          companyName="United Construction and Development Company for General and Specialized Contracting"
          projectName="Northern Ring Road Expansion Project - Phase Two"
        />
      </Section>

      <Section
        title="بدون رقم جوال للسائق"
        description="سائق قديم بدون رقم جوال مسجل — يظهر اسم السائق فقط بدون رابط الاتصال."
      >
        <LastEntrySummary
          recordedAt="2026-08-02T05:40:00Z"
          driverName="خالد العتيبي"
          driverMobile={null}
          contractorCode="A-2210"
          companyName="تكوين"
          projectName="مشروع صيانة الطرق الفرعية"
        />
      </Section>

      <Section
        title="بدون مشروع"
        description="دخول مرتبط بشركة فقط بدون مشروع محدد — يظهر اسم الشركة وحدها."
      >
        <LastEntrySummary
          recordedAt="2026-07-18T09:05:00Z"
          driverName="راشد علي"
          driverMobile="0512345678"
          contractorCode={null}
          companyName="العزاني"
          projectName={null}
        />
      </Section>

      <Section
        title="حالة التحميل"
        description="هيكل عظمي (skeleton) بينما يتم جلب بيانات اخر دخول من قاعدة البيانات."
      >
        <LastEntrySummary loading />
      </Section>
    </>
  )
}
