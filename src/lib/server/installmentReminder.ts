// SERVER ONLY. The daily WhatsApp reminder of installment due dates
// (migration 0205), run by the Vercel Cron route
// `app/api/cron/installment-reminder`.
//
// A cron call has no signed-in user. The route reaches the database with the
// public anon key and passes the cron secret to the two functions of 0205,
// which refuse anything else (they compare its SHA-256 with the stored hash).
// No service role key is used.
//
// Logging rule: a fixed label, a log id and a short code only. Never a phone
// number, a message text, the secret or a raw error.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  buildInstallmentReminderMessage,
  parseInstallmentReminder,
} from '@/lib/installmentReminder'
import { sendWhatsAppText } from '@/lib/server/ultramsg'
import { normalizeWhatsAppNumber } from '@/lib/whatsappNumber'

export type InstallmentReminderOutcome =
  'sent' | 'failed' | 'no_mobile' | 'not_configured'

export interface InstallmentReminderRunSummary {
  ok: boolean
  /** Set when the run stopped before sending anything. */
  error?: 'not_configured' | 'key_invalid' | 'prepare_failed' | 'server_misconfigured'
  day?: string
  /** Unpaid installment rows in today's reminder. */
  items?: number
  /** Recipients claimed for today (0 with nothing to say or already sent). */
  recipients?: number
  /** Recipients whose reminder of today was already sent or is in progress. */
  skipped?: number
  sent?: number
  failed?: number
  noMobile?: number
  notConfigured?: number
}

function anonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function complete(
  supabase: SupabaseClient,
  secret: string,
  logId: string,
  status: InstallmentReminderOutcome,
  providerMessageId: string | null,
  errorCode: string | null,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('complete_installment_reminder', {
      p_key: secret,
      p_log_id: logId,
      p_status: status,
      p_provider_message_id: providerMessageId,
      p_error_code: errorCode,
    })
    if (error) {
      console.error('Installment reminder completion failed', {
        logId,
        code: 'complete_failed',
      })
    }
  } catch {
    console.error('Installment reminder completion failed', {
      logId,
      code: 'complete_threw',
    })
  }
}

/**
 * Prepares today's reminder, sends it to every claimed recipient and records
 * each outcome. Never throws.
 */
export async function runInstallmentReminder(
  secret: string,
): Promise<InstallmentReminderRunSummary> {
  try {
    const supabase = anonClient()
    if (!supabase) return { ok: false, error: 'server_misconfigured' }

    const { data, error } = await supabase.rpc('prepare_installment_reminder', {
      p_key: secret,
    })
    if (error) {
      const message = typeof error.message === 'string' ? error.message : ''
      if (message.includes('reminder_not_configured')) {
        return { ok: false, error: 'not_configured' }
      }
      if (message.includes('reminder_key_invalid')) {
        return { ok: false, error: 'key_invalid' }
      }
      console.error('Installment reminder skipped', { code: 'prepare_failed' })
      return { ok: false, error: 'prepare_failed' }
    }

    const payload = parseInstallmentReminder(data)
    if (!payload) {
      console.error('Installment reminder skipped', { code: 'bad_payload' })
      return { ok: false, error: 'prepare_failed' }
    }

    const summary: InstallmentReminderRunSummary = {
      ok: true,
      day: payload.day,
      items: payload.items.length,
      recipients: payload.recipients.length,
      skipped: payload.skipped,
      sent: 0,
      failed: 0,
      noMobile: 0,
      notConfigured: 0,
    }
    if (payload.recipients.length === 0) return summary

    const message = buildInstallmentReminderMessage({
      day: payload.day,
      items: payload.items,
    })

    for (const recipient of payload.recipients) {
      // Claimed only when there are items, so a message exists; kept safe.
      const to = normalizeWhatsAppNumber(recipient.mobile)
      if (!message || !to) {
        await complete(supabase, secret, recipient.logId, 'no_mobile', null, null)
        summary.noMobile = (summary.noMobile ?? 0) + 1
        continue
      }
      const result = await sendWhatsAppText(to, message)
      if (result.status === 'sent') {
        await complete(
          supabase,
          secret,
          recipient.logId,
          'sent',
          result.providerMessageId ?? null,
          null,
        )
        summary.sent = (summary.sent ?? 0) + 1
      } else if (result.status === 'not_configured') {
        await complete(supabase, secret, recipient.logId, 'not_configured', null, null)
        summary.notConfigured = (summary.notConfigured ?? 0) + 1
      } else {
        await complete(
          supabase,
          secret,
          recipient.logId,
          'failed',
          null,
          result.errorCode,
        )
        console.error('Installment reminder send failed', {
          logId: recipient.logId,
          code: result.errorCode,
        })
        summary.failed = (summary.failed ?? 0) + 1
      }
    }
    return summary
  } catch {
    console.error('Installment reminder skipped', { code: 'run_threw' })
    return { ok: false, error: 'prepare_failed' }
  }
}
