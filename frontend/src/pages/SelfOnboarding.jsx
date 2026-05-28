import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import nexaLogo from '../assets/nexa-logo.png';

const slides = [
  { eyebrow: 'NEXA AI SUPPORT', title: 'Your WhatsApp, now powered by AI.', text: 'Let Nexa respond instantly to enquiries, guide customers and keep your business available even when you are offline.', accent: 'from-[#3535FF] to-[#7B39F4]', icon: '✦' },
  { eyebrow: 'SMART CUSTOMER CARE', title: 'Never lose a serious customer again.', text: 'Nexa identifies support requests, installation leads and dissatisfied customers, helping your team follow up faster.', accent: 'from-[#651FFF] to-[#13B8FF]', icon: '◎' },
  { eyebrow: 'CONNECT IN MINUTES', title: 'Link once. Your onboarding begins.', text: 'No Meta setup required. Connect an ordinary WhatsApp number securely by QR code or phone pairing and let Telenexus prepare your AI agent.', accent: 'from-[#101027] to-[#3535FF]', icon: '⌁' },
];

const initialForm = { business_name: '', owner_name: '', phone: '', email: '', location: '', service_interest: 'isp_support', consent_accepted: false };

function NexaLogo() {
  return <div className="flex items-center gap-2"><div className="flex h-10 w-10 items-center justify-center"><img src={nexaLogo} alt="Nexa" className="h-full w-full object-contain" /></div><div><p className="text-base font-black text-white">Nexa</p><p className="text-[10px] font-bold tracking-widest text-white/45">BY TELENEXUS</p></div></div>;
}

function NexaMiniBrand() {
  return <div className="flex items-center gap-2"><div className="flex h-10 w-10 items-center justify-center"><img src={nexaLogo} alt="Nexa" className="h-full w-full object-contain" /></div><span className="font-black text-slate-950">Nexa</span></div>;
}

function Intro({ slide, onNext, onSkip }) {
  return <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#090916] px-6 pb-8 pt-6 text-white sm:px-10"><div className={`absolute -right-28 -top-20 h-[410px] w-[410px] rounded-full bg-gradient-to-br ${slide.accent} opacity-30 blur-3xl`} /><div className="relative z-10 flex items-center justify-between"><NexaLogo /><button onClick={onSkip} className="rounded-full border border-white/10 px-5 py-2.5 text-xs font-bold text-white/70 hover:bg-white/10">Skip</button></div><div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center"><div className={`mb-10 flex h-32 w-32 items-center justify-center rounded-[38px] bg-gradient-to-br ${slide.accent} text-6xl shadow-2xl shadow-blue-500/20`}>{slide.icon}</div><p className="mb-4 text-xs font-black tracking-[0.25em] text-[#8B87FF]">{slide.eyebrow}</p><h1 className="text-4xl font-black leading-[1.12] tracking-tight sm:text-5xl">{slide.title}</h1><p className="mt-5 text-base leading-7 text-white/60">{slide.text}</p></div><div className="relative z-10 mx-auto flex w-full max-w-md items-center justify-between"><div className="flex gap-2">{slides.map((_, index) => <span key={index} className={`h-2 rounded-full transition-all ${index === slide.index ? 'w-9 bg-white' : 'w-2 bg-white/25'}`} />)}</div><button onClick={onNext} className="rounded-full bg-white px-8 py-4 text-sm font-black text-[#101027] shadow-xl">{slide.index === slides.length - 1 ? 'Get started' : 'Next →'}</button></div></div>;
}

