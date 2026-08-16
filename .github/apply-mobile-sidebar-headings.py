from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
source = path.read_text()

replacements = {
'''      <div className="mt-3 space-y-1 pb-2 lg:mt-8 lg:space-y-5 lg:pb-5">''': '''      <div className="mt-2 space-y-1.5 pb-1 lg:mt-8 lg:space-y-5 lg:pb-5">''',
'''              <div className="hidden px-4 text-[10px] font-black uppercase tracking-[.18em] text-slate-400 lg:block">''': '''              <div className="px-2 pt-1 text-[7px] font-extrabold uppercase tracking-[.16em] text-slate-400 lg:px-4 lg:pt-0 lg:text-[10px] lg:font-black lg:tracking-[.18em]">''',
'''              <nav className="mt-1 grid grid-cols-2 gap-1 lg:mt-2 lg:block lg:space-y-1">''': '''              <nav className="mt-0.5 space-y-0.5 lg:mt-2 lg:space-y-1">''',
'''                      className={`flex min-w-0 w-full items-center gap-1.5 rounded-xl px-1.5 py-1.5 text-left text-[9.5px] font-semibold tracking-[-.015em] transition sm:gap-2 sm:px-2 sm:py-2 sm:text-[10px] lg:gap-3 lg:rounded-r-xl lg:px-4 lg:py-2.5 lg:text-sm lg:font-bold ${''': '''                      className={`flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[9.5px] font-semibold tracking-[-.015em] transition sm:px-2.5 sm:py-1.5 sm:text-[10px] lg:gap-3 lg:rounded-r-xl lg:px-4 lg:py-2.5 lg:text-sm lg:font-bold ${''',
'''                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition sm:h-7 sm:w-7 lg:h-6 lg:w-6 lg:rounded-none lg:bg-transparent ${''': '''                      <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md transition sm:h-6 sm:w-6 lg:h-6 lg:w-6 lg:rounded-none lg:bg-transparent ${''',
'''      <div className="mt-auto border-t border-slate-100 px-1 pt-2 lg:px-3 lg:pt-5">''': '''      <div className="mt-auto border-t border-slate-100 px-1 pt-1.5 lg:px-3 lg:pt-5">''',
'''          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-[9px] font-black text-emerald-700 lg:h-9 lg:w-9 lg:rounded-full lg:text-xs">''': '''          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[8px] font-black text-emerald-700 lg:h-9 lg:w-9 lg:rounded-full lg:text-xs">''',
'''            <div className="truncate text-[10px] font-semibold text-slate-800 lg:text-xs lg:font-bold">''': '''            <div className="truncate text-[9px] font-semibold text-slate-800 lg:text-xs lg:font-bold">''',
'''        <button type="button" onClick={logout} className="mt-2 flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[9px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 lg:mt-4 lg:h-auto lg:px-0 lg:text-xs lg:font-bold">''': '''        <button type="button" onClick={logout} className="mt-1 flex h-6 items-center gap-1.5 rounded-lg px-1.5 text-[8.5px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 lg:mt-4 lg:h-auto lg:px-0 lg:text-xs lg:font-bold">'''
}

for old, new in replacements.items():
    if old not in source:
        raise SystemExit(f'Expected sidebar fragment not found: {old[:90]}')
    source = source.replace(old, new, 1)

if 'grid grid-cols-2 gap-1 lg:mt-2' in source:
    raise SystemExit('Two-column mobile sidebar layout still remains')

if 'hidden px-4 text-[10px] font-black uppercase tracking-[.18em] text-slate-400 lg:block' in source:
    raise SystemExit('Mobile section headings are still hidden')

for heading in ['WORKSPACE', 'CUSTOMERS', 'SERVICES', 'FINANCE', 'NETWORK', 'INSIGHTS']:
    if heading not in source:
        raise SystemExit(f'Missing navigation heading: {heading}')

path.write_text(source)
