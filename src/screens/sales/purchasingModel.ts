// Proposed data model of the purchasing module («PO الموردين»), as discussed
// with the product owner on 2026-10-15 and 2026-10-17. This is REVIEW
// material rendered on /sales: nothing here exists in the database yet, the
// names are tentative and every row is sample data. Arabic copy follows the
// project rule of plain alif (no hamza/madda) for new text.

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
  purpose: string
  fields: EntityField[]
}

export const ENTITIES: Entity[] = [
  {
    id: 'lessors',
    title: 'المورد',
    table: 'lessors (موجود، يُوسّع)',
    kind: 'extended',
    purpose:
      'جدول الموردين الحالي يصير سجل كل من نصدر له PO: المورد الخارجي كما هو، ويُضاف تكوين و F و B والعزاني كسجلات ثابتة حتى يكون لكل معدة مورد واحد يُرسل اليه.',
    fields: [
      { name: 'name', type: 'text', note: 'موجود' },
      { name: 'contact_person', type: 'text', note: 'موجود' },
      { name: 'contact_number', type: 'text', note: 'موجود' },
      {
        name: 'owner_code',
        type: 'text (فريد، اختياري)',
        note: 'جديد: يربط السجل بقيمة المالك في المعدة (alazani / takween / third_party_f / third_party_partnership_b). المورد الخارجي بدونه.',
      },
      {
        name: 'whatsapp_number',
        type: 'text',
        note: 'جديد: رقم استلام الـ PO على واتساب',
      },
      { name: 'email', type: 'text', note: 'جديد: بريد استلام الـ PO' },
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
    purpose:
      'امر الشراء نفسه: مورد واحد، عميل ومشروع واحدان، فترة واحدة. تحته البنود. الرقم تسلسلي من القاعدة.',
    fields: [
      {
        name: 'po_number',
        type: 'text (فريد)',
        note: 'مقترح: SPO-2026-0001، تسلسل سنوي من القاعدة لا من المتصفح',
      },
      { name: 'lessor_id', type: '→ lessors', note: 'المورد المستلم' },
      {
        name: 'company_id',
        type: '→ companies',
        note: 'العميل الذي تعمل عنده المعدات',
      },
      { name: 'project_id', type: '→ projects', note: 'المشروع' },
      { name: 'period_from', type: 'date', note: 'بداية الفترة (اول دخول)' },
      {
        name: 'period_to',
        type: 'date (اختياري)',
        note: 'فارغ = PO مفتوح يستمر حتى يُقفل يدويا',
      },
      {
        name: 'status',
        type: 'draft / pending_approval / approved / sent / closed / cancelled',
        note: 'تتحرك فقط عبر دوال القاعدة، لا من المتصفح مباشرة',
      },
      {
        name: 'client_po_ref',
        type: 'text (اختياري)',
        note: 'رقم PO العميل كنص فقط الان؛ يصير رابطا حقيقيا في مرحلة PO العملاء',
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
      {
        name: 'sent_at / closed_at',
        type: 'timestamptz',
        note: 'اخر ارسال، والاقفال',
      },
    ],
  },
  {
    id: 'supplier_po_lines',
    title: 'بند PO (معدة واحدة)',
    table: 'supplier_po_lines',
    kind: 'new',
    purpose:
      'معدة واحدة بعينها، بسعرها ووحدتها وتاريخ بدايتها. ينشا تلقائيا من دخول البوابة ويُقفل يدويا من المشتريات.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: 'الـ PO الذي يحوي البند' },
      {
        name: 'equipment_id',
        type: '→ equipment',
        note: 'المعدة بعينها (لا نوعها)',
      },
      {
        name: 'entry_log_id',
        type: '→ entry_exit_logs (اختياري)',
        note: 'حركة الدخول التي انشات البند؛ فارغ اذا اضيف يدويا',
      },
      { name: 'start_date', type: 'date', note: 'الافتراضي = تاريخ الدخول' },
      {
        name: 'end_date',
        type: 'date (اختياري)',
        note: 'يضعه موظف المشتريات يدويا (قرار 17 اكتوبر). الخروج من البوابة لا يقفله تلقائيا',
      },
      {
        name: 'price_unit',
        type: 'month / day / hour',
        note: 'تختلف حسب الاتفاق',
      },
      {
        name: 'unit_price',
        type: 'numeric',
        note: 'فارغ في المسودة، مطلوب قبل الاعتماد، صفر لمعدات العزاني',
      },
      { name: 'status', type: 'draft / active / ended', note: '' },
      { name: 'notes', type: 'text', note: '' },
    ],
  },
  {
    id: 'supplier_po_amendments',
    title: 'تعديل على PO معتمد',
    table: 'supplier_po_amendments',
    kind: 'new',
    purpose:
      'اي تغيير بعد الاعتماد (سعر، تمديد، اضافة معدة، اقفال بند) يكون تعديلا مرقما يحتاج اعتمادا، ولا يُمس الاصل.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: '' },
      {
        name: 'line_id',
        type: '→ supplier_po_lines (اختياري)',
        note: 'البند المتاثر ان وُجد',
      },
      { name: 'seq', type: 'int', note: 'رقم التعديل داخل الـ PO (1، 2، 3)' },
      {
        name: 'kind',
        type: 'price / extend / add_line / end_line / cancel',
        note: '',
      },
      { name: 'old_value / new_value', type: 'jsonb', note: 'القيمة قبل وبعد' },
      { name: 'reason', type: 'text', note: 'مطلوب' },
      { name: 'requested_by / approved_by', type: '→ profiles', note: '' },
      { name: 'status', type: 'pending / approved / rejected', note: '' },
    ],
  },
  {
    id: 'supplier_po_events',
    title: 'سجل الاحداث',
    table: 'supplier_po_events',
    kind: 'new',
    purpose:
      'كل خطوة على الـ PO بمن قام بها ووقتها: انشاء، تعديل سعر، ارسال للاعتماد، اعتماد، رفض، ارسال، اقفال. للقراءة فقط.',
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
    id: 'supplier_po_sends',
    title: 'الارسال للمورد',
    table: 'supplier_po_sends',
    kind: 'new',
    purpose:
      'كل محاولة ارسال بقناتها ونتيجتها. التحميل اولا، ثم واتساب (بوابة UltraMsg الموجودة) والبريد لاحقا. الفشل لا يغير حالة الـ PO.',
    fields: [
      { name: 'po_id', type: '→ supplier_pos', note: '' },
      { name: 'channel', type: 'download / whatsapp / email', note: '' },
      { name: 'recipient', type: 'text', note: 'الرقم او البريد وقت الارسال' },
      { name: 'status', type: 'sent / failed', note: '' },
      { name: 'sent_by / sent_at', type: '→ profiles / timestamptz', note: '' },
      { name: 'error', type: 'text (اختياري)', note: 'سبب الفشل بصيغة مفهومة' },
    ],
  },
]

