import type { Equipment } from './types'

export async function printEquipmentQr(
  equipment: Pick<Equipment, 'code' | 'type' | 'qr_value'>,
  onError: () => void,
): Promise<void> {
  // Open synchronously during the click so popup blockers can recognize it.
  const preview = window.open('', '_blank')
  if (!preview) {
    onError()
    return
  }
  preview.opener = null
  try {
    const { default: QRCode } = await import('qrcode')
    const source = await QRCode.toDataURL(equipment.qr_value, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
    if (preview.closed) return
    const doc = preview.document
    doc.title = `QR - ${equipment.code}`
    doc.documentElement.dir = document.documentElement.dir
    doc.body.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;font-family:system-ui,sans-serif;color:#000;background:#fff'
    const heading = doc.createElement('h2')
    heading.textContent = equipment.code
    const description = doc.createElement('p')
    description.textContent = equipment.type
    const image = doc.createElement('img')
    image.width = 256
    image.height = 256
    image.alt = equipment.code
    image.src = source
    const value = doc.createElement('p')
    value.textContent = equipment.qr_value
    value.style.cssText = 'font-size:12px;overflow-wrap:anywhere'
    doc.body.replaceChildren(heading, description, image, value)
    await image.decode()
    if (!preview.closed) {
      preview.focus()
      preview.print()
    }
  } catch {
    if (!preview.closed) preview.close()
    onError()
  }
}
