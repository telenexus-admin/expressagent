from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
text = path.read_text()

replacements = [
    (
        'className={`fixed inset-y-0 left-0 z-40 flex w-[218px] flex-col overflow-y-auto overflow-x-hidden overscroll-contain border-r border-slate-100 bg-white px-2.5 py-3 text-slate-500 shadow-[8px_0_30px_rgba(15,23,42,.035)] transition-transform duration-300 sm:w-[232px] sm:px-3 lg:w-[260px] lg:px-4 lg:py-7 ${open ? \'translate-x-0\' : \'-translate-x-full\'} ${sidebarCollapsed ? \'lg:-translate-x-full\' : \'lg:translate-x-0\'}`}',
        'className={`fixed inset-y-0 left-0 z-40 flex w-[218px] flex-col overflow-y-auto overflow-x-hidden overscroll-contain border-r border-slate-100 bg-white px-2.5 py-3 text-slate-500 shadow-[8px_0_30px_rgba(15,23,42,.035)] transition-transform duration-300 sm:w-[232px] sm:px-3 lg:w-[218px] lg:px-2.5 lg:py-3 ${open ? \'translate-x-0\' : \'-translate-x-full\'} ${sidebarCollapsed ? \'lg:-translate-x-full\' : \'lg:translate-x-0\'}`}',
        'sidebar width/padding',
    ),
    (
        'className="flex items-center gap-1.5 px-2 py-1 lg:gap-2 lg:px-4 lg:py-0"',
        'className="flex items-center gap-1.5 px-2 py-1"',
        'brand spacing',
    ),
    (
        'className={`text-[11px] font-extrabold uppercase tracking-[.08em] lg:text-sm lg:font-black lg:tracking-[.1em] ${darkMode ? \'text-slate-100\' : \'text-slate-900\'}`}',
        'className={`text-[11px] font-extrabold uppercase tracking-[.08em] ${darkMode ? \'text-slate-100\' : \'text-slate-900\'}`}',
        'brand typography',
    ),
    (
        'className={`border-l pl-1.5 text-[7px] font-bold uppercase tracking-[.12em] lg:pl-2 lg:text-[10px] lg:font-extrabold lg:tracking-[.16em] ${darkMode ? \'border-slate-600 text-slate-400\' : \'border-slate-300 text-slate-500\'}`}',
        'className={`border-l pl-1.5 text-[7px] font-bold uppercase tracking-[.12em] ${darkMode ? \'border-slate-600 text-slate-400\' : \'border-slate-300 text-slate-500\'}`}',
        'billing label typography',
    ),
    (
        'className="mt-2 space-y-1.5 pb-1 lg:mt-8 lg:space-y-5 lg:pb-5"',
        'className="mt-2 space-y-1.5 pb-1"',
        'group spacing',
    ),
    (
        'className="px-2 pt-1 text-[7px] font-extrabold uppercase tracking-[.16em] text-slate-400 lg:px-4 lg:pt-0 lg:text-[10px] lg:font-black lg:tracking-[.18em]"',
        'className="px-2 pt-1 text-[7px] font-extrabold uppercase tracking-[.16em] text-slate-400"',
        'section heading typography',
    ),
    (
        'className="mt-0.5 space-y-0.5 lg:mt-2 lg:space-y-1"',
        'className="mt-0.5 space-y-0.5"',
        'nav spacing',
    ),
    (
        "className={`flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[9.5px] font-semibold tracking-[-.015em] transition sm:px-2.5 sm:py-1.5 sm:text-[10px] lg:gap-3 lg:rounded-r-xl lg:px-4 lg:py-2.5 lg:text-sm lg:font-bold ${",
        "className={`flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[9.5px] font-semibold tracking-[-.015em] transition sm:px-2.5 sm:py-1.5 sm:text-[10px] lg:px-2 lg:py-1 lg:text-[9.5px] ${",
        'desktop nav row sizing',
    ),
    (
        "? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100 lg:border-l-[3px] lg:border-emerald-500 lg:ring-0'",
        "? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100'",
        'active nav style',
    ),
    (
        ": 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 lg:border-l-[3px] lg:border-transparent'",
        ": 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'",
        'inactive nav style',
    ),
    (
        'className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md transition sm:h-6 sm:w-6 lg:h-6 lg:w-6 lg:rounded-none lg:bg-transparent ${',
        'className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md transition sm:h-6 sm:w-6 lg:h-[22px] lg:w-[22px] ${',
        'desktop icon sizing',
    ),
    (
        'className="mt-auto border-t border-slate-100 px-1 pt-1.5 lg:px-3 lg:pt-5"',
        'className="mt-auto border-t border-slate-100 px-1 pt-1.5"',
        'footer spacing',
    ),
    (
        'className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[8px] font-black text-emerald-700 lg:h-9 lg:w-9 lg:rounded-full lg:text-xs"',
        'className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[8px] font-black text-emerald-700"',
        'footer avatar',
    ),
    (
        'className="truncate text-[9px] font-semibold text-slate-800 lg:text-xs lg:font-bold"',
        'className="truncate text-[9px] font-semibold text-slate-800"',
        'footer name',
    ),
    (
        'className="hidden truncate text-[11px] text-slate-400 lg:block"',
        'className="hidden truncate text-[11px] text-slate-400"',
        'hide business subtitle in compact rail',
    ),
    (
        'className="mt-1 flex h-6 items-center gap-1.5 rounded-lg px-1.5 text-[8.5px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 lg:mt-4 lg:h-auto lg:px-0 lg:text-xs lg:font-bold"',
        'className="mt-1 flex h-6 items-center gap-1.5 rounded-lg px-1.5 text-[8.5px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"',
        'signout sizing',
    ),
    (
        "className={`min-h-screen transition-[padding] duration-300 ${sidebarCollapsed ? 'lg:pl-0' : 'lg:pl-[260px]'}`}",
        "className={`min-h-screen transition-[padding] duration-300 ${sidebarCollapsed ? 'lg:pl-0' : 'lg:pl-[218px]'}`}",
        'content rail offset',
    ),
]

for old, new, label in replacements:
    if old not in text:
        raise SystemExit(f'{label}: marker not found')
    text = text.replace(old, new, 1)

path.write_text(text)
