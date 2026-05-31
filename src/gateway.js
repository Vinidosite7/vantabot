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
      name:     'Cliente',
      email:    'cliente@bot.com',
      document: '00000000000',
    },
    callbackUrl: webhookUrl,
  })

  return {
    gatewayId:     data.transaction?.id ?? data.transactionId,
    pixCopiaECola: data.pix?.copiaECola ?? data.pix?.code ?? data.pix?.qrCode,
    qrBase64:      data.pix?.qrCodeImage ?? null,
    expiresAt:     new Date(Date.now() + 30 * 60 * 1000),
  }
}