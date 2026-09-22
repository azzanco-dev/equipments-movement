import { useState, type ReactNode } from 'react'
import {
  Building2,
  Calendar,
  Camera,
  Clock,
  CreditCard,
  Edit2,
  Flag,
  Hash,
  MapPin,
  Phone,
  Power,
  Truck,
  User,
  Wrench,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  MovementBadge,
  Notice,
  PhotoGallery,
  SectionHeader,
  type DataTableColumn,
  type PhotoGalleryItem,
} from '@/components/ui'
// DetailHeader/InfoGrid are new (this change) and not yet wired into the
// `ui` barrel (src/components/ui/index.ts), which is owned separately.
import { DetailHeader } from '@/components/ui/DetailHeader'
import {
  InfoGrid,
  InfoGridSection,
  type InfoGridItem,
} from '@/components/ui/InfoGrid'
// MiniTable is not yet wired into the barrel either (see MiniTableShowcase).
import { MiniTable } from '@/components/ui/MiniTable'

// Approval material for the owner: three detail-page mockups built with
// `DetailHeader` + `InfoGrid` (new this change), alongside the already
// shared `MiniTable` and `PhotoGallery`. All data below is sample data.
// `MovementDetail` / `EquipmentDetail` are NOT migrated to these yet — this
// is a preview only, reviewed on /ui-kit first per the design-system rule.

type DemoLang = 'ar' | 'en'

