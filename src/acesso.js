import { supabase, config } from './config.js'

/**
 * Libera acesso do lead ao grupo VIP após pagamento confirmado
 */
export async function liberarAcesso({ bot, leadId, telegramId, transactionId, plano }) {
  const planoConfig = config.planos[plano]
  const expiresAt   = new Date(Date.now() + planoConfig.dias * 24 * 60 * 60 * 1000)

  // 1. Salva subscription no Supabase
  const { error } = await supabase.from('subscriptions').insert({
    lead_id:        leadId,
    transaction_id: transactionId,
    plano,
    status:         'active',
    group_id:       config.grupoVipId,
    expires_at:     expiresAt.toISOString(),
  })

  if (error) throw new Error(`Erro ao salvar subscription: ${error.message}`)

  // 2. Gera link de convite único (1 uso, expira em 1h)
  const invite = await bot.telegram.createChatInviteLink(config.grupoVipId, {
    member_limit:  1,
    expire_date:   Math.floor(Date.now() / 1000) + 3600,
    name:          `lead_${telegramId}`,
  })

  return { inviteLink: invite.invite_link, expiresAt }
}

/**
 * Remove membros com assinatura vencida do grupo
 * Chamado pelo cron job a cada hora
 */
export async function removerExpirados(bot) {
  const agora = new Date().toISOString()

  // Busca assinaturas ativas que já venceram
  const { data: expiradas, error } = await supabase
    .from('subscriptions')
    .select('id, lead_id, group_id, leads(telegram_id)')
    .eq('status', 'active')
    .lt('expires_at', agora)

  if (error) { console.error('[cron] erro ao buscar expiradas:', error); return }
  if (!expiradas?.length) return

  console.log(`[cron] removendo ${expiradas.length} assinatura(s) expirada(s)`)

  for (const sub of expiradas) {
    const telegramId = sub.leads?.telegram_id
    try {
      // Remove do grupo
      await bot.telegram.banChatMember(sub.group_id, telegramId)
      // Desbane imediatamente (apenas remove, não bloqueia para sempre)
      await bot.telegram.unbanChatMember(sub.group_id, telegramId, { only_if_banned: true })

      // Notifica o lead
      await bot.telegram.sendMessage(telegramId,
        `⏰ Sua assinatura expirou.\n\nRenove agora e volte pro grupo:\n/renovar`
      )
    } catch (e) {
      // Lead pode ter saído do grupo manualmente — ignora erro 400
      console.warn(`[cron] não removeu ${telegramId}:`, e.message)
    }

    // Marca como expirada no banco
    await supabase
      .from('subscriptions')
      .update({ status: 'expired', removed_at: agora })
      .eq('id', sub.id)
  }
}
