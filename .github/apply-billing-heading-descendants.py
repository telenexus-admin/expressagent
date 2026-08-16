from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
source = path.read_text()

needle = '''      [data-billing-tab] a {
        font-family: Georgia, Times, "Times New Roman", serif;
      }

'''
if needle not in source:
    raise SystemExit('Billing serif body rule not found')

guard = '''      [data-billing-tab] h1 *,
      [data-billing-tab] h2 *,
      [data-billing-tab] h3 *,
      [data-billing-tab] h4 *,
      [data-billing-tab] h5 *,
      [data-billing-tab] h6 * {
        font-family: inherit;
      }

'''

if guard not in source:
    source = source.replace(needle, needle + guard, 1)

if 'font-[Georgia,Times,serif]' not in source:
    raise SystemExit('Tab heading serif marker missing')

path.write_text(source)
