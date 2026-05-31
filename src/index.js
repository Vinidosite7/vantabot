import 'dotenv/config'
import { Telegraf, Markup }  from 'telegraf'
import express               from 'express'
import cron                  from 'node-cron'
import { config, supabase }  from './config.js'
import { gerarPix }          from './gateway.js'
import { liberarAcesso, removerExpirados } from './acesso.js'

// ─── Instâncias ───────────────────────────────────────────────
const bot = new Telegraf(config.botToken)
const app = express()
app.use(express.json())

// ─── Helpers ─────────────────────────────────────────────────
function parseUtm(startPayload) {
  // /start utm_source=tiktok_ads&utm_campaign=criat01
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

  if (error) throw new Error(`upsert lead: ${error.message}`)
  return data
}

function menuPlanos() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('7 dias — R$ 27,90',  'plano:7dias')],
    [Markup.button.callback('30 dias — R$ 67,90', 'plano:30dias')],
  ])
}

// ─── /start ──────────────────────────────────────────────────
bot.start(async (ctx) => {
  const utmData = parseUtm(ctx.startPayload)
  const lead    = await upsertLead(ctx, utmData)

  await ctx.reply(
    `Olá, ${ctx.from.first_name}! 👋\n\n` +
    `Bem-vindo ao *Grupo VIP*.\n\n` +
    `Aqui você recebe:\n` +
    `✅ Conteúdo exclusivo todo dia\n` +
    `✅ Acesso antecipado\n` +
    `✅ Suporte direto\n\n` +
    `Escolha seu plano abaixo 👇`,
    { parse_mode: 'Markdown', ...menuPlanos() }
  )
})

// ─── Seleção de plano ─────────────────────────────────────────
bot.action(/^plano:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery()

  const planoKey    = ctx.match[1]
  const planoConfig = config.planos[planoKey]

  if (!planoConfig) return ctx.reply('Plano inválido. Use /start para recomeçar.')

  // Busca ou cria o lead
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('telegram_id', ctx.from.id)
    .single()

  if (!lead) return ctx.reply('Sessão expirada. Digite /start para recomeçar.')

  // Verifica se já tem assinatura ativa
  const { data: subAtiva } = await supabase
    .from('subscriptions')
    .select('id, expires_at')
    .eq('lead_id', lead.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (subAtiva) {
    const exp = new Date(subAtiva.expires_at).toLocaleDateString('pt-BR')
    return ctx.reply(`✅ Você já tem acesso ativo até *${exp}*!`, { parse_mode: 'Markdown' })
  }

  await ctx.reply('⏳ Gerando seu PIX...')

  // Cria transaction pendente
  const { data: transaction } = await supabase
    .from('transactions')
    .insert({
      lead_id:  lead.id,
      valor:    planoConfig.valor,
      plano:    planoKey,
      status:   'pending',
    })
    .select('id')
    .single()

  // Gera PIX no gateway
  const webhookUrl = `${process.env.APP_URL}/webhook/pix?secret=${config.webhookSecret}`
  const pix = await gerarPix({
    valor:       planoConfig.valor,
    descricao:   `Acesso VIP ${planoConfig.label}`,
    webhookUrl,
    externalId:  transaction.id,
  })

  // Atualiza transaction com dados do PIX
  await supabase
    .from('transactions')
    .update({
      gateway_id:    pix.gatewayId,
      pix_copia_cola: pix.pixCopiaECola,
      expires_at:    pix.expiresAt.toISOString(),
    })
    .eq('id', transaction.id)

  // Envia PIX pro usuário
  await ctx.reply(
    `💳 *PIX gerado — ${planoConfig.label} por R$ ${planoConfig.valor.toFixed(2).replace('.', ',')}*\n\n` +
    `Copie o código abaixo e pague no seu banco:\n\n` +
    `\`${pix.pixCopiaECola}\`\n\n` +
    `⏰ Válido por 30 minutos.\n` +
    `✅ O acesso é liberado automaticamente após o pagamento.`,
    { parse_mode: 'Markdown' }
  )
})