export type Relation = {
  from: string
  to: string
  cardinality: string
  rule: string
}

export const RELATIONS: Relation[] = [
  {
    from: 'المورد',
    to: 'PO المورد',
    cardinality: '1 ← ∞',
    rule: 'للمورد عدة POs، ولكل PO مورد واحد.',
  },
  {
    from: 'العميل + المشروع',
    to: 'PO المورد',
    cardinality: '1 ← ∞',
    rule: 'الـ PO لعميل ومشروع واحدين (شرط التجميع). نفس العميل والمشروع قد يكون لهما عدة POs بفترات مختلفة.',
  },
  {
    from: 'PO المورد',
    to: 'بند PO',
    cardinality: '1 ← ∞',
    rule: 'عدة معدات تحت PO واحد بشرط نفس العميل والمشروع والفترة.',
  },
  {
    from: 'المعدة',
    to: 'بند PO',
    cardinality: '1 ← ∞',
    rule: 'المعدة لها بنود كثيرة عبر الزمن، لكن بند واحد مفتوح فقط في اي وقت.',
  },
  {
    from: 'حركة الدخول',
    to: 'بند PO',
    cardinality: '1 ← 0..1',
    rule: 'دخول المشروع ينشا بندا واحدا على الاكثر. اعادة الدخول لنفس العميل والمشروع لا تنشا بندا جديدا اذا كان للمعدة بند مفتوح هناك.',
  },
  {
    from: 'PO المورد',
    to: 'التعديلات / السجل / الارسال',
    cardinality: '1 ← ∞',
    rule: 'كلها تابعة للـ PO وتُقرا معه، ولا تُحذف.',
  },
  {
    from: 'المستخدم',
    to: 'PO / تعديل / حدث / ارسال',
    cardinality: '1 ← ∞',
    rule: 'من جهز، من اعتمد، من ارسل: من profiles عبر الصلاحيات الجديدة.',
  },
]