function svgDataUri(width: number, height: number, label: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e4e4e7"/>` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="28" fill="#71717a">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const PHOTO_1 = svgDataUri(480, 360, '1')
const PHOTO_2 = svgDataUri(480, 360, '2')

const TEXT: Record<
  DemoLang,
  {
    title: string
    description: string
    mobileNote: string
    langToggleAr: string
    langToggleEn: string
    movementTitle: string
    movementSubtitle: string
    sectionMovement: string
    sectionEquipment: string
    sectionDriver: string
    sectionCompanyProject: string
    sectionPhotos: string
    date: string
    duration: string
    durationValue: string
    company: string
    project: string
    contractorCode: string
    supervisor: string
    code: string
    type: string
    plate: string
    driverName: string
    mobile: string
    auditLine: string
    equipmentTitle: string
    equipmentSubtitle: string
    sectionIdentity: string
    sectionOwnership: string
    sectionDates: string
    chassisNumber: string
    owner: string
    lessor: string
    manufactureYear: string
    createdAt: string
    recentMovements: string
    recentMovementsDesc: string
    driverDialogOpen: string
    driverDialogTitle: string
    driverDialogSubtitle: string
    idNumber: string
    nationality: string
    employmentType: string
    jobTitle: string
    relatedEquipment: string
    relatedEquipmentDesc: string
    timesDriven: string
    lastDriven: string
    drivingNow: string
    edit: string
    toggleActive: string
    viewAll: string
    saudiNational: string
    driverOne: string
    driverTwo: string
    ownerAlazani: string
    operationalStatus: string
    employmentTypeValue: string
  }
> = {
  ar: {
    title: 'صفحات التفاصيل (DetailHeader + InfoGrid)',
    description:
      'مكونان جديدان لاستبدال شكل InfoRow/DescriptionList القديم في صفحات تفاصيل الحركة والمعدة والسائق: DetailHeader (معرّف كبير + شارات + اجراءات) و InfoGrid (شبكة معلومات متجاوبة 2-3 اعمدة). المعاينات هنا بيانات تجريبية فقط، ولم تُطبَّق بعد على MovementDetail او EquipmentDetail.',
    mobileNote:
      'بالجوال: الاجراءات في DetailHeader تلتف اسفل المعرّف بعرض كامل بدل ان تبقى بجانبه، وشبكة InfoGrid تتحول لعمود واحد.',
    langToggleAr: 'عربي',
    langToggleEn: 'English',
    movementTitle: 'A-1024',
    movementSubtitle: 'حفار — Excavator',
    sectionMovement: 'بيانات الحركة',
    sectionEquipment: 'بيانات المعدة',
    sectionDriver: 'السائق',
    sectionCompanyProject: 'الشركة والمشروع',
    sectionPhotos: 'الصور',
    date: 'تاريخ الحركة',
    duration: 'المدة داخل الموقع',
    durationValue: '3 ايام 4 ساعات',
    company: 'الشركة',
    project: 'المشروع',
    contractorCode: 'كود المعدة لدى المقاول',
    supervisor: 'المشرف',
    code: 'رقم المعدة',
    type: 'النوع',
    plate: 'رقم اللوحة',
    driverName: 'اسم السائق',
    mobile: 'رقم الجوال',
    auditLine: 'سجّلها خالد العتيبي — منذ 3 ساعات',
    equipmentTitle: 'A-1024',
    equipmentSubtitle: 'حفار — Excavator',
    sectionIdentity: 'الهوية',
    sectionOwnership: 'الملكية',
    sectionDates: 'التواريخ',
    chassisNumber: 'رقم الشاصي',
    owner: 'المالك',
    lessor: 'المورّد',
    manufactureYear: 'سنة الصنع',
    createdAt: 'تاريخ الاضافة',
    recentMovements: 'اخر الحركات',
    recentMovementsDesc: 'اخر 5 حركات لهذه المعدة',
    driverDialogOpen: 'فتح تفاصيل السائق',
    driverDialogTitle: 'سعيد محمد العتيبي',
    driverDialogSubtitle: 'سائق معدات ثقيلة',
    idNumber: 'رقم الهوية',
    nationality: 'الجنسية',
    employmentType: 'نوع التوظيف',
    jobTitle: 'المسمى الوظيفي',
    relatedEquipment: 'المعدات المرتبطة',
    relatedEquipmentDesc: 'المعدات التي قادها هذا السائق',
    timesDriven: 'عدد المرات',
    lastDriven: 'اخر مرة',
    drivingNow: 'يقودها الان',
    edit: 'تعديل',
    toggleActive: 'تفعيل/ايقاف',
    viewAll: 'عرض الكل',
    saudiNational: 'سعودي',
    driverOne: 'سعيد محمد العتيبي',
    driverTwo: 'راشد علي القحطاني',
    ownerAlazani: 'العزاني',
    operationalStatus: 'تشغيلية',
    employmentTypeValue: 'موظف',
  },
  en: {
    title: 'Detail pages (DetailHeader + InfoGrid)',
    description:
      'Two new components to replace the old InfoRow/DescriptionList look on the movement, equipment, and driver detail pages: DetailHeader (a big identifier + status badges + actions) and InfoGrid (a responsive 2-3 column info grid). These are sample-data previews only — MovementDetail and EquipmentDetail are not migrated to them yet.',
    mobileNote:
      "On mobile: DetailHeader's actions wrap to a full-width row below the identifier instead of sitting beside it, and InfoGrid collapses to one column.",
    langToggleAr: 'عربي',
    langToggleEn: 'English',
    movementTitle: 'A-1024',
    movementSubtitle: 'Excavator',
    sectionMovement: 'Movement',
    sectionEquipment: 'Equipment details',
    sectionDriver: 'Driver',
    sectionCompanyProject: 'Company & project',
    sectionPhotos: 'Photos',
    date: 'Movement date',
    duration: 'Duration on site',
    durationValue: '3 days 4 hours',
    company: 'Company',
    project: 'Project',
    contractorCode: 'Contractor equipment code',
    supervisor: 'Supervisor',
    code: 'Equipment code',
    type: 'Type',
    plate: 'Plate number',
    driverName: 'Driver name',
    mobile: 'Mobile number',
    auditLine: 'Recorded by Khalid Al-Otaibi — 3 hours ago',
    equipmentTitle: 'A-1024',
    equipmentSubtitle: 'Excavator',
    sectionIdentity: 'Identity',
    sectionOwnership: 'Ownership',
    sectionDates: 'Dates',
    chassisNumber: 'Chassis number',
    owner: 'Owner',
    lessor: 'Supplier',
    manufactureYear: 'Manufacture year',
    createdAt: 'Added on',
    recentMovements: 'Recent movements',
    recentMovementsDesc: 'The last 5 movements for this equipment',
    driverDialogOpen: 'Open driver details',
    driverDialogTitle: 'Saeed Mohammed Al-Otaibi',
    driverDialogSubtitle: 'Heavy equipment driver',
    idNumber: 'ID number',
    nationality: 'Nationality',
    employmentType: 'Employment type',
    jobTitle: 'Job title',
    relatedEquipment: 'Related equipment',
    relatedEquipmentDesc: 'Equipment this driver has driven',
    timesDriven: 'Times',
    lastDriven: 'Last driven',
    drivingNow: 'Driving now',
    edit: 'Edit',
    toggleActive: 'Activate/deactivate',
    viewAll: 'View all',
    saudiNational: 'Saudi',
    driverOne: 'Saeed Mohammed Al-Otaibi',
    driverTwo: 'Rashed Ali Al-Qahtani',
    ownerAlazani: 'Al-Azani',
    operationalStatus: 'Operational',
    employmentTypeValue: 'Employee',
  },
}

interface RelatedEquipmentRow {
  id: string
  code: string
  plate: string
  times: number
  current: boolean
}

interface RecentMovementRow {
  id: string
  type: 'entry' | 'exit'
  supervisor: string
  driver: string
  date: string
}

export function DetailPagesShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const label = TEXT[lang]
  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{label.title}</h3>
          <p className="text-xs text-muted">{label.description}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={lang === 'ar' ? 'primary' : 'outline'}
            onClick={() => setLang('ar')}
          >
            {label.langToggleAr}
          </Button>
          <Button
            size="sm"
            variant={lang === 'en' ? 'primary' : 'outline'}
            onClick={() => setLang('en')}
          >
            {label.langToggleEn}
          </Button>
        </div>
      </div>

      <Notice tone="info" size="compact">
        {label.mobileNote}
      </Notice>

      <div dir={direction} lang={lang} className="space-y-6">
        <MovementMockup label={label} />
        <EquipmentMockup label={label} />
        <DriverDialogMockup label={label} />
      </div>
    </Card>
  )
}

function MockupFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <h4
        className="text-xs font-semibold uppercase tracking-wide text-muted"
        dir="ltr"
      >
        {title}
      </h4>
      <div className="rounded-xl border bg-bg p-4 sm:p-5">{children}</div>
    </div>
  )
}

function MovementMockup({ label }: { label: (typeof TEXT)['ar'] }) {
  const photos: PhotoGalleryItem[] = [
    { id: 'p1', src: PHOTO_1, status: 'ready' },
    { id: 'p2', src: PHOTO_2, status: 'ready' },
  ]
  const [selected, setSelected] = useState('p1')

  const movementItems: InfoGridItem[] = [
    {
      key: 'date',
      icon: <Clock size={16} />,
      label: label.date,
      value: '15/09/2026',
    },
    {
      key: 'duration',
      icon: <Clock size={16} />,
      label: label.duration,
      value: label.durationValue,
    },
    {
      key: 'supervisor',
      icon: <User size={16} />,
      label: label.supervisor,
      value: 'خالد العتيبي',
    },
  ]
  const equipmentItems: InfoGridItem[] = [
    {
      key: 'code',
      icon: <Hash size={16} />,
      label: label.code,
      value: 'A-1024',
    },
    {
      key: 'type',
      icon: <Wrench size={16} />,
      label: label.type,
      value: label.movementSubtitle,
    },
    {
      key: 'plate',
      icon: <Hash size={16} />,
      label: label.plate,
      value: '1234 ا ب ج',
      dir: 'ltr',
    },
  ]
  const driverItems: InfoGridItem[] = [
    {
      key: 'name',
      icon: <User size={16} />,
      label: label.driverName,
      value: label.driverOne,
    },
    {
      key: 'mobile',
      icon: <Phone size={16} />,
      label: label.mobile,
      value: '0501234567',
      dir: 'ltr',
    },
  ]
  const companyItems: InfoGridItem[] = [
    {
      key: 'company',
      icon: <Building2 size={16} />,
      label: label.company,
      value: 'شركة البناء المتحد',
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: label.project,
      value: 'مشروع طريق الملك فهد',
    },
    {
      key: 'contractorCode',
      icon: <Hash size={16} />,
      label: label.contractorCode,
      value: 'R16513',
      dir: 'ltr',
    },
  ]

  return (
    <MockupFrame title="MovementDetail">
      <div className="space-y-5">
        <DetailHeader
          identifier={label.movementTitle}
          subtitle={label.movementSubtitle}
          badges={<MovementBadge type="entry" withIcon />}
        />
        <InfoGridSection title={label.sectionMovement} items={movementItems} />
        <InfoGridSection
          title={label.sectionEquipment}
          items={equipmentItems}
        />
        <InfoGridSection
          title={label.sectionDriver}
          items={driverItems}
          columns={2}
        />
        <InfoGridSection
          title={label.sectionCompanyProject}
          items={companyItems}
        />
        <div className="space-y-3">
          <SectionHeader
            title={label.sectionPhotos}
            action={<Camera size={16} className="text-muted" />}
          />
          <PhotoGallery
            photos={photos}
            selectedId={selected}
            onSelect={setSelected}
            readOnly
          />
        </div>
        <p className="border-t pt-3 text-xs text-muted">{label.auditLine}</p>
      </div>
    </MockupFrame>
  )
}

