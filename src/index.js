import 'dotenv/config'
import { Telegraf, Markup }  from 'telegraf'
import express               from 'express'
import cron                  from 'node-cron'
import { config, supabase }  from './config.js'
import { gerarPix }          from './gateway.js'
import { liberarAcesso, removerExpirados } from './acesso.js'
 
const bot = new Telegraf(config.botToken)
const app = express()
app.use(express.json())
 
function parseUtm(startPayload) {
  if (!startPayload) return {}
  try {
    const params = new URLSearchParams(startPayload.replace(/_/g, '&'))
    return {
      utm_source:   params.get('utm_source')   ?? null,
      utm_campaign: params.get('utm_campaign') ?? null,
      utm_content:  params.get('utm_content')  ?? null,
    }
  } catch { return {} }
}
 
async function upsertLead(ctx, utmData) {
  const tgUser = ctx.from
  const { data, error } = await supabase
    .from('leads')
    .upsert(
      {
        telegram_id:  tgUser.id,
        nome:         tgUser.first_name,
        username:     tgUser.username ?? null,
        ...utmData,
      },
      { onConflict: 'telegram_id', ignoreDuplicates: false }
    )
    .select('id')
    .single()
  if (error) throw new Error('upsert lead: ' + error.message)
  return data
}
 
function menuPlanos() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('7 dias — R$ 27,90',  'plano:7dias')],
    [Markup.button.callback('30 dias — R$ 67,90', 'plano:30dias')],
  ])
}
 
bot.start(async (ctx) => {
  const utmData = parseUtm(ctx.startPayload)
  await upsertLead(ctx, utmData)
  await ctx.reply(
    'Olá, ' + ctx.from.first_name + '! 👋\n\n' +
    'Bem-vindo ao *Grupo VIP*.\n\n' +
    'Aqui você recebe:\n' +
    '✅ Conteúdo exclusivo todo dia\n' +
    '✅ Acesso antecipado\n' +
    '✅ Suporte direto\n\n' +
    'Escolha seu plano abaixo 👇',
    { parse_mode: 'Markdown', ...menuPlanos() }
  )
})
 
bot.action(/^plano:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const planoKey    = ctx.match[1]
  const planoConfig = config.planos[planoKey]
  if (!planoConfig) return ctx.reply('Plano inválido. Use /start para recomeçar.')
 
  const { data: lead } = await supabase
    .from('leads').select('id').eq('telegram_id', ctx.from.id).single()
  if (!lead) return ctx.reply('Sessão expirada. Digite /start para recomeçar.')
 
  const { data: subAtiva } = await supabase
    .from('subscriptions').select('id, expires_at')
    .eq('lead_id', lead.id).eq('status', 'active')
    .gt('expires_at', new Date().toISOString()).maybeSingle()
 
  if (subAtiva) {
    const exp = new Date(subAtiva.expires_at).toLocaleDateString('pt-BR')
    return ctx.reply('✅ Você já tem acesso ativo até *' + exp + '*!', { parse_mode: 'Markdown' })
  }
 
  await ctx.reply('⏳ Gerando seu PIX...')
 
  const { data: transaction } = await supabase
    .from('transactions')
    .insert({ lead_id: lead.id, valor: planoConfig.valor, plano: planoKey, status: 'pending' })
    .select('id').single()
 
  const webhookUrl = process.env.APP_URL
    ? process.env.APP_URL + '/webhook/pix?secret=' + config.webhookSecret
    : 'https://placeholder.dev/webhook'
 
  const pix = await gerarPix({
    valor:      planoConfig.valor,
    descricao:  'Acesso VIP ' + planoConfig.label,
    webhookUrl,
    externalId: transaction.id,
  })
 
  await supabase.from('transactions').update({
    gateway_id:     pix.gatewayId,
    pix_copia_cola: pix.pixCopiaECola,
    expires_at:     pix.expiresAt.toISOString(),
  }).eq('id', transaction.id)
 
  await ctx.reply(
    '💳 *PIX gerado — ' + planoConfig.label + ' por R$ ' + planoConfig.valor.toFixed(2).replace('.', ',') + '*\n\n' +
    'Copie o código abaixo e pague no seu banco:\n\n' +
    '`' + pix.pixCopiaECola + '`\n\n' +
    '⏰ Válido por 30 minutos.\n' +
    '✅ O acesso é liberado automaticamente após o pagamento.',
    { parse_mode: 'Markdown' }
  )
})
 
