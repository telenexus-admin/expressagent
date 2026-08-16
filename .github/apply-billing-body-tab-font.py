from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
source = path.read_text()

style_marker = '    <style>{`'
style_start = source.find(style_marker)
if style_start < 0:
    raise SystemExit('Billing workspace style block not found')

insert_at = source.find('\n', style_start)
if insert_at < 0:
    raise SystemExit('Billing workspace style block line ending not found')
insert_at += 1

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
        font-family: Georgia, Times, "Times New Roman", serif;
      }

      /* Headings keep their existing typography. */
      [data-billing-tab] h1,
      [data-billing-tab] h2,
      [data-billing-tab] h3,
      [data-billing-tab] h4,
      [data-billing-tab] h5,
      [data-billing-tab] h6 {
        font-family: inherit;
      }

'''

source = source[:insert_at] + font_rules + source[insert_at:]

aside_style = '''      style={{ fontFamily: '"Segoe UI Variable Display", "Avenir Next", "Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, sans-serif' }}
'''
if aside_style not in source:
    raise SystemExit('Expected sidebar font override not found')
source = source.replace(aside_style, '', 1)

if 'font-[Georgia,Times,serif]' not in source:
    raise SystemExit('Tab title Georgia font marker is missing')

if 'font-family: Georgia, Times, "Times New Roman", serif;' not in source:
    raise SystemExit('Billing serif rule was not inserted')

path.write_text(source)
