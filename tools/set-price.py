#!/usr/bin/env python3
"""
set-price.py — change the premium price everywhere it is written down.

    python3 tools/set-price.py 12 24 --dry-run     # list every site
    python3 tools/set-price.py 12 24               # apply

Why a script and not a find-and-replace: three of the sites are BARE numbers
with no dollar sign, so searching for "$12" silently misses them —

  index.html   "price": "12"                     <- JSON-LD, what Google reads
  index.html   <span class="price-amount">12</span>
  index.html   "priceCurrency": "USD" block

A stale JSON-LD price is worse than a stale sentence: it can put the old figure
in a search result long after the page itself is correct.

CRLF is preserved per file. app/dev.html is skipped — it is generated from
app/dashboard.html, so regenerate it with tools/make-dev.js afterwards.
"""
import sys, os, re

LIVE = ['app/dashboard.html', 'index.html']
# Reachable but not linked from anywhere and not in sitemap. Included by
# default because robots.txt allows every crawler on "/", so a stale price
# here can still be indexed and quoted back at a customer.
ORPHANS = ['pricing-page.html', 'new-hero.html', 'carrd-landing.html', 'launch-kit.html']
DOCS = ['Project_Instructions.md']

def patterns(old, new):
    return [
        (re.compile(r'\$' + re.escape(old) + r'\b'), '$' + new, 'prose $' + old),
        (re.compile(r'("price"\s*:\s*")' + re.escape(old) + r'(")'), r'\g<1>' + new + r'\g<2>', 'JSON-LD price'),
        (re.compile(r'(class="price-amount"[^>]*>)' + re.escape(old) + r'(<)'), r'\g<1>' + new + r'\g<2>', 'price-amount span'),
    ]

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    old, new = sys.argv[1], sys.argv[2]
    dry = '--dry-run' in sys.argv
    include_orphans = '--skip-orphans' not in sys.argv

    files = LIVE + (ORPHANS if include_orphans else []) + DOCS
    total = 0
    for path in files:
        if not os.path.exists(path):
            print(f'  --    {path} (not present)'); continue
        raw = open(path, 'rb').read()
        crlf = raw.count(b'\r\n') > 0
        s = raw.decode('utf-8').replace('\r\n', '\n')
        hits, out = [], s
        for rx, repl, label in patterns(old, new):
            found = len(rx.findall(out))
            if found:
                hits.append(f'{found}x {label}')
                out = rx.sub(repl, out)
        if not hits:
            print(f'  --    {path}: nothing to change'); continue
        n = sum(int(h.split('x')[0]) for h in hits)
        total += n
        tag = 'would change' if dry else 'changed'
        print(f'  ok    {path}: {tag} {n}  ({", ".join(hits)})')
        if dry:
            for i, line in enumerate(s.split('\n'), 1):
                if any(rx.search(line) for rx, _, _ in patterns(old, new)):
                    print(f'          {i}: {line.strip()[:104]}')
        else:
            open(path, 'wb').write((out.replace('\n', '\r\n') if crlf else out).encode('utf-8'))

    print(f'\n  {"would change" if dry else "changed"} {total} site(s) from ${old} to ${new}\n')
    if not dry:
        print('  Next: node tools/make-dev.js app/dashboard.html app/dev.html')
        print('        bump the version triad, then commit everything in ONE commit.')
    print('  NOT covered by this script, do these by hand:')
    print('    - the Gumroad product price itself')
    print('    - any price written into a pinned social post or profile bio')
    print('    - existing customers keep access; it is a one-time purchase\n')

main()
