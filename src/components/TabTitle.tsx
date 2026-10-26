import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

// The record a page names in the browser tab's title (owner 2026-10-25):
// App composes the title from the page (src/lib/pageTitle.ts) and this
// record, which a detail page or a record dialog sets once loaded.

interface TabTitleRecord {
  record: string | null
  setRecord: (value: string | null) => void
}

const TabTitleContext = createContext<TabTitleRecord | null>(null)

export function TabTitleProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<string | null>(null)
  const value = useMemo(() => ({ record, setRecord }), [record])
  return (
    <TabTitleContext.Provider value={value}>
      {children}
    </TabTitleContext.Provider>
  )
}

/** The record named in the tab title, or null. */
export function useTabTitleRecord(): string | null {
  return useContext(TabTitleContext)?.record ?? null
}

/**
 * Names the shown record in the tab title (a code, a PO number, a name);
 * null or empty while it loads. Cleared when the page or dialog goes away.
 */
export function useTabTitle(record: string | null | undefined) {
  const setRecord = useContext(TabTitleContext)?.setRecord
  const value = record?.trim() || null
  useEffect(() => {
    if (!setRecord) return
    setRecord(value)
    return () => setRecord(null)
  }, [setRecord, value])
}
