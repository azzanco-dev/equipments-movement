// SERVER ONLY. Orchestrates one WhatsApp movement notice (migration 0110):
// build the fixed text, send it through the gateway, record the outcome.
//
// Shared by `POST /api/notifications/workshop-arrival` (manual notice) and the
// movement creation route (automatic notices after an EXIT). Every call uses
// the signed-in user's Supabase client, so the database functions stay
// authoritative: they resolve the recipient and re-check the caller.
//
// Logging rule: only a fixed label, the notice or movement id and a short
// code. Never a phone number, a message text, a token or a raw error.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isMovementNoticeKind,
  movementNoticeMessage,
  type MovementNoticeKind,
} from '@/lib/movementNoticeMessages'
import { normalizeWhatsAppNumber, waMeUrl } from '@/lib/whatsappNumber'
import { sendWhatsAppText } from '@/lib/server/ultramsg'

export type MovementNoticeStatus =
  'sent' | 'failed' | 'not_configured' | 'no_mobile'

/** One row of `request_workshop_arrival_notice` / `prepare_movement_exit_notice`. */
export interface MovementNoticeRow {
  noticeId: string
  kind: MovementNoticeKind
  recipientName: string
  recipientMobile: string | null
  equipmentCode: string
  equipmentType: string | null
  projectNameAr: string | null
  projectNameEn: string | null
  companyNameAr: string | null
  companyNameEn: string | null
  senderName: string | null
}

export interface MovementNoticeDelivery {
  status: MovementNoticeStatus
  recipientName: string
  /** `wa.me` link with the same text, when a usable number exists and the send did not succeed. */
  fallbackUrl: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Reads the first row of the RPC result; `null` when there is nothing to send. */
export function parseMovementNoticeRow(
  data: unknown,
): MovementNoticeRow | null {
  const row: unknown = Array.isArray(data) ? data[0] : data
  if (typeof row !== 'object' || row === null) return null
  const record = row as Record<string, unknown>
  const noticeId = text(record.notice_id)
  if (!noticeId || !isMovementNoticeKind(record.notice_kind)) return null
  return {
    noticeId,
    kind: record.notice_kind,
    recipientName: text(record.recipient_name) ?? '',
    recipientMobile: text(record.recipient_mobile),
    equipmentCode: text(record.equipment_code) ?? '',
    equipmentType: text(record.equipment_type),
    projectNameAr: text(record.project_name_ar),
    projectNameEn: text(record.project_name_en),
    companyNameAr: text(record.company_name_ar),
    companyNameEn: text(record.company_name_en),
    senderName: text(record.sender_name),
  }
}

async function completeNotice(
  supabase: SupabaseClient,
  noticeId: string,
  status: MovementNoticeStatus,
  providerMessageId: string | null,
  errorCode: string | null,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('complete_movement_notice', {
      p_notice_id: noticeId,
      p_status: status,
      p_provider_message_id: providerMessageId,
      p_error_code: errorCode,
    })
    if (error) {
      console.error('Movement notice completion failed', {
        noticeId,
        code: 'complete_failed',
      })
    }
  } catch {
    console.error('Movement notice completion failed', {
      noticeId,
      code: 'complete_threw',
    })
  }
}

/**
 * Sends one prepared notice and records the outcome. Never throws.
 *
 * The notice row already exists as `pending`. When recording the outcome
 * fails, the row stays `pending`, which still blocks a repeat for 10 minutes.
 */
export async function deliverMovementNotice(
  supabase: SupabaseClient,
  row: MovementNoticeRow,
): Promise<MovementNoticeDelivery> {
  const recipientName = row.recipientName
  try {
    const message = movementNoticeMessage(row.kind, {
      equipmentCode: row.equipmentCode,
      equipmentType: row.equipmentType,
      projectNameAr: row.projectNameAr,
      projectNameEn: row.projectNameEn,
      companyNameAr: row.companyNameAr,
      companyNameEn: row.companyNameEn,
      senderName: row.senderName,
    })
    const to = normalizeWhatsAppNumber(row.recipientMobile)
    if (!to) {
      await completeNotice(supabase, row.noticeId, 'no_mobile', null, null)
      return { status: 'no_mobile', recipientName, fallbackUrl: null }
    }

    const result = await sendWhatsAppText(to, message)
    if (result.status === 'sent') {
      await completeNotice(
        supabase,
        row.noticeId,
        'sent',
        result.providerMessageId ?? null,
        null,
      )
      return { status: 'sent', recipientName, fallbackUrl: null }
    }

    const errorCode = result.status === 'failed' ? result.errorCode : null
    console.error('Movement notice not sent', {
      noticeId: row.noticeId,
      code: errorCode ?? result.status,
    })
    await completeNotice(supabase, row.noticeId, result.status, null, errorCode)
    return {
      status: result.status,
      recipientName,
      fallbackUrl: waMeUrl(to, message),
    }
  } catch {
    console.error('Movement notice not sent', {
      noticeId: row.noticeId,
      code: 'deliver_threw',
    })
    await completeNotice(
      supabase,
      row.noticeId,
      'failed',
      null,
      'deliver_threw',
    )
    return { status: 'failed', recipientName, fallbackUrl: null }
  }
}

/**
 * The automatic notice after an EXIT was saved (site exit -> the workshop
 * officer who reported the unit; workshop exit -> the foreman the unit left
 * from). The database decides whether there is anything to send and to whom.
 *
 * Runs after the movement response was sent. It never throws: a notice that
 * cannot be prepared or sent must never affect the saved movement.
 */
export async function sendMovementExitNotice(
  supabase: SupabaseClient,
  movementId: string,
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('prepare_movement_exit_notice', {
      p_movement_id: movementId,
    })
    if (error) {
      console.error('Movement exit notice skipped', {
        movementId,
        code: 'prepare_failed',
      })
      return
    }
    const row = parseMovementNoticeRow(data)
    if (!row) return
    await deliverMovementNotice(supabase, row)
  } catch {
    console.error('Movement exit notice skipped', {
      movementId,
      code: 'prepare_threw',
    })
  }
}
