// Proposed data model of the purchasing module («PO الموردين»), as discussed
// with the product owner on 2026-10-15 and 2026-10-17. This is REVIEW
// material rendered on /sales: nothing here exists in the database yet, the
// names are tentative and every row is sample data. Arabic copy follows the
// project rule of plain alif (no hamza/madda) for new text.

export type Phase = 1 | 2 | 3 | 4

export type EntityKind = 'existing' | 'extended' | 'new'

export type EntityField = {
  name: string
  type: string
  note: string
}

export type Entity = {
  id: string
  /** Arabic name shown to the owner. */
  title: string
  /** Tentative table name. */
  table: string
  kind: EntityKind
  phase: Phase
  purpose: string
  fields: EntityField[]
}

export type PhaseDef = {
  phase: Phase
  title: string
  summary: string
  includes: string[]
  tables: string
  statuses: string
}

export const PHASES: PhaseDef[] = [
  {
    phase: 1,
    title: 'الاساس',
    summary: 'اصدار POs رسمية مرقمة ومعتمدة، بانشاء يدوي من المشتريات.',
    includes: [
      'سجلات الموردين الاربعة (العزاني، تكوين، F، B) وحقول الاتصال المخفية',
      'انشاء PO يدويا: المورد، العميل، المشروع، بداية الفترة',
      'اضافة المعدات للـ PO مع الوحدة والسعر (غير شامل الضريبة)',
      'ارسال للاعتماد، اعتماد المدير، انهاء معدة يدويا، اقفال الـ PO',
      'قسم «المشتريات» في القائمة: قائمة الـ POs وصفحة الـ PO',
      'الصلاحيات الاربع والدوران الجديدان',
    ],
    tables:
      'lessors (يُوسّع)، supplier_pos، supplier_po_equipment، supplier_po_events',
    statuses: 'مسودة → بانتظار الاعتماد → معتمد → مقفل',
  },
  {
    phase: 2,
    title: 'التعديلات',
    summary: 'تغيير PO معتمد بشكل مضبوط، والالغاء.',
    includes: [
      'تعديل مرقم على PO معتمد (سعر، تمديد، اضافة معدة، انهاء معدة) يحتاج اعتمادا',
      'الرجوع بسبب، والالغاء قبل الارسال',
      'تنبيه في قائمة المعدات المفتوحة لمعدة خرجت من المشروع',
    ],
    tables: 'supplier_po_amendments',
    statuses: 'يُضاف: ملغي',
  },
  {
    phase: 3,
    title: 'الارسال',
    summary: 'مستند الـ PO وتسليمه للمورد.',
    includes: [
      'مستند الـ PO للتحميل (صفحة طباعة مثل تصدير السجلات)، بالضريبة محسوبة',
      'ارسال بواتساب عبر بوابة UltraMsg الموجودة، ثم البريد',
      'سجل كل محاولة ارسال ونتيجتها',
    ],
    tables: 'supplier_po_sends',
    statuses: 'يُضاف: مرسل',
  },
  {
    phase: 4,
    title: 'ما بعد',
    summary: 'يُصمم عند الوصول اليه.',
    includes: [
      'طريقة اضافة الـ POs بعد المرحلة الاولى (نقاش مع مبارك)',
      'كشف مستحق المورد الشهري',
      'ربط PO العميل الحقيقي',
    ],
    tables: '—',
    statuses: '—',
  },
]