function EquipmentMockup({ label }: { label: (typeof TEXT)['ar'] }) {
  const identityItems: InfoGridItem[] = [
    {
      key: 'code',
      icon: <Hash size={16} />,
      label: label.code,
      value: 'A-1024',
    },
    {
      key: 'type',
      icon: <Wrench size={16} />,
      label: label.type,
      value: label.equipmentSubtitle,
    },
    {
      key: 'plate',
      icon: <Hash size={16} />,
      label: label.plate,
      value: '1234 ا ب ج',
      dir: 'ltr',
    },
    {
      key: 'chassis',
      icon: <Hash size={16} />,
      label: label.chassisNumber,
      value: 'JH4KA8260MC012345',
      dir: 'ltr',
    },
  ]
  const ownershipItems: InfoGridItem[] = [
    {
      key: 'owner',
      icon: <Truck size={16} />,
      label: label.owner,
      value: <Badge tone="neutral">{label.ownerAlazani}</Badge>,
    },
    {
      key: 'lessor',
      icon: <Building2 size={16} />,
      label: label.lessor,
      value: null,
    },
  ]
  const dateItems: InfoGridItem[] = [
    {
      key: 'manufactureYear',
      icon: <Calendar size={16} />,
      label: label.manufactureYear,
      value: '2022',
      numeric: true,
    },
    {
      key: 'createdAt',
      icon: <Calendar size={16} />,
      label: label.createdAt,
      value: '01/03/2025',
    },
  ]

  const movementColumns: DataTableColumn<RecentMovementRow>[] = [
    {
      key: 'type',
      header: '',
      width: '5rem',
      cell: (row) => <MovementBadge type={row.type} />,
    },
    {
      key: 'supervisor',
      header: label.supervisor,
      cell: (row) => row.supervisor,
    },
    { key: 'driver', header: label.driverName, cell: (row) => row.driver },
    { key: 'date', header: label.date, cell: (row) => row.date },
  ]
  const movementRows: RecentMovementRow[] = [
    {
      id: '1',
      type: 'exit',
      supervisor: 'خالد العتيبي',
      driver: label.driverOne,
      date: '15/09/2026',
    },
    {
      id: '2',
      type: 'entry',
      supervisor: 'خالد العتيبي',
      driver: label.driverOne,
      date: '12/09/2026',
    },
    {
      id: '3',
      type: 'exit',
      supervisor: 'فهد القحطاني',
      driver: label.driverTwo,
      date: '02/09/2026',
    },
  ]

  return (
    <MockupFrame title="EquipmentDetail">
      <div className="space-y-5">
        <DetailHeader
          identifier={label.equipmentTitle}
          subtitle={label.equipmentSubtitle}
          badges={
            <>
              <Badge tone="neutral">{label.ownerAlazani}</Badge>
              <Badge tone="success">{label.operationalStatus}</Badge>
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm" icon={<Edit2 size={14} />}>
                {label.edit}
              </Button>
              <Button variant="outline" size="sm" icon={<Power size={14} />}>
                {label.toggleActive}
              </Button>
            </>
          }
        />
        <InfoGridSection title={label.sectionIdentity} items={identityItems} />
        <InfoGridSection
          title={label.sectionOwnership}
          items={ownershipItems}
          columns={2}
        />
        <InfoGridSection
          title={label.sectionDates}
          items={dateItems}
          columns={2}
        />
        <MiniTable
          title={label.recentMovements}
          description={label.recentMovementsDesc}
          columns={movementColumns}
          rows={movementRows}
          rowKey={(row) => row.id}
          viewAllHref="#detail-pages-equipment-movements"
        />
      </div>
    </MockupFrame>
  )
}

