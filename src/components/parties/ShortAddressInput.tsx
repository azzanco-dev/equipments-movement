import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from '@/components/ui'
import { CHANGED_CONTROL_CLASS } from '@/components/parties/changedField'
import {
  SHORT_ADDRESS_CELLS,
  SHORT_ADDRESS_LETTERS,
  fillShortAddressCells,
  normalizeShortAddress,
  shortAddressCellChar,
} from '@/lib/partyFields'

export interface ShortAddressInputProps {
  value: string
  onChange: (value: string) => void
  /** Set by `Field`; goes on the first box so the label focuses it. */
  id?: string
  /** Marks the field invalid; `Field` sets it automatically. */
  invalid?: boolean
  /** Changed and not saved yet: the boxes take the changed colour. */
  changed?: boolean
  'aria-describedby'?: string
}

/** The example shown in the empty boxes, one character each (owner
 *  2026-11-05, «اضف placeholder للعنوان الوطني المختصر»). */
export const SHORT_ADDRESS_EXAMPLE = 'RRRD2929'

/** The stored code as the eight boxes' characters. */
function cellsOf(value: string): string[] {
  return fillShortAddressCells(
    Array<string>(SHORT_ADDRESS_CELLS).fill(''),
    0,
    value,
  ).cells
}

/**
 * The short national address (migration 0179). Owner 2026-11-05: «حقل يكون
 * مقسم», then a one-time-code look sent as a picture («ابغاك يكون حاجة زي
 * كذا»): eight boxes of one character each, read left to right like the
 * code — 4 Latin letters, a small gap, 4 digits («R R R D – 2 9 2 9»).
 *
 * A box takes only its own kind of character (letters upper-cased,
 * Arabic-Indic digits made Latin) and moves on to the next box; Backspace
 * in an empty box clears the one before it; the arrow keys move between
 * boxes; a pasted or auto-filled code fills the boxes from the start
 * («rrrd-2929»). The value sent up is the joined code, as the trigger
 * stores it.
 */
export function ShortAddressInput({
  value,
  onChange,
  id,
  invalid,
  changed = false,
  'aria-describedby': describedBy,
}: ShortAddressInputProps) {
  const { t } = useI18n()
  const [cells, setCells] = useState(() => cellsOf(value))
  const refs = useRef<(HTMLInputElement | null)[]>([])

  // A value set from outside (the dialog opening on a record) refills the
  // boxes; typing keeps them as they are.
  useEffect(() => {
    if (normalizeShortAddress(value) !== cells.join(''))
      setCells(cellsOf(value))
  }, [value, cells])

  const focus = (index: number) => {
    const box = refs.current[index]
    box?.focus()
    box?.select()
  }

  const commit = (next: string[]) => {
    setCells(next)
    onChange(next.join(''))
  }

  const type = (index: number, raw: string) => {
    if (!raw) {
      const next = [...cells]
      next[index] = ''
      commit(next)
      return
    }
    // One key is one character; more is the phone's auto-fill or a paste.
    if (normalizeShortAddress(raw).length > 1) {
      const filled = fillShortAddressCells(cells, index, raw)
      commit(filled.cells)
      focus(filled.next)
      return
    }
    const char = shortAddressCellChar(index, raw)
    if (!char) return
    const next = [...cells]
    next[index] = char
    commit(next)
    if (index < SHORT_ADDRESS_CELLS - 1) focus(index + 1)
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !cells[index] && index > 0) {
      event.preventDefault()
      const next = [...cells]
      next[index - 1] = ''
      commit(next)
      focus(index - 1)
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      focus(index - 1)
    } else if (event.key === 'ArrowRight' && index < SHORT_ADDRESS_CELLS - 1) {
      event.preventDefault()
      focus(index + 1)
    }
  }

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const filled = fillShortAddressCells(
      cells,
      index,
      event.clipboardData.getData('text'),
    )
    commit(filled.cells)
    focus(filled.next)
  }

  return (
    <div
      dir="ltr"
      role="group"
      aria-label={t('shortAddress')}
      aria-describedby={describedBy}
      className="flex items-center justify-start gap-1.5 rtl:justify-end"
    >
      {cells.map((char, index) => {
        const letter = index < SHORT_ADDRESS_LETTERS
        return (
          <Fragment key={index}>
            {index === SHORT_ADDRESS_LETTERS && (
              <span
                aria-hidden="true"
                className="w-2 shrink-0 text-center text-muted"
              >
                –
              </span>
            )}
            <input
              ref={(element) => {
                refs.current[index] = element
              }}
              id={index === 0 ? id : undefined}
              aria-label={t(
                letter ? 'shortAddressLetterBox' : 'shortAddressDigitBox',
              ).replace(
                '{n}',
                String(letter ? index + 1 : index - SHORT_ADDRESS_LETTERS + 1),
              )}
              aria-invalid={invalid || undefined}
              autoComplete="off"
              autoCapitalize={letter ? 'characters' : undefined}
              spellCheck={false}
              inputMode={letter ? 'text' : 'numeric'}
              placeholder={SHORT_ADDRESS_EXAMPLE[index]}
              value={char}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                // The box holds one character: a key typed beside it
                // replaces it; a longer text is an auto-fill, kept whole.
                const raw = event.target.value
                type(index, raw.length > 2 ? raw : raw.replace(char, '') || raw)
              }}
              onKeyDown={(event) => onKeyDown(index, event)}
              onPaste={(event) => onPaste(index, event)}
              className={cn(
                'input h-11 w-full min-w-0 max-w-10 flex-1 px-0 text-center text-base font-medium tabular-nums placeholder:text-placeholder md:h-10',
                changed && CHANGED_CONTROL_CLASS,
              )}
            />
          </Fragment>
        )
      })}
    </div>
  )
}