bot.command('renovar', async (ctx) => {
  await ctx.reply('Escolha o plano para renovar 👇', menuPlanos())
})
 
bot.command('status', async (ctx) => {
  const { data: lead } = await supabase
    .from('leads').select('id').eq('telegram_id', ctx.from.id).single()
  if (!lead) return ctx.reply('Você ainda não tem cadastro. Digite /start.')
 
  const { data: sub } = await supabase
    .from('subscriptions').select('plano, status, expires_at')
    .eq('lead_id', lead.id).eq('status', 'active')
    .order('expires_at', { ascending: false }).limit(1).maybeSingle()
 
  if (!sub) return ctx.reply('Você não tem assinatura ativa.\n\nDigite /start para assinar.')
  const exp = new Date(sub.expires_at).toLocaleDateString('pt-BR')
  await ctx.reply('✅ *Assinatura ativa*\n\nPlano: ' + sub.plano + '\nVálida até: *' + exp + '*', { parse_mode: 'Markdown' })
})
 
app.post('/webhook/pix', async (req, res) => {
  if (req.query.secret !== config.webhookSecret) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const body      = req.body
  const gatewayId = body.id ?? body.payment_id
  const status    = body.status
  if (status !== 'paid') return res.json({ ok: true })
 
  const { data: transaction } = await supabase
    .from('transactions').select('id, lead_id, plano, status')
    .eq('gateway_id', gatewayId).single()
 
  if (!transaction) {
    console.warn('[webhook] transaction não encontrada:', gatewayId)
    return res.json({ ok: true })
  }
  if (transaction.status === 'paid') return res.json({ ok: true })
 
  await supabase.from('transactions')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', transaction.id)
 
  const { data: lead } = await supabase
    .from('leads').select('telegram_id').eq('id', transaction.lead_id).single()
 
  const { inviteLink, expiresAt } = await liberarAcesso({
    bot, leadId: transaction.lead_id, telegramId: lead.telegram_id,
    transactionId: transaction.id, plano: transaction.plano,
  })
 
  const exp = expiresAt.toLocaleDateString('pt-BR')
  await bot.telegram.sendMessage(lead.telegram_id,
    '✅ *Pagamento confirmado!*\n\nSeu acesso está liberado até *' + exp + '*.\n\n👇 Clique no link abaixo para entrar no grupo VIP:',
    { parse_mode: 'Markdown' }
  )
  await bot.telegram.sendMessage(lead.telegram_id, inviteLink)
  console.log('[webhook] acesso liberado — lead ' + lead.telegram_id + ', plano ' + transaction.plano)
  res.json({ ok: true })
})
 
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))
 
cron.schedule('0 * * * *', async () => {
  console.log('[cron] verificando assinaturas expiradas...')
  await removerExpirados(bot)
})
 
async function main() {
  const PORT = Number(process.env.PORT) || 3000
 
  if (process.env.APP_URL) {
    const webhookPath = '/webhook/telegram'
    try {
      await bot.telegram.setWebhook(process.env.APP_URL + webhookPath)
      console.log('[bot] webhook configurado:', process.env.APP_URL + webhookPath)
    } catch(e) {
      console.error('[bot] erro ao setar webhook:', e.message)
    }
    app.post(webhookPath, (req, res) => {
      bot.handleUpdate(req.body, res)
    })
  } else {
    bot.launch()
    console.log('[bot] rodando em modo polling (dev)')
  }
 
  app.listen(PORT, '0.0.0.0', () => {
    console.log('[server] rodando na porta ' + PORT)
  })
 
  process.once('SIGINT',  () => { try { bot.stop('SIGINT')  } catch(e) {} })
  process.once('SIGTERM', () => { try { bot.stop('SIGTERM') } catch(e) {} })
}
 
main().catch(console.error)