// ─── /renovar ────────────────────────────────────────────────
bot.command('renovar', async (ctx) => {
  await ctx.reply(
    'Escolha o plano para renovar 👇',
    menuPlanos()
  )
})

// ─── /status ─────────────────────────────────────────────────
bot.command('status', async (ctx) => {
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('telegram_id', ctx.from.id)
    .single()

  if (!lead) return ctx.reply('Você ainda não tem cadastro. Digite /start.')

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plano, status, expires_at')
    .eq('lead_id', lead.id)
    .eq('status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sub) return ctx.reply('Você não tem assinatura ativa.\n\nDigite /start para assinar.')

  const exp = new Date(sub.expires_at).toLocaleDateString('pt-BR')
  await ctx.reply(
    `✅ *Assinatura ativa*\n\nPlano: ${sub.plano}\nVálida até: *${exp}*`,
    { parse_mode: 'Markdown' }
  )
})

// ─── Webhook PIX (confirmação de pagamento) ───────────────────
app.post('/webhook/pix', async (req, res) => {
  // Valida secret query param
  if (req.query.secret !== config.webhookSecret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const body = req.body

  // PushinPay envia status 'paid' quando confirmado
  // Ajuste o campo conforme o gateway escolhido
  const gatewayId = body.id ?? body.payment_id
  const status    = body.status

  if (status !== 'paid') return res.json({ ok: true }) // ignora outros eventos

  // Busca a transaction pelo gateway_id
  const { data: transaction } = await supabase
    .from('transactions')
    .select('id, lead_id, plano, status')
    .eq('gateway_id', gatewayId)
    .single()

  if (!transaction) {
    console.warn('[webhook] transaction não encontrada:', gatewayId)
    return res.json({ ok: true })
  }

  if (transaction.status === 'paid') {
    return res.json({ ok: true }) // idempotência — já processado
  }

  // Marca transaction como paga
  await supabase
    .from('transactions')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', transaction.id)

  // Libera acesso ao grupo
  const { data: lead } = await supabase
    .from('leads')
    .select('telegram_id')
    .eq('id', transaction.lead_id)
    .single()

  const { inviteLink, expiresAt } = await liberarAcesso({
    bot,
    leadId:        transaction.lead_id,
    telegramId:    lead.telegram_id,
    transactionId: transaction.id,
    plano:         transaction.plano,
  })

  const exp = expiresAt.toLocaleDateString('pt-BR')

  // Notifica o lead
  await bot.telegram.sendMessage(
    lead.telegram_id,
    `✅ *Pagamento confirmado!*\n\n` +
    `Seu acesso está liberado até *${exp}*.\n\n` +
    `👇 Clique no link abaixo para entrar no grupo VIP:`,
    { parse_mode: 'Markdown' }
  )
  await bot.telegram.sendMessage(lead.telegram_id, inviteLink)

  console.log(`[webhook] acesso liberado — lead ${lead.telegram_id}, plano ${transaction.plano}`)
  res.json({ ok: true })
})

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// ─── Cron — remove assinaturas expiradas (a cada hora) ────────
cron.schedule('0 * * * *', async () => {
  console.log('[cron] verificando assinaturas expiradas...')
  await removerExpirados(bot)
})

// ─── Start ────────────────────────────────────────────────────
async function main() {
  await new Promise((resolve) => {
    app.listen(config.port, () => {
      console.log(`[server] rodando na porta ${config.port}`)
      resolve()
    })
  })

  // Modo webhook (produção Railway)
  if (process.env.APP_URL) {
    const webhookPath = `/telegram/${config.botToken}`
    await bot.telegram.setWebhook(`${process.env.APP_URL}${webhookPath}`)
    app.use(webhookPath, bot.webhookCallback(webhookPath))
    console.log('[bot] webhook configurado:', process.env.APP_URL + webhookPath)
  } else {
    // Modo polling (desenvolvimento local)
    bot.launch()
    console.log('[bot] rodando em modo polling (dev)')
  }

  // Graceful shutdown
  process.once('SIGINT',  () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

main().catch(console.error)
