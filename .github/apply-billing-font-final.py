from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
source = path.read_text()

old_root = '''  return <div data-billing-tab={tab} style={{ fontFamily: "'Plus Jakarta Sans', Inter, ui-sans-serif, system-ui, sans-serif" }} className={`min-h-screen overflow-x-hidden ${darkMode ? 'bg-[#101223] text-slate-100' : 'bg-[#f7f8f7] text-slate-950'}`}>
'''
new_root = '''  return <div data-billing-tab={tab} style={{ fontFamily: '\"Segoe UI Variable Display\", \"Avenir Next\", \"Plus Jakarta Sans\", Inter, ui-sans-serif, system-ui, sans-serif' }} className={`min-h-screen overflow-x-hidden ${darkMode ? 'bg-[#101223] text-slate-100' : 'bg-[#f7f8f7] text-slate-950'}`}>
'''
if old_root not in source:
    raise SystemExit('Billing root font marker not found')
source = source.replace(old_root, new_root, 1)

old_rules = '''      /* Use the tab-title serif face for normal billing UI text. Headings are intentionally excluded. */
      [data-billing-tab] p,
      [data-billing-tab] span,
      [data-billing-tab] small,
      [data-billing-tab] label,
      [data-billing-tab] button,
      [data-billing-tab] input,
      [data-billing-tab] textarea,
      [data-billing-tab] select,
      [data-billing-tab] option,
      [data-billing-tab] table,
      [data-billing-tab] td,
      [data-billing-tab] th,
      [data-billing-tab] strong,
      [data-billing-tab] b,
      [data-billing-tab] a {
        font-family: Georgia, Times, "Times New Roman", serif;
      }

      [data-billing-tab] h1 *,
      [data-billing-tab] h2 *,
      [data-billing-tab] h3 *,
      [data-billing-tab] h4 *,
      [data-billing-tab] h5 *,
      [data-billing-tab] h6 * {
        font-family: inherit;
      }

'''

new_rules = '''      /* Use the original tab/menu font everywhere; headings alone use Georgia/Times. */
      [data-billing-tab],
      [data-billing-tab] * {
        font-family: "Segoe UI Variable Display", "Avenir Next", "Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, sans-serif !important;
      }

      [data-billing-tab] h1,
      [data-billing-tab] h2,
      [data-billing-tab] h3,
      [data-billing-tab] h4,
      [data-billing-tab] h5,
      [data-billing-tab] h6,
      [data-billing-tab] h1 *,
      [data-billing-tab] h2 *,
      [data-billing-tab] h3 *,
      [data-billing-tab] h4 *,
      [data-billing-tab] h5 *,
      [data-billing-tab] h6 * {
        font-family: Georgia, Times, "Times New Roman", serif !important;
      }

'''
if old_rules not in source:
    raise SystemExit('Reversed typography rules not found')
source = source.replace(old_rules, new_rules, 1)

if source.count('font-family: Georgia, Times, "Times New Roman", serif !important;') != 1:
    raise SystemExit('Heading serif rule validation failed')
if 'Segoe UI Variable Display' not in source:
    raise SystemExit('Original tab/menu font stack missing')

path.write_text(source)