export const ENTITIES: Entity[] = [
  {
    id: 'lessors',
    title: 'المورد',
    table: 'lessors (موجود، يُوسّع)',
    kind: 'extended',
    phase: 1,
    purpose:
      'جدول الموردين الحالي يصير سجل كل من نصدر له PO. تُضاف اربعة سجلات ثابتة (العزاني، تكوين، F، B) حتى يكون لكل معدة مورد واحد. حقول الاتصال الجديدة في القاعدة فقط ولا تظهر في شاشة الموردين.',
    fields: [
      { name: 'name', type: 'text', note: 'موجود' },
      { name: 'contact_person', type: 'text', note: 'موجود' },
      { name: 'contact_number', type: 'text', note: 'موجود' },
      {
        name: 'owner_code',
        type: 'text (فريد، اختياري)',
        note: 'جديد، مخفي: يقول ان هذا السجل هو العزاني او تكوين او F او B، فيعرف النظام مورد اي معدة من حقل المالك. المورد الخارجي بدونه.',
      },
      {
        name: 'whatsapp_number',
        type: 'text',
        note: 'جديد: في القاعدة فقط، لا يظهر في الواجهة. يُستخدم في المرحلة 3.',
      },
      {
        name: 'email',
        type: 'text',
        note: 'جديد: في القاعدة فقط، لا يظهر في الواجهة. يُستخدم في المرحلة 3.',
      },
      {
        name: 'is_internal',
        type: 'boolean',
        note: 'جديد: العزاني فقط. الـ PO له يُصدر بقيمة صفر.',
      },
    ],
  },
  {
    id: 'supplier_pos',
    title: 'PO المورد (الراس)',
    table: 'supplier_pos',
    kind: 'new',
    phase: 1,
    purpose:
      'امر الشراء نفسه: مورد واحد، عميل ومشروع واحدان، فترة واحدة. تحته معداته. يُنشا يدويا من المشتريات.',
    fields: [
      {
        name: 'po_number',
        type: 'text (فريد)',
        note: 'SPO + السنة برقمين + تسلسل من 4 ارقام يبدا كل سنة من 0001: SPO260001، SPO260002 ... ثم SPO270001. التسلسل من القاعدة لا من المتصفح.',
      },
      { name: 'lessor_id', type: '→ lessors', note: 'المورد المستلم' },
      {
        name: 'company_id',
        type: '→ companies',
        note: 'العميل الذي تعمل عنده المعدات',
      },
      { name: 'project_id', type: '→ projects', note: 'المشروع' },
      { name: 'period_from', type: 'date', note: 'بداية الفترة' },
      {
        name: 'period_to',
        type: 'date (اختياري)',
        note: 'فارغ = PO مفتوح يستمر حتى يُقفل يدويا',
      },
      {
        name: 'status',
        type: 'draft / pending_approval / approved / closed (+ cancelled م2، sent م3)',
        note: 'تتحرك فقط عبر دوال القاعدة، لا من المتصفح مباشرة',
      },
      { name: 'notes', type: 'text', note: '' },
      {
        name: 'prepared_by / submitted_at',
        type: '→ profiles / timestamptz',
        note: 'من جهز ومتى ارسل للاعتماد',
      },
      {
        name: 'approved_by / approved_at',
        type: '→ profiles / timestamptz',
        note: 'من اعتمد ومتى',
      },
      { name: 'closed_at', type: 'timestamptz', note: 'الاقفال' },
      {
        name: 'sent_at',
        type: 'timestamptz',
        note: 'اخر ارسال ناجح (المرحلة 3)',
      },
    ],
  },
  {
    id: 'supplier_po_equipment',
    title: 'معدات الـ PO',
    table: 'supplier_po_equipment',
    kind: 'new',
    phase: 1,
    purpose:
      'كل صف معدة واحدة بعينها داخل الـ PO، بسعرها ووحدتها وتاريخ بدايتها. يضيفها موظف المشتريات وينهيها يدويا.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: 'الـ PO الذي يحويها' },
      {
        name: 'equipment_id',
        type: '→ equipment',
        note: 'المعدة بعينها (لا نوعها)',
      },
      {
        name: 'start_date',
        type: 'date',
        note: 'الافتراضي = بداية فترة الـ PO',
      },
      {
        name: 'end_date',
        type: 'date (اختياري)',
        note: 'يضعه موظف المشتريات يدويا. الخروج من البوابة لا يضعه تلقائيا (قرار 17 اكتوبر)',
      },
      {
        name: 'price_unit',
        type: 'month / day / hour',
        note: 'تختلف حسب الاتفاق',
      },
      {
        name: 'unit_price',
        type: 'numeric',
        note: 'غير شامل ضريبة القيمة المضافة. فارغ في المسودة، مطلوب قبل الاعتماد، صفر لمعدات العزاني',
      },
      { name: 'status', type: 'draft / active / ended', note: '' },
      { name: 'notes', type: 'text', note: '' },
    ],
  },
  {
    id: 'supplier_po_events',
    title: 'سجل الاحداث',
    table: 'supplier_po_events',
    kind: 'new',
    phase: 1,
    purpose:
      'كل خطوة على الـ PO بمن قام بها ووقتها: انشاء، اضافة معدة، تغيير سعر، ارسال للاعتماد، اعتماد، رجوع، انهاء معدة، اقفال. للقراءة فقط.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: '' },
      { name: 'actor_id', type: '→ profiles', note: 'من' },
      { name: 'action', type: 'text', note: 'ماذا' },
      {
        name: 'details',
        type: 'jsonb',
        note: 'التفاصيل (مثلا السعر القديم والجديد)',
      },
      { name: 'created_at', type: 'timestamptz', note: 'متى' },
    ],
  },
  {
    id: 'supplier_po_amendments',
    title: 'تعديل على PO معتمد',
    table: 'supplier_po_amendments',
    kind: 'new',
    phase: 2,
    purpose:
      'اي تغيير بعد الاعتماد (سعر، تمديد، اضافة معدة، انهاء معدة) يكون تعديلا مرقما يحتاج اعتمادا، ولا يُمس الاصل.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: '' },
      {
        name: 'po_equipment_id',
        type: '→ supplier_po_equipment (اختياري)',
        note: 'المعدة المتاثرة ان وُجدت',
      },
      { name: 'seq', type: 'int', note: 'رقم التعديل داخل الـ PO (1، 2، 3)' },
      {
        name: 'kind',
        type: 'price / extend / add_equipment / end_equipment / cancel',
        note: '',
      },
      {
        name: 'old_value / new_value',
        type: 'jsonb',
        note: 'القيمة قبل وبعد',
      },
      { name: 'reason', type: 'text', note: 'مطلوب' },
      { name: 'requested_by / approved_by', type: '→ profiles', note: '' },
      { name: 'status', type: 'pending / approved / rejected', note: '' },
    ],
  },
  {
    id: 'supplier_po_sends',
    title: 'الارسال للمورد',
    table: 'supplier_po_sends',
    kind: 'new',
    phase: 3,
    purpose:
      'كل محاولة ارسال بقناتها ونتيجتها. التحميل اولا، ثم واتساب (بوابة UltraMsg الموجودة) والبريد. الفشل لا يغير حالة الـ PO.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: '' },
      { name: 'channel', type: 'download / whatsapp / email', note: '' },
      {
        name: 'recipient',
        type: 'text',
        note: 'الرقم او البريد وقت الارسال',
      },
      { name: 'status', type: 'sent / failed', note: '' },
      {
        name: 'sent_by / sent_at',
        type: '→ profiles / timestamptz',
        note: '',
      },
      {
        name: 'error',
        type: 'text (اختياري)',
        note: 'سبب الفشل بصيغة مفهومة',
      },
    ],
  },
]