function TextField({ label, value, onChange, placeholder, type = 'text', required = true }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-slate-600">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="w-full rounded-2xl border border-slate-200 bg-[#F8F8FD] px-4 py-3.5 text-sm outline-none focus:border-[#3535FF] focus:ring-2 focus:ring-[#3535FF]/10" /></label>;
}

export default function SelfOnboarding() {
  const [introIndex, setIntroIndex] = useState(0);
  const [stage, setStage] = useState('intro');
  const [form, setForm] = useState(initialForm);
  const [sessionToken, setSessionToken] = useState('');
  const [session, setSession] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [connectMethod, setConnectMethod] = useState('qr');
  const [pairingPhone, setPairingPhone] = useState('');
  const [qrBackup, setQrBackup] = useState('');
  const [requestingPairing, setRequestingPairing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sessionToken || stage !== 'qr') return undefined;
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(`/public/evo-onboarding/status/${sessionToken}`);
        setSession((current) => ({ ...current, ...data }));
        if (data.qr_code) setQrBackup(data.qr_code);
        if (data.status === 'connected') setStage('connected');
      } catch (_err) {}
    }, 4000);
    return () => clearInterval(timer);
  }, [sessionToken, stage]);

  const slide = useMemo(() => ({ ...slides[introIndex], index: introIndex }), [introIndex]);
  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const nextIntro = () => introIndex === slides.length - 1 ? setStage('details') : setIntroIndex(introIndex + 1);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { data } = await api.post('/public/evo-onboarding/start', form);
      setSessionToken(data.session_token); setSession(data); setQrBackup(data.qr_code || ''); setPairingPhone(form.phone); setConnectMethod('qr');
      setStage(data.status === 'connected' ? 'connected' : 'qr');
    } catch (err) { setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not begin onboarding. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const getPairingCode = async () => {
    setRequestingPairing(true); setError(''); setCopied(false);
    try {
      const { data } = await api.post(`/public/evo-onboarding/pairing-code/${sessionToken}`, { phone: pairingPhone });
      setSession((current) => ({ ...current, ...data })); setConnectMethod('pairing_code');
    } catch (err) { setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not generate pairing code. Please try QR instead.'); }
    finally { setRequestingPairing(false); }
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(session?.pairing_code || ''); setCopied(true); } catch (_err) { setCopied(false); }
  };

  if (stage === 'intro') return <Intro slide={slide} onNext={nextIntro} onSkip={() => setStage('details')} />;
  if (stage === 'connected') return <div className="flex min-h-screen items-center justify-center bg-[#090916] p-5 text-white"><div className="w-full max-w-md rounded-[34px] border border-white/10 bg-white/[0.06] p-7 text-center shadow-2xl backdrop-blur"><div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-400/15 text-4xl text-emerald-300">✓</div><p className="text-xs font-black tracking-[0.22em] text-emerald-300">WHATSAPP CONNECTED</p><h1 className="mt-4 text-3xl font-black">You are in, {session?.business_name || form.business_name}.</h1><p className="mt-4 text-sm leading-6 text-white/65">Your connection request has been securely received. The Telenexus team will review your business and prepare your Nexa AI workspace.</p><div className="mt-7 rounded-2xl bg-white/10 px-5 py-4 text-sm text-white/70">We will contact you using the details submitted during onboarding.</div></div></div>;

  if (stage === 'qr') {
    const visibleQr = session?.qr_code || qrBackup;
    return <div className="min-h-screen bg-[#F6F7FF] px-5 py-6"><div className="mx-auto max-w-md"><div className="mb-7 flex items-center justify-between"><NexaMiniBrand /><span className="rounded-full bg-[#E9E9FF] px-4 py-2 text-xs font-black text-[#3535FF]">Step 2 of 2</span></div><div className="rounded-[34px] bg-white p-6 text-center shadow-xl shadow-indigo-100/70"><h1 className="text-2xl font-black text-slate-950">Connect WhatsApp</h1>
      {connectMethod === 'qr' ? <>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">On another device, open WhatsApp → Linked devices → Link a device, then scan this QR code.</p>
        <div className="mx-auto mt-6 flex h-[270px] w-[270px] items-center justify-center rounded-[28px] border border-slate-100 bg-white p-4 shadow-inner">{visibleQr ? <img src={visibleQr} alt="WhatsApp connection QR code" className="h-full w-full object-contain" /> : <div className="text-sm text-slate-400">Preparing secure QR code...</div>}</div>
        <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-[#F3F1FF] px-4 py-3 text-xs font-bold text-[#3535FF]"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#3535FF]" />Waiting for scan...</div>
        <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-slate-100" /><span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">or</span><span className="h-px flex-1 bg-slate-100" /></div>
        <button onClick={() => setConnectMethod('pairing_form')} className="w-full rounded-2xl border border-[#3535FF]/15 bg-[#F6F7FF] px-5 py-4 text-sm font-black text-[#3535FF]">Use another way</button>
        <p className="mt-2 text-xs text-slate-400">Use a pairing code when this is the only phone you have.</p>
      </> : connectMethod === 'pairing_form' ? <>
        <div className="mt-5 rounded-[26px] bg-[#F6F7FF] p-5 text-left"><p className="text-sm font-black text-slate-950">Pair with your phone number</p><p className="mt-2 text-xs leading-5 text-slate-500">Enter the WhatsApp number you want to link, including country code. Example: 2547XXXXXXXX.</p><div className="mt-4"><TextField label="WhatsApp number" value={pairingPhone} onChange={setPairingPhone} placeholder="2547XXXXXXXX" /></div><button onClick={getPairingCode} disabled={requestingPairing || !pairingPhone.trim()} className="mt-4 w-full rounded-2xl bg-[#3535FF] px-5 py-4 text-sm font-black text-white disabled:opacity-50">{requestingPairing ? 'Generating code...' : 'Get pairing code'}</button></div><button onClick={() => setConnectMethod('qr')} className="mt-4 text-sm font-bold text-[#3535FF]">← Back to QR code</button>
      </> : <>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">On WhatsApp, choose <strong>Link with phone number instead</strong>, then enter this secure code.</p>
        <div className="mt-6 rounded-[28px] bg-[#101027] px-5 py-7 text-white"><p className="text-[10px] font-black tracking-[0.23em] text-white/45">PAIRING CODE</p><p className="mt-4 font-mono text-3xl font-black tracking-[0.20em]">{session?.pairing_code || '--------'}</p><button onClick={copyCode} className="mt-5 rounded-full bg-white/10 px-5 py-2.5 text-xs font-bold text-white">{copied ? 'Copied ✓' : 'Copy code'}</button></div>
        <div className="mt-5 rounded-2xl bg-[#F3F1FF] p-4 text-left text-xs leading-6 text-slate-600"><p className="font-black text-[#3535FF]">How to link</p><p>1. Open WhatsApp on the phone for +{session?.pairing_number || pairingPhone}.</p><p>2. Tap Linked devices → Link a device.</p><p>3. Choose Link with phone number instead.</p><p>4. Enter the code shown above.</p></div>
        <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-[#F3F1FF] px-4 py-3 text-xs font-bold text-[#3535FF]"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#3535FF]" />Waiting for connection...</div>
      </>}
      {error && <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-600">{error}</p>}
    </div><p className="mt-5 px-4 text-center text-xs leading-5 text-slate-400">Only connect a business WhatsApp number you control. Your number is reviewed before Nexa AI is activated.</p></div></div>;
  }

  return <div className="min-h-screen bg-[#F6F7FF] px-5 py-6"><div className="mx-auto max-w-lg"><div className="mb-7 flex items-center justify-between"><NexaMiniBrand /><span className="rounded-full bg-[#E9E9FF] px-4 py-2 text-xs font-black text-[#3535FF]">Step 1 of 2</span></div><div className="rounded-[34px] bg-white p-6 shadow-xl shadow-indigo-100/70 sm:p-8"><p className="text-xs font-black tracking-[0.2em] text-[#3535FF]">SELF ONBOARDING</p><h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Tell us about your business</h1><p className="mt-2 text-sm leading-6 text-slate-500">We use these details to prepare a secure Nexa workspace after you connect WhatsApp.</p><form onSubmit={submit} className="mt-7 space-y-4"><TextField label="Business / ISP name" value={form.business_name} onChange={(value) => update('business_name', value)} placeholder="e.g. SmartLink Fibre" /><TextField label="Your full name" value={form.owner_name} onChange={(value) => update('owner_name', value)} placeholder="Business owner or manager" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><TextField label="WhatsApp number" value={form.phone} onChange={(value) => update('phone', value)} placeholder="2547XXXXXXXX" /><TextField label="Email address" type="email" value={form.email} onChange={(value) => update('email', value)} placeholder="you@business.com" /></div><TextField label="Location" value={form.location} onChange={(value) => update('location', value)} placeholder="Town / area served" /><label className="block"><span className="mb-2 block text-xs font-bold text-slate-600">What would you like Nexa to help with?</span><select value={form.service_interest} onChange={(event) => update('service_interest', event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-[#F8F8FD] px-4 py-3.5 text-sm outline-none focus:border-[#3535FF]"><option value="isp_support">ISP customer support</option><option value="customer_support">General customer support</option><option value="sales_support">Leads and sales enquiries</option><option value="full_automation">Full automation setup</option></select></label><label className="flex gap-3 rounded-2xl bg-[#F6F7FF] p-4 text-xs leading-5 text-slate-600"><input type="checkbox" checked={form.consent_accepted} onChange={(event) => update('consent_accepted', event.target.checked)} className="mt-1 h-4 w-4 accent-[#3535FF]" /><span>I confirm that I control the WhatsApp number I will link and consent to Telenexus configuring Nexa AI after review.</span></label>{error && <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}<button type="submit" disabled={submitting || !form.consent_accepted} className="w-full rounded-2xl bg-[#3535FF] px-6 py-4 text-sm font-black text-white shadow-lg disabled:opacity-50">{submitting ? 'Preparing connection...' : 'Continue to WhatsApp connection →'}</button></form></div></div></div>;
}
