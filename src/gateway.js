import axios from 'axios'

const api = axios.create({
  baseURL: 'https://app.omegapayments.com.br/api/v1',
  headers: {
    'x-public-key': process.env.OMEGAPAY_PUBLIC_KEY,
    'x-secret-key': process.env.OMEGAPAY_SECRET_KEY,
    'Content-Type': 'application/json',
  },
})

export async function gerarPix({ valor, descricao, webhookUrl, externalId }) {
  const { data } = await api.post('/gateway/pix/receive', {
    identifier:  externalId,
    amount:      valor,
    client: {
      name:     'Cliente VIP',
      email:    'cliente@vantabot.com',
      document: '12345678909',
    },
    callbackUrl: 'https://vantabot-7wmy.onrender.com/webhook/pix',
  })

  return {
    gatewayId:     data.transaction?.id ?? data.transactionId ?? data.id,
    pixCopiaECola: data.pix?.copiaECola ?? data.pix?.code ?? data.pix?.qrCode ?? data.pixCode,
    qrBase64:      data.pix?.qrCodeImage ?? null,
    expiresAt:     new Date(Date.now() + 30 * 60 * 1000),
  }
}