export type Relation = {
  from: string
  to: string
  cardinality: string
  phase: Phase
  rule: string
}

export const RELATIONS: Relation[] = [
  {
    from: 'المورد',
    to: 'PO المورد',
    cardinality: '1 ← ∞',
    phase: 1,
    rule: 'للمورد عدة POs، ولكل PO مورد واحد.',
  },
  {
    from: 'العميل + المشروع',
    to: 'PO المورد',
    cardinality: '1 ← ∞',
    phase: 1,
    rule: 'الـ PO لعميل ومشروع واحدين (شرط التجميع). نفس العميل والمشروع قد يكون لهما عدة POs بفترات مختلفة.',
  },
  {
    from: 'PO المورد',
    to: 'معدات الـ PO',
    cardinality: '1 ← ∞',
    phase: 1,
    rule: 'عدة معدات تحت PO واحد بشرط نفس العميل والمشروع والفترة.',
  },
  {
    from: 'المعدة',
    to: 'معدات الـ PO',
    cardinality: '1 ← ∞',
    phase: 1,
    rule: 'المعدة تظهر في POs كثيرة عبر الزمن، لكن في PO مفتوح واحد فقط في اي وقت.',
  },
  {
    from: 'PO المورد',
    to: 'سجل الاحداث',
    cardinality: '1 ← ∞',
    phase: 1,
    rule: 'كل خطوة تُسجل ولا تُحذف.',
  },
  {
    from: 'PO المورد',
    to: 'التعديلات',
    cardinality: '1 ← ∞',
    phase: 2,
    rule: 'التعديل تابع للـ PO وقد يشير الى معدة واحدة فيه.',
  },
  {
    from: 'PO المورد',
    to: 'الارسال',
    cardinality: '1 ← ∞',
    phase: 3,
    rule: 'كل محاولة ارسال تابعة للـ PO.',
  },
  {
    from: 'المستخدم',
    to: 'PO / تعديل / حدث / ارسال',
    cardinality: '1 ← ∞',
    phase: 1,
    rule: 'من جهز، من اعتمد، من ارسل: من profiles عبر الصلاحيات الجديدة.',
  },
]

