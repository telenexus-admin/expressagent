from pathlib import Path

path = Path('frontend/src/pages/HotspotPortal.jsx')
text = path.read_text()

marker = "  const selectedCheckoutPrice = (() => {"
insert = """  const pageStyle = backgroundImageUrl
    ? {
        ...heroStyle,
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'scroll',
      }
    : {
        backgroundColor: theme.page,
      };

  const heroSectionStyle = backgroundImageUrl
    ? {
        background: 'transparent',
      }
    : heroStyle;

"""
if marker not in text:
    raise SystemExit('selectedCheckoutPrice marker not found')
if 'const pageStyle = backgroundImageUrl' not in text:
    text = text.replace(marker, insert + marker, 1)

old_wrapper = '''className="hotspot-page mx-auto min-h-screen w-full max-w-[760px] overflow-hidden bg-[#fbfcff] shadow-2xl shadow-slate-900/10"
        style={{
          '--hs-accent':
            accentColor,

          '--hs-deep':
            theme.deep,
        }}'''
new_wrapper = '''className="hotspot-page mx-auto min-h-screen w-full max-w-[760px] overflow-hidden shadow-2xl shadow-slate-900/10"
        style={{
          ...pageStyle,

          '--hs-accent':
            accentColor,

          '--hs-deep':
            theme.deep,
        }}'''
if old_wrapper not in text:
    raise SystemExit('hotspot wrapper marker not found')
text = text.replace(old_wrapper, new_wrapper, 1)

old_hero = "style={designTemplate === 'green_portrait' ? undefined : heroStyle}"
new_hero = "style={designTemplate === 'green_portrait' ? undefined : heroSectionStyle}"
if old_hero not in text:
    raise SystemExit('hero style marker not found')
text = text.replace(old_hero, new_hero, 1)

list_css = '''        .hotspot-layout-list {
          grid-template-columns:
            minmax(0, 1fr);
        }
'''
list_css_new = list_css + '''
        .hotspot-layout-list
        .hotspot-package-card {
          width: 60%;
          justify-self: center;
          grid-template-columns:
            72px minmax(0, 1fr) auto !important;
          border-radius: 14px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:first-child {
          min-height: 62px !important;
          gap: 6px !important;
          padding-left: 8px !important;
          padding-right: 8px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:first-child
        svg {
          width: 20px !important;
          height: 20px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:first-child
        > div
        > div:first-child {
          font-size: 18px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:first-child
        > div
        > div:last-child {
          margin-top: 4px !important;
          font-size: 8px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:nth-child(2) {
          padding: 9px 10px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:nth-child(2)
        > div {
          font-size: 12px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:nth-child(2)
        p {
          margin-top: 2px !important;
          font-size: 9px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:last-child {
          gap: 4px !important;
          padding-left: 7px !important;
          padding-right: 7px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:last-child
        span {
          font-size: 12px !important;
        }

        .hotspot-layout-list
        .hotspot-package-card
        > div:last-child
        svg {
          width: 15px !important;
          height: 15px !important;
        }
'''
if list_css not in text:
    raise SystemExit('list layout CSS marker not found')
text = text.replace(list_css, list_css_new, 1)

path.write_text(text)
