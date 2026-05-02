import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_ATTEMPTS         = 3;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  return crypto.randomUUID();
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { phone, code } = await req.json();
    if (!phone || !code) {
      return new Response(JSON.stringify({ error: 'Missing phone or code.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const phoneHash = await sha256(phone);
    const codeHash  = await sha256(code);
    const now       = new Date().toISOString();

    // Find the latest unexpired, unverified OTP for this phone
    const { data: attempt, error } = await supabase
      .from('otp_attempts')
      .select('id, code_hash, attempts, expires_at, verified')
      .eq('phone_hash', phoneHash)
      .eq('verified', false)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !attempt) {
      return new Response(JSON.stringify({ error: 'Code expired or not found. Request a new one.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const attemptsUsed = attempt.attempts + 1;

    if (attemptsUsed > MAX_ATTEMPTS) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Request a new code.', attemptsLeft: 0 }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (attempt.code_hash !== codeHash) {
      await supabase.from('otp_attempts').update({ attempts: attemptsUsed }).eq('id', attempt.id);
      const attemptsLeft = MAX_ATTEMPTS - attemptsUsed;
      return new Response(JSON.stringify({ error: 'Incorrect code.', attemptsLeft }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Correct code — mark verified, issue token
    const token = generateToken();
    await supabase.from('otp_attempts').update({ verified: true, token, attempts: attemptsUsed }).eq('id', attempt.id);

    return new Response(JSON.stringify({ ok: true, token }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