export type StatusStep = {
  key: string
  label: string
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'entry' | 'danger'
  phase: Phase
  who: string
  what: string
}

export const LIFECYCLE: StatusStep[] = [
  {
    key: 'draft',
    label: 'مسودة',
    tone: 'neutral',
    phase: 1,
    who: 'موظف المشتريات',
    what: 'ينشئ الـ PO ويضيف المعدات ويسعّرها. لا رقم رسمي بعد.',
  },
  {
    key: 'pending_approval',
    label: 'بانتظار الاعتماد',
    tone: 'warning',
    phase: 1,
    who: 'موظف المشتريات',
    what: 'لا يُرسل للاعتماد الا وكل معدة لها وحدة وسعر (الصفر مقبول للعزاني).',
  },
  {
    key: 'approved',
    label: 'معتمد',
    tone: 'success',
    phase: 1,
    who: 'مدير المشتريات',
    what: 'يعتمد او يرجع للمسودة بسبب. يحق له تغيير السعر قبل الاعتماد ويُسجل التغيير. عند الاعتماد ياخذ الـ PO رقمه.',
  },
  {
    key: 'closed',
    label: 'مقفل',
    tone: 'entry',
    phase: 1,
    who: 'موظف المشتريات',
    what: 'عندما يضع تاريخ نهاية لكل المعدات، او يقفل الـ PO يدويا.',
  },
  {
    key: 'cancelled',
    label: 'ملغي',
    tone: 'danger',
    phase: 2,
    who: 'مدير المشتريات',
    what: 'مسودة او PO معتمد لم يُرسل. بعد الارسال لا يُلغى بل يُقفل بتعديل.',
  },
  {
    key: 'sent',
    label: 'مرسل',
    tone: 'info',
    phase: 3,
    who: 'موظف المشتريات',
    what: 'تحميل الملف، ثم واتساب او بريد. كل محاولة تُسجل. يمكن اعادة الارسال.',
  },
]

export type FlowStep = {
  title: string
  detail: string
  actor: string
}

