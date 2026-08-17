from pathlib import Path
import re

p = Path('frontend/src/pages/HotspotPortal.jsx')
t = p.read_text()

def rep(old, new, label):
    global t
    if old not in t:
        raise SystemExit(f'{label} marker not found')
    t = t.replace(old, new, 1)

rep("  const [voucherUser, setVoucherUser] = useState('');\n  const [voucherPassword, setVoucherPassword] = useState('');\n  const [passwordTouched, setPasswordTouched] = useState(false);",
    "  const [voucherCode, setVoucherCode] = useState('');",
    'voucher state')

rep("  const updateVoucherUser = (value) => {\n    const next = value.toUpperCase();\n    setVoucherUser(next);\n    if (!passwordTouched) setVoucherPassword(next);\n  };",
    "  const updateVoucherCode = (value) => {\n    setVoucherCode(value.toUpperCase());\n  };",
    'voucher update helper')

rep("    if (!voucherUser.trim()) {\n      setError('Enter your voucher username.');\n      return;\n    }\n    if (!voucherPassword.trim()) {\n      setError('Enter your voucher password.');\n      return;\n    }\n    if (voucherPassword.trim().toUpperCase() !== voucherUser.trim().toUpperCase()) {\n      setError('For this hotspot, the voucher username and password must be the same code.');\n      return;\n    }",
    "    if (!voucherCode.trim()) {\n      setError('Enter your voucher code.');\n      return;\n    }",
    'voucher validation')

rep("          code: voucherUser.trim(),", "          code: voucherCode.trim(),", 'voucher payload')
rep("          width: 60%;", "          width: 75%;", 'list width')

rep("selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'",
    "selected ? 'ring-2' : 'border-slate-200'",
    'selected package classes')

needle = "                    }`}\n                  >"
replacement = "                    }`}\n                    style={selected ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}26, 0 12px 32px rgba(22,39,82,.13)` } : undefined}\n                  >"
if needle not in t:
    raise SystemExit('package style insertion marker not found')
t = t.replace(needle, replacement, 1)

rep('className="flex items-center gap-2 px-3 text-[#0656d7] sm:gap-4 sm:px-6"',
    'className="flex items-center gap-2 px-3 sm:gap-4 sm:px-6" style={{ color: accentColor }}',
    'package price accent')
rep('<Icon name="chevron" className="h-5 w-5 text-slate-600" />', '<Icon name="chevron" className="h-5 w-5" />', 'package chevron accent')
rep('className="flex items-center gap-3 text-[#064ebd]"', 'className="flex items-center gap-3" style={{ color: accentColor }}', 'voucher heading accent')

pattern = re.compile(r'''              <label className="relative block">\n\s*<span[^\n]*text-\[#3e6eca\][^\n]*>\n\s*<Icon name="user"[\s\S]*?placeholder="Voucher Username"[\s\S]*?</label>\n\n\s*<label className="relative block">[\s\S]*?placeholder="Voucher Password"[\s\S]*?</label>''')
new_input = '''              <label className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: accentColor }}>
                  <Icon name="ticket" className="h-6 w-6" />
                </span>
                <input
                  required
                  type="text"
                  value={voucherCode}
                  onChange={(event) => updateVoucherCode(event.target.value)}
                  placeholder="Voucher Code"
                  autoComplete="one-time-code"
                  className="w-full rounded-xl border border-[#b9c9e7] bg-white py-4 pl-[52px] pr-4 font-mono text-sm font-bold uppercase tracking-wider outline-none transition placeholder:font-sans placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400"
                  style={{ caretColor: accentColor }}
                />
              </label>'''
t, count = pattern.subn(new_input, t, count=1)
if count != 1:
    raise SystemExit(f'voucher fields replacement count={count}')

rep('className="w-full rounded-xl bg-gradient-to-r from-[#0876f9] to-[#073cc9] py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-700/20 disabled:opacity-60"',
    'className="w-full rounded-xl py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg disabled:opacity-60" style={{ backgroundColor: accentColor, boxShadow: `0 10px 24px ${accentColor}2b` }}',
    'voucher login button accent')

p.write_text(t)
