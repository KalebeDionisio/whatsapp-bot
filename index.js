const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════════════════════════
// 📌 CONFIGURAÇÃO - Já preenchido com as credenciais do Lovable
// ═══════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://mzudsxxjhjxyirexfuqj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16dWRzeHhqaGp4eWlyZXhmdXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1MzkyNTksImV4cCI6MjA4MzExNTI1OX0._Zy8DaukVmCTS7Ec_MdSWyFxXgt9vuLhkPW8ZUAwXMM';

// Endpoint da Edge Function que processa mensagens com IA
const PROCESS_MESSAGE_URL = `${SUPABASE_URL}/functions/v1/process-message`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Cliente WhatsApp com persistência de sessão
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});

let botConfig = {};
let settingsId = null;

// ═══════════════════════════════════════════════════════════
// 📦 FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════

// Carrega configurações do Supabase
async function loadSettings() {
    const { data, error } = await supabase
        .from('bot_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    
    if (data) {
        botConfig = data;
        settingsId = data.id;
        console.log('[CONFIG] Configurações carregadas:', {
            delayMin: data.typing_delay_min,
            delayMax: data.typing_delay_max,
            persuasion: data.persuasion_level,
            processUnread: data.process_unread
        });
    }
    return data;
}

// Atualiza status da conexão no Supabase (aparece no Dashboard)
async function updateConnectionStatus(status, qrCode = null) {
    const update = { session_status: status };
    if (qrCode !== null) update.qr_code_data = qrCode;
    
    if (settingsId) {
        await supabase.from('bot_settings').update(update).eq('id', settingsId);
    } else {
        const { data } = await supabase.from('bot_settings').insert(update).select().single();
        if (data) settingsId = data.id;
    }
}

// Simula comportamento humano (delay + digitando...)
async function humanTyping(chat, responseLength) {
    const min = (botConfig.typing_delay_min || 2) * 1000;
    const max = (botConfig.typing_delay_max || 15) * 1000;
    const baseDelay = Math.floor(Math.random() * (max - min + 1) + min);
    
    // Tempo extra baseado no tamanho da resposta
    const typingTime = Math.min(responseLength * 40, 8000);
    
    console.log(`[HUMAN] Aguardando ${baseDelay}ms antes de digitar...`);
    await new Promise(r => setTimeout(r, baseDelay));
    
    await chat.sendStateTyping();
    console.log(`[HUMAN] Digitando por ${typingTime}ms...`);
    await new Promise(r => setTimeout(r, typingTime));
    await chat.clearState();
}

// Chama a Edge Function que processa mensagem com IA (Lovable AI)
async function processWithAI(message, contact, messageType = 'text', isAudio = false) {
    try {
        const response = await fetch(PROCESS_MESSAGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_KEY}`
            },
            body: JSON.stringify({
                message,
                phoneNumber: contact.number,
                contactName: contact.pushname || contact.name || '',
                messageType,
                isAudioTranscription: isAudio
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('[AI] Erro:', data.error);
            return null;
        }

        return data.response;
    } catch (error) {
        console.error('[AI] Erro na requisição:', error);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════
// 📨 PROCESSADOR CENTRAL DE MENSAGENS
// ═══════════════════════════════════════════════════════════

async function handleIncomingMessage(msg) {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    
    // Ignora grupos (opcional - remova se quiser responder em grupos)
    if (chat.isGroup) {
        console.log('[SKIP] Mensagem de grupo ignorada');
        return;
    }

    // Ignora mensagens do próprio bot
    if (msg.fromMe) return;

    console.log(`[MSG] De: ${contact.pushname || msg.from} | Tipo: ${msg.type}`);
    console.log(`[MSG] Conteúdo: ${msg.body.substring(0, 100)}...`);

    let messageContent = msg.body;
    let messageType = 'text';
    let isAudio = false;

    // Tratamento de mídia
    if (msg.hasMedia) {
        messageType = msg.type; // audio, image, video, etc
        
        if (msg.type === 'ptt' || msg.type === 'audio') {
            // Para áudio, você precisaria transcrever. Por ora, mensagem genérica.
            messageContent = '[O cliente enviou um áudio. Responda de forma amigável dizendo que ouviu.]';
            isAudio = true;
        } else if (msg.type === 'image') {
            messageContent = msg.body || '[O cliente enviou uma imagem. Comente sobre ela.]';
            // TODO: Implementar download da imagem e envio como base64 para visão
        } else {
            messageContent = `[O cliente enviou uma mídia do tipo: ${msg.type}]`;
        }
    }

    // Processa com IA
    const response = await processWithAI(messageContent, contact, messageType, isAudio);
    
    if (!response) {
        console.error('[ERROR] Falha ao gerar resposta');
        return;
    }

    // Comportamento humano (delay + digitando)
    await humanTyping(chat, response.length);

    // Envia resposta
    await client.sendMessage(msg.from, response);
    console.log('[SENT] Resposta enviada (' + response.length + ' chars)');
}

// ═══════════════════════════════════════════════════════════
// 🔄 PROCESSAMENTO DE MENSAGENS NÃO LIDAS
// ═══════════════════════════════════════════════════════════

async function processUnreadMessages() {
    if (!botConfig.process_unread) {
        console.log('[UNREAD] Processamento de mensagens antigas DESATIVADO');
        return;
    }

    console.log('[UNREAD] Buscando mensagens não lidas...');
    const chats = await client.getChats();
    let processed = 0;

    for (const c of chats) {
        if (c.unreadCount > 0 && !c.isGroup) {
            console.log('[UNREAD] ' + c.unreadCount + ' mensagens de ' + c.name);
            
            const messages = await c.fetchMessages({ limit: c.unreadCount });
            const lastMsg = messages[messages.length - 1];
            
            if (lastMsg && !lastMsg.fromMe) {
                await handleIncomingMessage(lastMsg);
                await c.sendSeen();
                processed++;
            }
        }
    }

    console.log('[UNREAD] Total processado: ' + processed + ' conversas');
}

// ═══════════════════════════════════════════════════════════
// 📱 EVENTOS DO WHATSAPP
// ═══════════════════════════════════════════════════════════

client.on('qr', async (qr) => {
    console.log('\n[QR] Novo QR Code gerado! Visualize no Dashboard do Lovable.\n');
    
    // Gera QR Code como imagem base64 para exibir no Dashboard
    const qrDataUrl = await QRCode.toDataURL(qr, { 
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
    });
    
    // Salva QR Code no Supabase para exibir no Dashboard
    await updateConnectionStatus('connecting', qrDataUrl);
    console.log('[QR] QR Code enviado para o Dashboard!');
});

client.on('ready', async () => {
    console.log('\n✅ [READY] Cliente WhatsApp conectado com sucesso!\n');
    await updateConnectionStatus('connected', '');
    
    // Processa mensagens não lidas após estabilizar
    console.log('[READY] Aguardando 5s para processar mensagens antigas...');
    setTimeout(processUnreadMessages, 5000);
});

client.on('authenticated', () => {
    console.log('[AUTH] Autenticado com sucesso');
});

client.on('auth_failure', async (msg) => {
    console.error('[AUTH] Falha na autenticação:', msg);
    await updateConnectionStatus('disconnected');
});

client.on('disconnected', async (reason) => {
    console.log('[DISCONNECT] Desconectado:', reason);
    await updateConnectionStatus('disconnected');
});

client.on('message', async (msg) => {
    // Recarrega configs a cada mensagem (caso mude no Dashboard)
    await loadSettings();
    await handleIncomingMessage(msg);
});

// ═══════════════════════════════════════════════════════════
// 🚀 INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════

console.log(`
═══════════════════════════════════════════════════════════
   🤖 SALES BOT - Powered by Lovable AI
═══════════════════════════════════════════════════════════
   📌 Supabase URL: ${SUPABASE_URL}
   🔐 Edge Function: ${PROCESS_MESSAGE_URL}
═══════════════════════════════════════════════════════════
`);

loadSettings().then(() => {
    console.log('[INIT] Iniciando cliente WhatsApp...');
    client.initialize();
});
3
Execute o Bot
No terminal do seu servidor

