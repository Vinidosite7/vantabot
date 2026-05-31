import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

export const config = {
  botToken:       process.env.BOT_TOKEN,
  grupoVipId:     process.env.GRUPO_VIP_ID,
  port: Number(process.env.PORT) || 3000,
  webhookSecret:  process.env.WEBHOOK_SECRET,
  pushinpayToken: process.env.PUSHINPAY_TOKEN,

  planos: {
    '7dias':  { label: '7 dias',  valor: 3.00, dias: 7  },
    '30dias': { label: '30 dias', valor: 7.90, dias: 30 },
  },
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service_role — bypassa RLS
)