function DriverDialogMockup({ label }: { label: (typeof TEXT)['ar'] }) {
  const [open, setOpen] = useState(false)

  const infoItems: InfoGridItem[] = [
    {
      key: 'idNumber',
      icon: <CreditCard size={16} />,
      label: label.idNumber,
      value: '1023456789',
      dir: 'ltr',
    },
    {
      key: 'mobile',
      icon: <Phone size={16} />,
      label: label.mobile,
      value: '0501234567',
      dir: 'ltr',
    },
    {
      key: 'nationality',
      icon: <Flag size={16} />,
      label: label.nationality,
      value: label.saudiNational,
    },
    {
      key: 'employmentType',
      icon: <User size={16} />,
      label: label.employmentType,
      value: label.employmentTypeValue,
    },
    {
      key: 'jobTitle',
      icon: <User size={16} />,
      label: label.jobTitle,
      value: label.driverDialogSubtitle,
    },
  ]

  const equipmentColumns: DataTableColumn<RelatedEquipmentRow>[] = [
    { key: 'code', header: label.code, cell: (row) => row.code },
    {
      key: 'plate',
      header: label.plate,
      cell: (row) => (
        <span dir="ltr" className="inline-block">
          {row.plate}
        </span>
      ),
    },
    {
      key: 'times',
      header: label.timesDriven,
      align: 'center',
      cell: (row) => row.times,
    },
    {
      key: 'current',
      header: <span className="sr-only">{label.drivingNow}</span>,
      align: 'end',
      cell: (row) =>
        row.current ? (
          <Badge tone="entry" size="sm">
            {label.drivingNow}
          </Badge>
        ) : null,
    },
  ]
  const equipmentRows: RelatedEquipmentRow[] = [
    { id: '1', code: 'A-1024', plate: '1234 ا ب ج', times: 12, current: true },
    { id: '2', code: 'TK-208', plate: '5521 ر س ع', times: 4, current: false },
  ]

  return (
    <MockupFrame title="DriverDetailDialog">
      <div className="space-y-3">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {label.driverDialogOpen}
        </Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={label.driverDialogTitle}
          description={label.driverDialogSubtitle}
          size="lg"
        >
          <div className="space-y-5">
            <InfoGrid items={infoItems} columns={2} />
            <MiniTable
              title={label.relatedEquipment}
              description={label.relatedEquipmentDesc}
              columns={equipmentColumns}
              rows={equipmentRows}
              rowKey={(row) => row.id}
              maxRows={10}
              viewAllHref="#detail-pages-driver-equipment"
            />
          </div>
        </Dialog>
      </div>
    </MockupFrame>
  )
}
