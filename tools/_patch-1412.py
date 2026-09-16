#!/usr/bin/env python3
"""
v1.41.2 — stop sending real dollar figures to analytics, and stop relying on a
remote setting to mask financial inputs in session recording.

Four events carried money derived from the user's actual finances. They are
replaced with coarse bands, which keeps the distribution readable in GA4 while
removing the figure itself. A full sweep of every trackShare/gtag call site was
done to find them (the project's grep-every-site rule) — the rest send counts,
flags and categorical strings.
"""
import sys, json

VER = '1.41.2'; DATE_H = 'September 16, 2026'; DATE_J = '2026-09-16'
NAME = 'Keeping your numbers your numbers'
NOTES = ["The app no longer includes any dollar amounts in its anonymous usage statistics — "
         "it now records only broad ranges, so the figures you enter stay on your device. "
         "Your amounts are also explicitly hidden from the tool I use to spot layout problems, "
         "rather than relying on that tool's own default."]

def edit(path, fn):
    raw = open(path, 'rb').read(); crlf = raw.count(b'\r\n') > 0
    s = raw.decode('utf-8').replace('\r\n', '\n')
    s = fn(s)
    open(path, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
    print(f'  ok    {path} ({"CRLF" if crlf else "LF"})')

def sub(s, old, new, label, count=1):
    n = s.count(old)
    assert n == count, f'ANCHOR {label!r}: expected {count}, found {n}'
    print(f'  ok    {label}')
    return s.replace(old, new, count)

HELPERS = '''
// v1.41.2 — Analytics must never carry a figure taken from someone's finances.
//
// Four events did: dialdate_apply sent the real extra payment, whatif_set sent
// a slider dollar value, debt_reclassified_transfer sent a transfer amount, and
// lumps_optimized sent an interest saving. Individually small, but the product
// is sold on "your numbers stay on your device", and that claim has to be true
// rather than nearly true.
//
// Bands keep every question worth asking answerable — what size of extra
// payment people use, whether the optimiser saves enough to matter — without
// the underlying number ever leaving the device.
//
// NOTE for GA4: these are new parameter names. Register amount_band /
// extra_band / control_band / saved_band under Admin -> Custom definitions, or
// they report as "(not set)" — the same trap that lost add_debt_error
// segmentation before 1.34.2.
function amountBand(n) {
  var v = Math.abs(Number(n) || 0);
  if (v === 0)     return '0';
  if (v < 50)      return '1-49';
  if (v < 100)     return '50-99';
  if (v < 250)     return '100-249';
  if (v < 500)     return '250-499';
  if (v < 1000)    return '500-999';
  if (v < 2000)    return '1000-1999';
  if (v < 5000)    return '2000-4999';
  if (v < 10000)   return '5000-9999';
  if (v < 25000)   return '10000-24999';
  return '25000+';
}

// v1.41.2 — Session recording masks input values by default, but that default
// is a setting in Clarity's own dashboard, not something this app enforced.
// Anyone changing it remotely would start capturing balances and payments as
// they are typed. Marking the fields in the DOM makes the guarantee local.
//
// Applied by walking the DOM rather than hand-tagging each of the ~24 money
// inputs, so fields added later are covered automatically — which matters
// because the bills work will add more.
function maskFinancialInputs(root) {
  try {
    var scope = root || document;
    var sel = 'input[inputmode="decimal"], input[type="number"], .money-input';
    var nodes = scope.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('data-clarity-mask', 'true');
    }
  } catch (e) {}
}
'''

def dash(s):
    # helpers, immediately before trackShare
    s = sub(s, "function trackShare(action, params) {",
            HELPERS + "\nfunction trackShare(action, params) {", 'insert helpers')

    # the four leaks
    s = sub(s, "trackShare('dialdate_apply', { extra: extra });",
            "trackShare('dialdate_apply', { extra_band: amountBand(extra) });",
            'leak 1/4 dialdate_apply')
    s = sub(s, "trackShare('debt_reclassified_transfer', { _category: 'data_quality', amount: Math.round(amt) });",
            "trackShare('debt_reclassified_transfer', { _category: 'data_quality', amount_band: amountBand(amt) });",
            'leak 2/4 debt_reclassified_transfer')
    s = sub(s, "trackShare('whatif_set', { control: k, control_value: v });",
            "trackShare('whatif_set', { control: k, control_band: amountBand(v) });",
            'leak 3/4 whatif_set')
    s = sub(s, "trackShare('lumps_optimized', { _category: 'planning', saved: Math.round((cur ? cur.interest : 0) - opt.interest) });",
            "trackShare('lumps_optimized', { _category: 'planning', saved_band: amountBand((cur ? cur.interest : 0) - opt.interest) });",
            'leak 4/4 lumps_optimized')

    # run the masker at boot, next to the existing SW registration block
    s = sub(s, "// ── SERVICE WORKER REGISTRATION ──",
            "// ── v1.41.2 — mask money fields for session recording ──\n"
            "maskFinancialInputs();\n"
            "// Modals build their fields lazily, so re-run whenever the DOM grows.\n"
            "try {\n"
            "  new MutationObserver(function (muts) {\n"
            "    for (var i = 0; i < muts.length; i++) {\n"
            "      if (muts[i].addedNodes && muts[i].addedNodes.length) { maskFinancialInputs(); return; }\n"
            "    }\n"
            "  }).observe(document.body, { childList: true, subtree: true });\n"
            "} catch (e) {}\n\n"
            "// ── SERVICE WORKER REGISTRATION ──",
            'wire masker at boot')

    # version + notes
    s = sub(s, "const APP_VERSION = '1.41.1';", f"const APP_VERSION = '{VER}';", 'APP_VERSION')
    anchor = "const RELEASE_NOTES = [\n"
    entry = ("  {\n"
             f"    version: '{VER}',\n"
             f"    date: '{DATE_H}',\n"
             f"    name: '{NAME}',\n"
             "    whatsNew: [],\n"
             "    fixes: [\n"
             + "".join("      '" + n.replace("\\", "\\\\").replace("'", "\\'") + "',\n" for n in NOTES)
             + "    ]\n  },\n")
    return sub(s, anchor, anchor + entry, 'RELEASE_NOTES entry')

def sw(s):
    return sub(s, "CACHE_NAME = 'debtfree-1.41.1'", f"CACHE_NAME = 'debtfree-{VER}'", 'CACHE_NAME')

def vj(s):
    d = json.loads(s)
    d['version'] = VER; d['releaseDate'] = DATE_J; d['releaseName'] = NAME; d['notes'] = NOTES
    return json.dumps(d, indent=2, ensure_ascii=False) + '\n'

edit(sys.argv[1], dash); edit(sys.argv[2], sw); edit(sys.argv[3], vj)