export type StatusStep = {
  key: string
  label: string
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'entry' | 'danger'
  who: string
  what: string
}

export const LIFECYCLE: StatusStep[] = [
  {
    key: 'draft',
    label: 'مسودة',
    tone: 'neutral',
    who: 'النظام (من دخول البوابة) او موظف المشتريات',
    what: 'بنود بلا سعر. الموظف يكمل السعر والوحدة، يضم البنود، ويختار PO قديما او جديدا.',
  },
  {
    key: 'pending_approval',
    label: 'بانتظار الاعتماد',
    tone: 'warning',
    who: 'موظف المشتريات',
    what: 'لا يُرسل للاعتماد الا وكل بند له سعر ووحدة (الصفر مقبول للعزاني).',
  },
  {
    key: 'approved',
    label: 'معتمد',
    tone: 'success',
    who: 'مدير المشتريات',
    what: 'يعتمد او يرجع للمسودة بسبب. يحق له تغيير السعر قبل الاعتماد ويُسجل التغيير.',
  },
  {
    key: 'sent',
    label: 'مرسل',
    tone: 'info',
    who: 'موظف المشتريات',
    what: 'تحميل الملف، ثم واتساب او بريد. كل محاولة تُسجل. يمكن اعادة الارسال.',
  },
  {
    key: 'closed',
    label: 'مقفل',
    tone: 'entry',
    who: 'موظف المشتريات',
    what: 'عندما يضع تاريخ نهاية لكل البنود، او يقفل الـ PO يدويا.',
  },
  {
    key: 'cancelled',
    label: 'ملغي',
    tone: 'danger',
    who: 'مدير المشتريات',
    what: 'مسودة او PO معتمد لم يُرسل. بعد الارسال لا يُلغى بل يُقفل بتعديل.',
  },
]

export type FlowStep = {
  title: string
  detail: string
  actor: string
}

export const GATE_FLOW: FlowStep[] = [
  {
    title: 'دخول معدة الى مشروع',
    detail:
      'الفورمان يسجل الدخول كالمعتاد. بعد حفظ الحركة ينشئ النظام بند مسودة لمورد المعدة (او للعزاني بصفر) بتاريخ الدخول وبلا سعر. اي فشل هنا لا يمس الحركة.',
    actor: 'النظام',
  },
  {
    title: 'ضم البند الى PO',
    detail:
      'اذا كان للمورد PO مفتوح لنفس العميل والمشروع يُقترح الضم اليه، والا تُنشا مسودة PO جديدة. الموظف يقرر في الحالتين.',
    actor: 'موظف المشتريات',
  },
  {
    title: 'التسعير',
    detail:
      'الموظف يضع الوحدة (شهر / يوم / ساعة) والسعر لكل بند. النظام يقترح اخر سعر لنفس المعدة مع نفس المورد.',
    actor: 'موظف المشتريات',
  },
  {
    title: 'الاعتماد',
    detail: 'المدير يراجع، يعدل السعر ان لزم، ويعتمد. يصير للـ PO رقم رسمي.',
    actor: 'مدير المشتريات',
  },
  {
    title: 'الارسال',
    detail: 'تحميل الـ PO، ثم ارساله للمورد. السجل يحفظ القناة والنتيجة.',
    actor: 'موظف المشتريات',
  },
  {
    title: 'انهاء البند',
    detail:
      'عند خروج المعدة من المشروع لا يتغير شيء تلقائيا. الموظف يضع تاريخ النهاية يدويا متى ما تاكد (قرار 17 اكتوبر). الخروج يظهر كتنبيه في قائمة البنود المفتوحة.',
    actor: 'موظف المشتريات',
  },
]

