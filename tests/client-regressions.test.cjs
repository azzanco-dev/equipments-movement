const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

// Small deterministic hook scheduler: exercises the actual modules with fake
// navigation/auth boundaries, without network calls or production test records.
function harness(file, dependencies = {}) {
  let cursor = 0
  let dirty = false
  let renderFunction
  let output
  const slots = []
  const effects = []
  const timers = new Map()
  let timerId = 0
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = {
    createContext: () => ({ Provider: 'provider' }),
    useState(initial) {
      const index = cursor++
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial
      return [
        slots[index],
        (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value
          if (!Object.is(next, slots[index])) {
            slots[index] = next
            dirty = true
          }
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      return (slots[index] ??= { current: initial })
    },
    useMemo(fn, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }
      return slots[index].value
    },
    useCallback(fn, deps) {
      return hooks.useMemo(() => fn, deps)
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.()
          slots[index] = { deps, cleanup: fn() }
        })
      }
    },
  }
  const setTimeout = (fn) => {
    timers.set(++timerId, fn)
    return timerId
  }
  const clearTimeout = (id) => timers.delete(id)
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  vm.runInNewContext(
    code,
    {
      exports,
      console,
      AbortController,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      window: { setTimeout, clearTimeout, ...dependencies.window },
      document: dependencies.document,
      URL: dependencies.URL,
      require(name) {
        if (name === 'react') return hooks
        if (name === 'react/jsx-runtime') return { jsx: (_, props) => props }
        if (name in dependencies) return dependencies[name]
        throw new Error(`Unexpected module: ${name}`)
      },
    },
    { filename: file },
  )
  const render = () => {
    let rounds = 0
    do {
      dirty = false
      cursor = 0
      output = renderFunction(exports)
      while (effects.length) effects.shift()()
      assert.ok(++rounds < 20, 'render must settle')
    } while (dirty)
    return output
  }
  return {
    start(fn) {
      renderFunction = fn
      return render()
    },
    render,
    async flush() {
      const pending = [...timers.values()]
      timers.clear()
      for (const fn of pending) void fn()
      await new Promise((resolve) => setImmediate(resolve))
      return render()
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.()
    },
  }
}

const config = {
  defaultSort: 'name',
  sortableFields: [{ key: 'name' }],
  filterFields: [{ key: 'name', operators: ['eq'] }],
}

test('list search restores URL state, preserves other tabs, and avoids unrelated refetches', async () => {
  let params = new URLSearchParams('q=old&tab=reports&visit_q=driver')
  let writes = 0
  const app = harness('src/components/data-list/useDataListState.ts', {
    'next/navigation': {
      usePathname: () => '/logs',
      useSearchParams: () => params,
    },
    window: {
      history: {
        replaceState(_, __, url) {
          writes++
          params = new URLSearchParams(url.split('?')[1])
        },
      },
    },
  })
  let state = app.start((module) => module.useDataListState(config))
  const originalFilters = state.filters
  params = new URLSearchParams('q=restored&tab=reports&visit_q=driver')
  state = app.render()
  assert.equal(state.searchInput, 'restored')
  await app.flush()
  assert.equal(
    writes,
    0,
    'Back navigation must not be overwritten by an old draft',
  )
  assert.equal(
    state.filters,
    originalFilters,
    'unchanged filters retain their identity',
  )
  state.setSearchInput('  equipment  ')
  app.render()
  state = await app.flush()
  assert.equal(params.get('q'), 'equipment')
  state.clear()
  app.render()
  assert.equal(params.get('tab'), 'reports')
  assert.equal(params.get('visit_q'), 'driver')
  assert.equal(params.get('q'), null)
  app.unmount()
})

