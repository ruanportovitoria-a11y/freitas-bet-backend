require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// SUPABASE - aceita chaves novas e antigas
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE || SUPABASE_ANON);

// MERCADO PAGO
mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });

app.get('/', (req,res)=> res.json({ ok:true, name:'FREITAS BET API', status:'online' }));

// CRIAR PIX - GERAR QR CODE REAL
app.post('/api/pix/create', async (req,res)=>{
  try {
    const { amount, email, user_id } = req.body;
    if(!amount) return res.status(400).json({ error:'amount required' });
    
    const preference = {
      items: [{ title: 'Deposito FREITAS BET', quantity: 1, unit_price: Number(amount) }],
      payer: { email: email || 'cliente@freitas.bet' },
      payment_methods: { excluded_payment_types: [], installments: 1 },
      notification_url: `${process.env.PUBLIC_URL || 'https://ytuhmlyikbksetjfreur.supabase.co'}/webhook`,
      external_reference: user_id || 'freitas_bet',
      binary_mode: true
    };

    // Cria pagamento PIX direto
    const payment_data = {
      transaction_amount: Number(amount),
      description: 'Deposito FREITAS BET',
      payment_method_id: 'pix',
      payer: { email: email || 'cliente@freitas.bet' }
    };

    const result = await mercadopago.payment.create(payment_data);
    
    // Salva no supabase se tiver user_id
    if(user_id){
      await supabase.from('transactions').insert({
        user_id,
        amount: Number(amount),
        type: 'deposit',
        status: 'pending',
        mp_payment_id: String(result.body.id)
      });
    }

    return res.json({
      id: result.body.id,
      status: result.body.status,
      qr_code: result.body.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: result.body.point_of_interaction?.transaction_data?.qr_code_base64,
      ticket_url: result.body.point_of_interaction?.transaction_data?.ticket_url
    });
  } catch(e){
    console.error(e);
    return res.status(500).json({ error: e.message, details: e });
  }
});

// WEBHOOK MERCADO PAGO
app.post('/webhook', async (req,res)=>{
  try{
    const { data } = req.body;
    if(data?.id){
      const payment = await mercadopago.payment.findById(data.id);
      if(payment.body.status === 'approved'){
        await supabase.from('transactions').update({ status:'approved' }).eq('mp_payment_id', String(data.id));
        // credita saldo
        const { data: tx } = await supabase.from('transactions').select('*').eq('mp_payment_id', String(data.id)).single();
        if(tx){
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', tx.user_id).single();
          if(profile){
            await supabase.from('profiles').update({ balance: (profile.balance||0) + tx.amount }).eq('id', tx.user_id);
          }
        }
      }
    }
    res.sendStatus(200);
  }catch(e){ res.sendStatus(200); }
});

// AUTH SIMPLES
app.post('/api/auth/register', async (req,res)=>{
  const { email, password, name } = req.body;
  const { data, error } = await supabase.auth.signUp({ email, password, options:{ data:{ name } } });
  if(error) return res.status(400).json({ error:error.message });
  await supabase.from('profiles').insert({ id:data.user.id, email, name, balance:0 });
  res.json(data);
});

app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) return res.status(400).json({ error:error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('