export const WORKFLOW: FlowStep[] = [
  {
    title: 'انشاء الـ PO',
    detail:
      'من قسم المشتريات: اختيار المورد والعميل والمشروع وبداية الفترة. لا شيء يُنشا من البوابة تلقائيا (قرار 17 اكتوبر).',
    actor: 'موظف المشتريات',
  },
  {
    title: 'اضافة المعدات',
    detail:
      'بحث بالرقم كما في بقية النظام. النظام يقترح معدات هذا المورد الموجودة الان داخل مشروع العميل نفسه، وينبه اذا كانت المعدة في مكان اخر او في PO مفتوح غيره، دون منع.',
    actor: 'موظف المشتريات',
  },
  {
    title: 'التسعير',
    detail:
      'لكل معدة الوحدة (شهر / يوم / ساعة) والسعر غير شامل الضريبة. النظام يقترح اخر سعر لنفس المعدة مع نفس المورد. معدات العزاني بصفر.',
    actor: 'موظف المشتريات',
  },
  {
    title: 'الارسال للاعتماد',
    detail: 'يُقبل فقط اذا اكتملت الوحدة والسعر لكل معدة. يُسجل من ارسل ومتى.',
    actor: 'موظف المشتريات',
  },
  {
    title: 'الاعتماد',
    detail:
      'المدير يراجع، يعدل السعر ان لزم (يُسجل)، ويعتمد او يرجع بسبب. عند الاعتماد ياخذ الـ PO رقمه الرسمي.',
    actor: 'مدير المشتريات',
  },
  {
    title: 'انهاء معدة واقفال الـ PO',
    detail:
      'الموظف يضع تاريخ النهاية للمعدة يدويا متى ما تاكد. عندما تنتهي كل المعدات يُقفل الـ PO. التعديلات بعد الاعتماد تاتي في المرحلة 2.',
    actor: 'موظف المشتريات',
  },
]

export type PermissionRow = {
  key: string
  name: string
  phase: Phase
  officer: boolean
  manager: boolean
  note: string
}

export const PERMISSIONS: PermissionRow[] = [
  {
    key: 'purchasing.view',
    name: 'عرض المشتريات',
    phase: 1,
    officer: true,
    manager: true,
    note: 'قائمة الـ POs وتفاصيلها والسجل. تفتح قسم «المشتريات» في القائمة الجانبية.',
  },
  {
    key: 'purchasing.prepare',
    name: 'تجهيز PO',
    phase: 1,
    officer: true,
    manager: true,
    note: 'انشاء الـ POs، اضافة المعدات، التسعير، الارسال للاعتماد، انهاء المعدات، الاقفال.',
  },
  {
    key: 'purchasing.approve',
    name: 'اعتماد PO',
    phase: 1,
    officer: false,
    manager: true,
    note: 'الاعتماد والرجوع وتغيير السعر قبل الاعتماد، واعتماد التعديلات (المرحلة 2).',
  },
  {
    key: 'suppliers.manage',
    name: 'ادارة بيانات الموردين',
    phase: 1,
    officer: true,
    manager: true,
    note: 'جهات الاتصال. الاسماء الثابتة (العزاني، تكوين، F، B) لا تُحذف. الواتساب والبريد لا يظهران في الواجهة.',
  },
  {
    key: 'purchasing.send',
    name: 'ارسال PO للمورد',
    phase: 3,
    officer: true,
    manager: true,
    note: 'التحميل والارسال عبر القنوات المتاحة.',
  },
]

export type Decision = { date: string; text: string }