test('malformed filter values and fractional/infinite page values are rejected', () => {
  for (const page of ['Infinity', '-1', '1.5']) {
    const params = new URLSearchParams({
      page,
      filters: JSON.stringify([
        { id: 'bad', field: 'name', operator: 'eq', value: {} },
        { id: 'good', field: 'name', operator: 'eq', value: 'valid' },
      ]),
    })
    const app = harness('src/components/data-list/useDataListState.ts', {
      'next/navigation': {
        usePathname: () => '/logs',
        useSearchParams: () => params,
      },
    })
    const state = app.start((module) => module.useDataListState(config))
    assert.equal(state.page, 1)
    assert.equal(state.filters.length, 1)
    assert.equal(state.filters[0].id, 'good')
    app.unmount()
  }
})

test('new list requests abort earlier work and unmount aborts remaining work', () => {
  const app = harness('src/components/data-list/useListRequest.ts')
  const start = app.start((module) => module.useListRequest())
  const first = start()
  const second = start()
  assert.equal(first.aborted, true)
  assert.equal(second.aborted, false)
  app.unmount()
  assert.equal(second.aborted, true)
})

test('auth initializes once, ignores duplicate events, and rejects stale account results', async () => {
  let notify
  let queries = 0
  const pending = []
  const supabase = {
    auth: {
      onAuthStateChange(fn) {
        notify = fn
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from() {
      queries++
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle() {
          return new Promise((resolve) => pending.push(resolve))
        },
      }
    },
  }
  const app = harness('src/auth/AuthContext.tsx', {
    '@/lib/supabase': { supabase },
  })
  const session = (id) => ({ user: { id } })
  app.start((module) => module.AuthProvider({ children: null }).value)
  notify('INITIAL_SESSION', session('first'))
  notify('SIGNED_IN', session('first'))
  assert.equal(queries, 0, 'profile queries must leave the auth callback first')
  await app.flush()
  assert.equal(queries, 1)
  notify('SIGNED_OUT', null)
  notify('SIGNED_IN', session('second'))
  await app.flush()
  pending[0]({ data: { id: 'first' }, error: null })
  await app.flush()
  assert.equal(app.render().profile, null)
  pending[1]({ data: { id: 'second' }, error: null })
  let state = await app.flush()
  assert.equal(state.profile.id, 'second')
  notify('TOKEN_REFRESHED', session('second'))
  state = await app.flush()
  assert.equal(queries, 2)
  assert.equal(state.loading, false)
  app.unmount()
})

function photoStagingHarness() {
  const uploaded = []
  const discarded = []
  const revoked = []
  let batchCounter = 0
  const app = harness('src/components/useMovementPhotoStaging.ts', {
    URL: {
      createObjectURL: (file) => `blob:${file.name}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    '@/lib/supabase': {
      supabase: {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'token' } },
          }),
        },
      },
    },
    '@/lib/movementPhotoCompression': {
      prepareMovementPhotos: async (files) => files,
    },
    '@/lib/movementPhotoUpload': {
      discardPendingMovementPhotoBatch: async (batchId) =>
        discarded.push(batchId),
      async uploadPendingMovementPhoto(file, _token, onProgress) {
        uploaded.push(file.name)
        onProgress(100)
        if (file.name === 'fails.jpg') throw new Error('photo_transfer_failed')
        batchCounter += 1
        const batchId = `batch-${batchCounter}`
        return { batchId, paths: [`user/${batchId}/${file.name}`] }
      },
    },
  })
  return { app, uploaded, discarded, revoked }
}

const photo = (name) => ({ name, type: 'image/jpeg', size: 1024 })

// Values built inside the sandbox realm need a local copy before deep compare.
const plain = (value) => Array.from(value)

test('adding a photo never re-uploads the photos already staged', async () => {
  const errors = []
  const { app, uploaded, discarded } = photoStagingHarness()
  let staging = app.start((module) =>
    module.useMovementPhotoStaging({ onError: (error) => errors.push(error) }),
  )

  staging.addPhotos([photo('first.jpg')])
  staging = await app.flush()
  assert.deepEqual(uploaded, ['first.jpg'])
  assert.deepEqual(plain(staging.uploadBatchIds()), ['batch-1'])

  staging.addPhotos([photo('second.jpg')])
  staging = await app.flush()
  assert.deepEqual(
    uploaded,
    ['first.jpg', 'second.jpg'],
    'the already uploaded photo must not be uploaded again',
  )
  assert.deepEqual(
    discarded,
    [],
    'a finished upload must not be discarded when another photo is added',
  )
  assert.deepEqual(
    plain(
      staging.photos.map((item) => [item.name, item.status, item.progress]),
    ),
    [
      ['first.jpg', 'uploaded', 100],
      ['second.jpg', 'uploaded', 100],
    ],
  )
  assert.deepEqual(plain(staging.uploadBatchIds()), ['batch-1', 'batch-2'])
  assert.equal(staging.ready, true)
  assert.equal(staging.uploading, false)
  app.unmount()
})

test('removing a staged photo discards only that photo', async () => {
  const { app, uploaded, discarded, revoked } = photoStagingHarness()
  let staging = app.start((module) =>
    module.useMovementPhotoStaging({ onError: () => {} }),
  )
  staging.addPhotos([photo('first.jpg'), photo('second.jpg')])
  staging = await app.flush()
  assert.deepEqual(plain(staging.uploadBatchIds()), ['batch-1', 'batch-2'])

  staging.removePhoto(0)
  staging = await app.flush()
  assert.deepEqual(discarded, ['batch-1'])
  assert.deepEqual(revoked, ['blob:first.jpg'])
  assert.deepEqual(plain(staging.photos.map((item) => item.name)), [
    'second.jpg',
  ])
  assert.deepEqual(plain(staging.uploadBatchIds()), ['batch-2'])
  assert.deepEqual(uploaded, ['first.jpg', 'second.jpg'])
  app.unmount()
})

test('retry re-uploads only the failed photo and keeps the limits', async () => {
  const errors = []
  const { app, uploaded, discarded } = photoStagingHarness()
  let staging = app.start((module) =>
    module.useMovementPhotoStaging({ onError: (error) => errors.push(error) }),
  )
  staging.addPhotos([photo('first.jpg'), photo('fails.jpg')])
  staging = await app.flush()
  assert.deepEqual(plain(staging.photos.map((item) => item.status)), [
    'uploaded',
    'error',
  ])
  assert.equal(staging.hasFailedUploads, true)
  assert.equal(staging.ready, false)
  assert.ok(errors.includes('upload_failed'))

  staging.retryFailedUploads()
  staging = await app.flush()
  assert.deepEqual(
    uploaded,
    ['first.jpg', 'fails.jpg', 'fails.jpg'],
    'retry must not touch the photo that already uploaded',
  )
  assert.deepEqual(discarded, [])
  assert.deepEqual(plain(staging.uploadBatchIds()), ['batch-1'])

  staging.addPhotos([photo('third.jpg'), photo('fourth.jpg')])
  staging = await app.flush()
  assert.equal(staging.photos.length, 3, 'at most three photos are staged')

  errors.length = 0
  staging.addPhotos([{ name: 'doc.pdf', type: 'application/pdf', size: 10 }])
  assert.deepEqual(errors, [], 'a full selection is ignored before validation')
  app.unmount()
})

test('oversized and unsupported photos are rejected before any upload', async () => {
  const errors = []
  const { app, uploaded } = photoStagingHarness()
  const staging = app.start((module) =>
    module.useMovementPhotoStaging({ onError: (error) => errors.push(error) }),
  )
  staging.addPhotos([{ name: 'doc.pdf', type: 'application/pdf', size: 10 }])
  staging.addPhotos([
    { name: 'huge.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 },
  ])
  await app.flush()
  assert.deepEqual(errors, ['invalid_type', 'too_large'])
  assert.deepEqual(uploaded, [])
  assert.equal(app.render().photos.length, 0)
  app.unmount()
})
