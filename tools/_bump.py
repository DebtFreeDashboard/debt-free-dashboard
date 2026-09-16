import sys
VER='1.41.0'; DATE_H='September 16, 2026'; DATE_J='2026-09-16'
NAME='See where every dollar goes'
NOTE_NEW=[
 'Premium: a full amortization schedule. For your whole plan or any single debt, every month shows what the payment covers in interest and how much actually comes off the balance.',
 'Premium: export to CSV. Take the month-by-month schedule, or just your debt list, into Excel, Numbers or Google Sheets and check the math yourself.'
]

def edit(path, fn):
    raw=open(path,'rb').read(); crlf=raw.count(b'\r\n')>0
    s=raw.decode('utf-8').replace('\r\n','\n')
    s2=fn(s)
    open(path,'wb').write((s2.replace('\n','\r\n') if crlf else s2).encode('utf-8'))
    print(f'  ok    {path} ({"CRLF" if crlf else "LF"})')

def dash(s):
    old="const APP_VERSION = '1.40.7';"
    assert s.count(old)==1, 'APP_VERSION anchor'
    s=s.replace(old, f"const APP_VERSION = '{VER}';",1)
    anchor="const RELEASE_NOTES = [\n"
    assert s.count(anchor)==1, 'RELEASE_NOTES anchor'
    entry = ("  {\n"
             f"    version: '{VER}',\n"
             f"    date: '{DATE_H}',\n"
             f"    name: '{NAME}',\n"
             "    whatsNew: [\n"
             + "".join(f"      {e!r},\n".replace("'", "'", 1) for e in [])
             + "".join("      '" + e.replace("\\","\\\\").replace("'","\\'") + "',\n" for e in NOTE_NEW)
             + "    ],\n    fixes: []\n  },\n")
    return s.replace(anchor, anchor+entry, 1)

def sw(s):
    old="CACHE_NAME = 'debtfree-1.40.7'"
    assert s.count(old)==1, 'CACHE_NAME anchor'
    return s.replace(old, f"CACHE_NAME = 'debtfree-{VER}'",1)

def vj(s):
    import json
    d=json.loads(s)
    d['version']=VER; d['releaseDate']=DATE_J; d['releaseName']=NAME; d['notes']=NOTE_NEW
    return json.dumps(d, indent=2, ensure_ascii=False)+'\n'

edit(sys.argv[1], dash); edit(sys.argv[2], sw); edit(sys.argv[3], vj)