export type PermissionRow = {
  key: string
  name: string
  officer: boolean
  manager: boolean
  note: string
}

export const PERMISSIONS: PermissionRow[] = [
  {
    key: 'purchasing.view',
    name: 'عرض المشتريات',
    officer: true,
    manager: true,
    note: 'قائمة الـ POs وتفاصيلها والسجل. تفتح قسم «المشتريات» في القائمة الجانبية.',
  },
  {
    key: 'purchasing.prepare',
    name: 'تجهيز PO',
    officer: true,
    manager: true,
    note: 'انشاء المسودات، التسعير، الضم، الارسال للاعتماد، انهاء البنود.',
  },
  {
    key: 'purchasing.approve',
    name: 'اعتماد PO',
    officer: false,
    manager: true,
    note: 'الاعتماد والرفض وتغيير السعر قبل الاعتماد، واعتماد التعديلات.',
  },
  {
    key: 'purchasing.send',
    name: 'ارسال PO للمورد',
    officer: true,
    manager: true,
    note: 'التحميل والارسال عبر القنوات المتاحة.',
  },
  {
    key: 'suppliers.manage',
    name: 'ادارة بيانات الموردين',
    officer: true,
    manager: true,
    note: 'ارقام الواتساب والبريد وجهات الاتصال. الاسماء الثابتة (تكوين، F، B، العزاني) لا تُحذف.',
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
    text: 'دخول معدة مستاجرة الى مشروع ينشئ مسودة PO مورد تلقائيا بلا سعر، ولا يعيق الحركة.',
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
    text: 'خروج المعدة لا يقفل البند تلقائيا؛ الانهاء يدوي من المشتريات لحين الوصول لطريقة معينة.',
  },
  { date: '17 اكتوبر', text: 'وحدة السعر تختلف (شهر / يوم / ساعة).' },
  {
    date: '17 اكتوبر',
    text: 'تكوين و F و B يصدر لهم PO مثل المورد الخارجي، والعزاني يصدر له PO بقيمة صفر.',
  },
  {
    date: '17 اكتوبر',
    text: 'PO واحد يحمل عدة معدات بشرط نفس العميل والمشروع والفترة. معدة تدخل لاحقا قد تنضم لـ PO قديم او يُفتح جديد.',
  },
  {
    date: '17 اكتوبر',
    text: 'PO واحد مفتوح يستمر، بلا اعادة اصدار شهرية. لا ترقيم سابق؛ تسلسل جديد.',
  },
]

export const OPEN_QUESTIONS: string[] = [
  'ما تعريف «نفس الفترة» عند الضم؟ مقترح: اي بند يبدا والـ PO ما زال مفتوحا (بلا تاريخ نهاية) يصلح للضم، والموظف يقرر.',
  'PO العزاني بقيمة صفر: هل يمر على الاعتماد مثل غيره، ام يُعتمد تلقائيا لان لا قيمة له؟ مقترح: يُعتمد تلقائيا ويبقى في السجل.',
  'هل السعر شامل ضريبة القيمة المضافة ام قبلها؟ وهل يظهر مجموع تقديري شهري على الـ PO؟',
  'من يحق له انهاء البند يدويا: الموظف وحده، ام يحتاج اعتماد المدير كونه يوقف الاستحقاق؟',
  'شكل مستند الـ PO المرسل للمورد (الترويسة، البنود، التوقيع). مؤجل بقرارك لكن يحدد حقول الراس.',
  'هل يحتاج الـ PO حقلا لرقم PO العميل منذ الان (نص فقط)؟ مقترح: نعم، اختياري، يصير رابطا في مرحلة PO العملاء.',
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
  number: 'SPO-2026-0007',
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
