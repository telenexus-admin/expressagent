from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
source = path.read_text()

marker = '''      [data-billing-tab=\"agents\"] > div > header {'''
if marker not in source:
    raise SystemExit('Billing workspace style marker not found')

font_rules = '''      /* Use the tab-title serif face for normal billing UI text while preserving headings. */
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
        font-family: Georgia, Times, \"Times New Roman\", serif;
      }

      [data-billing-tab] h1,
      [data-billing-tab] h2,
      [data-billing-tab] h3,
      [data-billing-tab] h4,
      [data-billing-tab] h5,
      [data-billing-tab] h6 {
        font-family: inherit;
      }

'''

source = source.replace(marker, font_rules + marker, 1)

# The sidebar previously forced a separate sans font. Remove only that override
# so its normal labels inherit the billing text treatment; section headings are divs
# and retain their existing typography/classes.
aside_style = '''      style={{ fontFamily: '\"Segoe UI Variable Display\", \"Avenir Next\", \"Plus Jakarta Sans\", Inter, ui-sans-serif, system-ui, sans-serif' }}\n'''
if aside_style not in source:
    raise SystemExit('Expected sidebar font override not found')
source = source.replace(aside_style, '', 1)

# Verify the tab title itself still explicitly uses Georgia.
if 'font-[Georgia,Times,serif]' not in source:
    raise SystemExit('Tab title Georgia font marker is missing')

path.write_text(source)
