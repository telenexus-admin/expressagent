from pathlib import Path

path = Path('frontend/src/components/HotspotControlCenter.jsx')
source = path.read_text()

# Replace the remaining violet/purple Tailwind accents with the hotspot's
# existing emerald/light-green family.
source = source.replace('violet', 'emerald')
source = source.replace('bg-[#f8f7ff]', 'bg-emerald-50/50')

# Light-green action buttons use dark emerald text for contrast, matching
# the existing Publish and Save slides buttons.
source = source.replace(
    'inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-400 px-3 text-[9px] font-black text-white',
    'inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-400 px-3 text-[9px] font-black text-emerald-950'
)
source = source.replace(
    'shrink-0 bg-emerald-400 px-3 py-2 text-[8px] font-black uppercase tracking-[.14em] text-white',
    'shrink-0 bg-emerald-400 px-3 py-2 text-[8px] font-black uppercase tracking-[.14em] text-emerald-950'
)
source = source.replace(
    'rounded-xl bg-emerald-400 px-4 py-2.5 text-[9px] font-black text-white shadow-sm shadow-emerald-200 disabled:cursor-not-allowed disabled:opacity-50',
    'rounded-xl bg-emerald-400 px-4 py-2.5 text-[9px] font-black text-emerald-950 shadow-sm shadow-emerald-200 disabled:cursor-not-allowed disabled:opacity-50'
)

start_marker = '        {/* FLASH SUMMARY */}'
end_marker = '        {/* PROMO SLIDES */}'
start = source.index(start_marker)
end = source.index(end_marker)

flash_section = '''        {/* FLASH SUMMARY */}

        <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-black text-slate-900">
                  Flash Package
                </h3>

                <span
                  className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${
                    settings.flash_enabled
                      ? 'bg-pink-50 text-pink-600'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {settings.flash_enabled
                    ? 'Active'
                    : 'Off'}
                </span>
              </div>

              <p className="mt-1 text-[10px] text-slate-400">
                Create a temporary discounted package with a countdown.
              </p>
            </div>

            <button
              type="button"
              onClick={openFlashPackage}
              className="shrink-0 rounded-xl bg-emerald-400 px-3 py-2.5 text-[9px] font-black text-emerald-950"
            >
              Configure
            </button>
          </div>

          {settings.flash_enabled && flashPlan && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
                <Icon
                  name="bolt"
                  className="h-4 w-4"
                />
              </span>

              <div className="min-w-0 flex-1">
                <strong className="block truncate text-xs font-black text-slate-900 sm:text-sm">
                  {flashPlan.name}
                </strong>

                <p className="mt-1 truncate text-[10px] text-slate-500">
                  <span className="line-through">
                    {money(
                      flashPlan.price
                    )}
                  </span>

                  {' → '}

                  <b className="text-emerald-700">
                    {money(
                      settings.flash_discount_price
                    )}
                  </b>
                </p>
              </div>
            </div>
          )}
        </section>


'''

source = source[:start] + flash_section + source[end:]

if 'violet' in source:
    raise SystemExit('A violet hotspot accent still remains in HotspotControlCenter.jsx')

if 'Flash Package' not in source or 'Slides / Promo' not in source:
    raise SystemExit('Expected hotspot section headings were not found after transformation')

path.write_text(source)
