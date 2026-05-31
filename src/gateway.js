import axios from 'axios'
import { config } from './config.js'

const api = axios.create({
  baseURL: 'https://api.pushinpay.com.br/api',
  headers: {
    Authorization: `Bearer ${config.pushinpayToken}`,
    'Content-Type': 'application/json',
  },
})

export async function gerarPix({ valor, descricao, webhookUrl, externalId }) {
  const valorCentavos = Math.round(valor * 100)

  const urlFinal = webhookUrl && webhookUrl.startsWith('http')
    ? webhookUrl
    : 'https://placeholder.dev/webhook'

  const { data } = await api.post('/pix/cashIn', {
    value:       valorCentavos,
    webhook_url: urlFinal,
    split_rules: [],
    metadata: { external_id: externalId, descricao },
  })

  return {
    gatewayId:     data.id,
    pixCopiaECola: data.qr_code,
    qrBase64:      data.qr_code_base64 ?? null,
    expiresAt:     new Date(Date.now() + 30 * 60 * 1000),
  }
}