const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its relative and `@/lib/...` imports to
// the real files, so the bucketing helper is exercised against the same
// calendar and Saudi-time helpers the chart uses.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        const match = /^(?:@\/lib\/|\.\/)(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const {
  buildChartBuckets,
  chartBucketLabel,
  chartBucketRangeLabel,
  chartBucketUnit,
  chartRangeDays,
} = loadLibModule('chartBuckets')

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

test('range length counts both ends and rejects bad input', () => {
  assert.equal(chartRangeDays('2026-09-01', '2026-09-01'), 1)
  assert.equal(chartRangeDays('2026-09-01', '2026-09-30'), 30)
  // 2028 is a leap year, so the whole year is 366 days.
  assert.equal(chartRangeDays('2028-01-01', '2028-12-31'), 366)
  assert.equal(chartRangeDays('2026-09-30', '2026-09-01'), 0)
  assert.equal(chartRangeDays('2026-02-30', '2026-03-01'), 0)
  assert.equal(chartRangeDays('nonsense', '2026-03-01'), 0)
})

test('granularity follows the length of the range', () => {
  // A month shows its days.
  assert.equal(chartBucketUnit('2026-09-01', '2026-09-30'), 'day')
  assert.equal(chartBucketUnit('2026-02-01', '2026-02-28'), 'day')
  // The day/week boundary sits at 45 days.
  assert.equal(chartBucketUnit('2026-01-01', '2026-02-14'), 'day')
  assert.equal(chartBucketUnit('2026-01-01', '2026-02-15'), 'week')
  // The week/month boundary sits at 183 days.
  assert.equal(chartBucketUnit('2026-01-01', '2026-07-02'), 'week')
  assert.equal(chartBucketUnit('2026-01-01', '2026-07-03'), 'month')
  // A year is monthly.
  assert.equal(chartBucketUnit('2026-01-01', '2026-12-31'), 'month')
})

test('a calendar year becomes twelve month buckets', () => {
  const buckets = buildChartBuckets('2026-01-01', '2026-12-31')
  assert.equal(buckets.length, 12)
  assert.equal(buckets[0].unit, 'month')
  assert.deepEqual(plain(buckets[0]), {
    key: '2026-01',
    unit: 'month',
    fromKey: '2026-01-01',
    toKey: '2026-01-31',
    fromIso: '2025-12-31T21:00:00.000Z',
    toIso: '2026-01-31T20:59:59.999Z',
    days: 31,
  })
  assert.equal(buckets[1].days, 28)
  assert.equal(buckets[11].key, '2026-12')
  assert.equal(buckets[11].toKey, '2026-12-31')
  // Every day of the year is covered exactly once.
  assert.equal(
    buckets.reduce((sum, bucket) => sum + bucket.days, 0),
    365,
  )
})

test('a month becomes one bucket per day with Saudi day bounds', () => {
  const buckets = buildChartBuckets('2026-09-01', '2026-09-30')
  assert.equal(buckets.length, 30)
  assert.equal(buckets[0].key, '2026-09-01')
  assert.equal(buckets[0].days, 1)
  // A Saudi day starts at 21:00 UTC the evening before and ends at 20:59:59.
  assert.equal(buckets[0].fromIso, '2026-08-31T21:00:00.000Z')
  assert.equal(buckets[0].toIso, '2026-09-01T20:59:59.999Z')
  assert.equal(buckets[29].key, '2026-09-30')
})

test('weekly buckets start on Monday and clamp to the range ends', () => {
  // 2026-01-01 is a Thursday: the first bucket is a partial week.
  const buckets = buildChartBuckets('2026-01-01', '2026-03-04')
  assert.equal(buckets[0].unit, 'week')
  assert.deepEqual(plain(buckets[0]), {
    key: '2025-12-29',
    unit: 'week',
    fromKey: '2026-01-01',
    toKey: '2026-01-04',
    fromIso: '2025-12-31T21:00:00.000Z',
    toIso: '2026-01-04T20:59:59.999Z',
    days: 4,
  })
  assert.equal(buckets[1].fromKey, '2026-01-05')
  assert.equal(buckets[1].toKey, '2026-01-11')
  assert.equal(buckets[1].days, 7)
  const last = buckets[buckets.length - 1]
  assert.equal(last.toKey, '2026-03-04')
  assert.equal(
    buckets.reduce((sum, bucket) => sum + bucket.days, 0),
    chartRangeDays('2026-01-01', '2026-03-04'),
  )
})

test('a forced unit overrides the automatic choice', () => {
  // Early January: "this year" must still be monthly, not weekly.
  assert.equal(chartBucketUnit('2026-01-01', '2026-02-20'), 'week')
  const forced = buildChartBuckets('2026-01-01', '2026-02-20', 'month')
  assert.deepEqual(
    plain(forced.map((bucket) => [bucket.key, bucket.toKey, bucket.days])),
    [
      ['2026-01', '2026-01-31', 31],
      ['2026-02', '2026-02-20', 20],
    ],
  )
})

test('partial first and last month buckets stay inside the range', () => {
  const buckets = buildChartBuckets('2026-01-15', '2026-08-10')
  assert.equal(buckets[0].unit, 'month')
  assert.equal(buckets[0].fromKey, '2026-01-15')
  assert.equal(buckets[0].toKey, '2026-01-31')
  assert.equal(buckets[0].days, 17)
  const last = buckets[buckets.length - 1]
  assert.equal(last.key, '2026-08')
  assert.equal(last.toKey, '2026-08-10')
  assert.equal(last.days, 10)
})

test('a single day and invalid or reversed ranges are handled', () => {
  const one = buildChartBuckets('2026-09-19', '2026-09-19')
  assert.equal(one.length, 1)
  assert.equal(one[0].days, 1)
  assert.deepEqual(plain(buildChartBuckets('2026-09-30', '2026-09-01')), [])
  assert.deepEqual(plain(buildChartBuckets('2026-02-30', '2026-03-05')), [])
  assert.deepEqual(plain(buildChartBuckets('', '2026-03-05')), [])
})

test('labels are short on the axis and full in the tooltip', () => {
  const [day] = buildChartBuckets('2026-09-07', '2026-09-08')
  assert.equal(chartBucketLabel(day, 'ar'), '07/09')
  assert.equal(chartBucketLabel(day, 'en'), '07/09')
  assert.equal(chartBucketRangeLabel(day), '07/09/2026')

  const months = buildChartBuckets('2026-01-01', '2026-12-31')
  assert.equal(chartBucketLabel(months[0], 'ar'), 'يناير')
  assert.equal(chartBucketLabel(months[0], 'en'), 'Jan')
  assert.equal(chartBucketLabel(months[3], 'ar'), 'ابريل')
  assert.equal(chartBucketRangeLabel(months[0]), '01/01/2026 – 31/01/2026')

  const weeks = buildChartBuckets('2026-01-01', '2026-03-04')
  assert.equal(chartBucketLabel(weeks[1], 'ar'), '05/01')
  assert.equal(chartBucketRangeLabel(weeks[1]), '05/01/2026 – 11/01/2026')
})

test('new Arabic labels avoid hamza and madda forms', () => {
  const months = buildChartBuckets('2026-01-01', '2026-12-31')
  for (const bucket of months)
    assert.doesNotMatch(chartBucketLabel(bucket, 'ar'), /[أإآ]/)
})