export const DECISIONS: Decision[] = [
  {
    date: '15 اكتوبر',
    text: 'كيانان منفصلان: «PO العملاء» (وارد) و«PO الموردين» (صادر من النظام).',
  },
  {
    date: '15 اكتوبر',
    text: 'الموظف يجهز، المدير يعتمد ويحق له تغيير السعر. PDF مؤجل، الارسال بواتساب وبريد وتحميل كلها مطلوبة.',
  },
  {
    date: '17 اكتوبر',
    text: 'نبدا بالمشتريات (اصدار POs للموردين) قبل PO العملاء.',
  },
  {
    date: '17 اكتوبر',
    text: 'خروج المعدة لا ينهي صفها تلقائيا؛ الانهاء يدوي من المشتريات لحين الوصول لطريقة معينة.',
  },
  {
    date: '17 اكتوبر',
    text: 'وحدة السعر تختلف (شهر / يوم / ساعة)، والسعر غير شامل ضريبة القيمة المضافة.',
  },
  {
    date: '17 اكتوبر',
    text: 'تكوين و F و B يصدر لهم PO مثل المورد الخارجي، والعزاني يصدر له PO بقيمة صفر.',
  },
  {
    date: '17 اكتوبر',
    text: 'PO واحد يحمل عدة معدات بشرط نفس العميل والمشروع والفترة. معدة تدخل لاحقا قد تنضم لـ PO قديم او يُفتح جديد.',
  },
  { date: '17 اكتوبر', text: 'PO واحد مفتوح يستمر، بلا اعادة اصدار شهرية.' },
  {
    date: '17 اكتوبر',
    text: 'الترقيم: SPO + السنة برقمين + تسلسل من 4 ارقام يبدا كل سنة (SPO260001).',
  },
  {
    date: '17 اكتوبر',
    text: 'لا مسودة تلقائية من دخول البوابة. المرحلة 1 انشاء يدوي، وطريقة اضافة الـ POs تُناقش بعد اكتمالها.',
  },
  {
    date: '17 اكتوبر',
    text: 'رقم PO العميل لا يُضاف الان؛ يُضاف لاحقا مع مرحلة PO العملاء.',
  },
  {
    date: '17 اكتوبر',
    text: 'واتساب وبريد المورد في القاعدة فقط، لا يظهران في الواجهة.',
  },
  {
    date: '17 اكتوبر',
    text: 'العمل على اربع مراحل: الاساس، التعديلات، الارسال، ما بعد.',
  },
]

export const OPEN_QUESTIONS: string[] = [
  'الاسم «معدات الـ PO» (الجدول supplier_po_equipment) بدل «بند»: موافق، ام تفضل اسما اخر؟',
  'ما تعريف «نفس الفترة» عند ضم معدة الى PO قديم؟ مقترح: اي PO ما زال مفتوحا (بلا تاريخ نهاية) يصلح، والموظف يقرر.',
  'PO العزاني بقيمة صفر: هل يمر على الاعتماد مثل غيره، ام يُعتمد تلقائيا؟ مقترح: يُعتمد تلقائيا ويبقى في السجل.',
  'من يحق له انهاء معدة يدويا: الموظف وحده، ام يحتاج اعتماد المدير كونه يوقف الاستحقاق؟',
  'هل ياخذ الـ PO رقمه عند الاعتماد (مقترح) ام عند الانشاء كمسودة؟',
  'شكل مستند الـ PO المرسل للمورد (الترويسة، البنود، التوقيع): يُحدد في المرحلة 3.',
]

// ---- Sample PO for the preview card ----

export type SampleLine = {
  code: string
  type: string
  start: string
  end: string | null
  unit: string
  price: string
}

export const SAMPLE_PO = {
  number: 'SPO260007',
  supplier: 'مؤسسة النخبة للمعدات',
  client: 'شركة البناء المتحدة',
  project: 'طريق الملك عبدالعزيز · المرحلة 2',
  periodFrom: '03/10/2026',
  status: 'approved' as const,
  preparedBy: 'سعد المطيري',
  approvedBy: 'فهد الدوسري',
  lines: [
    {
      code: 'F120',
      type: 'بوكلين',
      start: '03/10/2026',
      end: null,
      unit: 'شهر',
      price: '18,000',
    },
    {
      code: 'F133',
      type: 'لودر',
      start: '03/10/2026',
      end: null,
      unit: 'شهر',
      price: '15,500',
    },
    {
      code: 'F121',
      type: 'شيول صغير',
      start: '09/10/2026',
      end: '14/10/2026',
      unit: 'يوم',
      price: '900',
    },
  ] satisfies SampleLine[],
}
