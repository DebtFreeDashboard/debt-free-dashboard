import sys, json
VER='1.43.0'; DH='September 16, 2026'; DJ='2026-09-16'
NAME='Money set aside on purpose'
NEW=[
 "Premium: sinking funds. Set money aside each month for the costs you know are coming \u2014 car repairs, insurance, the holidays \u2014 so the next one doesn\u2019t land on a credit card.",
 "Each fund can count toward your plan or just be tracked. A fund that counts is money not going to your debts, so your payoff dates account for it honestly rather than assuming that money was available.",
 "Funds with a target stop once they\u2019re full, and that money goes back to your debts from then on \u2014 your dates reflect that too."
]
def edit(p, fn):
    raw=open(p,'rb').read(); crlf=raw.count(b'\r\n')>0
    s=raw.decode('utf-8').replace('\r\n','\n'); s=fn(s)
    open(p,'wb').write((s.replace('\n','\r\n') if crlf else s).encode('utf-8'))
    print(f'  ok    {p} ({"CRLF" if crlf else "LF"})')
def dash(s):
    old="const APP_VERSION = '1.42.0';"
    assert s.count(old)==1, 'APP_VERSION'
    s=s.replace(old, f"const APP_VERSION = '{VER}';",1)
    a="const RELEASE_NOTES = [\n"
    assert s.count(a)==1
    e=("  {\n"+f"    version: '{VER}',\n"+f"    date: '{DH}',\n"+f"    name: '{NAME}',\n"
       +"    whatsNew: [\n"
       +"".join("      '"+n.replace("\\","\\\\").replace("'","\\'")+"',\n" for n in NEW)
       +"    ],\n    fixes: []\n  },\n")
    return s.replace(a,a+e,1)
def sw(s):
    old="CACHE_NAME = 'debtfree-1.42.0'"
    assert s.count(old)==1, 'CACHE_NAME'
    return s.replace(old, f"CACHE_NAME = 'debtfree-{VER}'",1)
def vj(s):
    d=json.loads(s); d['version']=VER; d['releaseDate']=DJ; d['releaseName']=NAME; d['notes']=NEW
    return json.dumps(d,indent=2,ensure_ascii=False)+'\n'
edit(sys.argv[1],dash); edit(sys.argv[2],sw); edit(sys.argv[3],vj)
