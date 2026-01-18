const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const SUPABASE_URL = 'https://mzudsxxjhjxyirexfuqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16dWRzeHhqaGp4eWlyZXhmdXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1MzkyNTksImV4cCI6MjA4MzExNTI1OX0._Zy8DaukVmCTS7Ec_MdSWyFxXgt9vuLhkPW8ZUAwXMM';

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

const conversationHistory = new Map();

client.on('qr', (qr) => {
  console.log('QR Code recebido! Escaneie com o WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot conectado e pronto!');
});

client.on('message', async (message) => {
  if (message.fromMe) return;
  
  const phoneNumber = message.from.replace('@c.us', '');
  const contactName = message._data.notifyName || 'Cliente';
  
  if (!conversationHistory.has(phoneNumber)) {
    conversationHistory.set(phoneNumber, []);
  }
  
  const history = conversationHistory.get(phoneNumber);
  history.push({ role: 'user', content: message.body });
  
  if (history.length > 20) history.shift();
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        message: message.body,
        phoneNumber,
        contactName,
        conversationHistory: history.slice(-10)
      })
    });
    
    const data = await response.json();
    
    if (data.response) {
      history.push({ role: 'assistant', content: data.response });
      await message.reply(data.response);
      console.log(`📨 ${contactName}: ${message.body}`);
      console.log(`🤖 Bot: ${data.response}`);
    }
  } catch (error) {
    console.error('Erro:', error);
  }
});

client.initialize();
console.log('🚀 Iniciando WhatsApp Bot...');
