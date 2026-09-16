#!/usr/bin/env python3
"""v1.41.1 — keep the service worker out of the dev build entirely."""
import sys, json

VER = '1.41.1'; DATE_H = 'September 16, 2026'; DATE_J = '2026-09-16'
NAME = 'Groundwork for safer testing'
NOTES = ['Behind the scenes: work on the way I test new features before they reach you. '
         'Nothing in the app itself changes with this one.']

def edit(path, fn):
    raw = open(path, 'rb').read(); crlf = raw.count(b'\r\n') > 0
    s = raw.decode('utf-8').replace('\r\n', '\n')
    s = fn(s)
    open(path, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
    print(f'  ok    {path} ({"CRLF" if crlf else "LF"})')

def sw(s):
    old = """  if (url.hostname === 'accounts.google.com' ||
      url.hostname === 'oauth2.googleapis.com' ||
      url.hostname === 'www.googleapis.com' ||
      url.hostname === 'apis.google.com') return;
"""
    assert s.count(old) == 1, 'sw: google-hosts anchor'
    new = old + """
  // v1.41.1 — never handle the dev build. app/dev.html is a generated
  // development copy (tools/make-dev.js) that exists only so in-progress work
  // can be opened on a real device; GitHub Pages serves only `main`, so a
  // feature branch cannot be. Two concrete problems this early return fixes:
  //
  //   1. The HTML branch below is network-first but it CACHES what it fetches,
  //      so every dev load pushed a development build into the production
  //      cache.
  //   2. Its offline fallback is caches.match('./app/dashboard.html') — a
  //      failed dev fetch would serve PRODUCTION html at the dev URL, which
  //      looks like the dev build silently reverting.
  //
  // Handing dev.html straight to the network also means the dev shim no longer
  // has to unregister this worker to protect itself, which used to leave the
  // real PWA without offline support until the app was next opened online.
  if (url.pathname.endsWith('/dev.html')) return;
"""
    s = s.replace(old, new, 1)
    old_cache = "const CACHE_NAME = 'debtfree-1.41.0';"
    assert s.count(old_cache) == 1, 'sw: CACHE_NAME anchor'
    return s.replace(old_cache, f"const CACHE_NAME = 'debtfree-{VER}';", 1)

def dash(s):
    old = "const APP_VERSION = '1.41.0';"
    assert s.count(old) == 1, 'APP_VERSION anchor'
    s = s.replace(old, f"const APP_VERSION = '{VER}';", 1)
    anchor = "const RELEASE_NOTES = [\n"
    assert s.count(anchor) == 1, 'RELEASE_NOTES anchor'
    entry = ("  {\n"
             f"    version: '{VER}',\n"
             f"    date: '{DATE_H}',\n"
             f"    name: '{NAME}',\n"
             "    whatsNew: [],\n"
             "    fixes: [\n"
             + "".join("      '" + n.replace("\\", "\\\\").replace("'", "\\'") + "',\n" for n in NOTES)
             + "    ]\n  },\n")
    return s.replace(anchor, anchor + entry, 1)

def vj(s):
    d = json.loads(s)
    d['version'] = VER; d['releaseDate'] = DATE_J; d['releaseName'] = NAME; d['notes'] = NOTES
    return json.dumps(d, indent=2, ensure_ascii=False) + '\n'

edit(sys.argv[1], dash); edit(sys.argv[2], sw); edit(sys.argv[3], vj)
