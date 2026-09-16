import sys, json
VER='1.42.0'; DH='September 16, 2026'; DJ='2026-09-16'
NAME='Nothing catches you out'
NEW=[
 "Due dates. Add the day of the month each account is due and a new Coming Up card shows what\u2019s close, with a one-tap way to log the payment right from it. Nothing is assumed \u2014 accounts you don\u2019t give a day to are simply left alone.",
 "Premium: recurring bills. Rent, utilities, insurance, subscriptions \u2014 add them with their due days and they appear alongside your debt payments in Coming Up, so you\u2019re looking at everything that\u2019s due in one place. Tick one off once you\u2019ve handled it.",
 "Monthly Money Plan. Set what you can put toward debts and bills each month, and see it beside what you\u2019ve actually committed. It\u2019s a check on your plan \u2014 it doesn\u2019t change your payoff date or any of your numbers."
]
def edit(p, fn):
    raw=open(p,'rb').read(); crlf=raw.count(b'\r\n')>0
    s=raw.decode('utf-8').replace('\r\n','\n'); s=fn(s)
    open(p,'wb').write((s.replace('\n','\r\n') if crlf else s).encode('utf-8'))
    print(f'  ok    {p} ({"CRLF" if crlf else "LF"})')
def dash(s):
    old="const APP_VERSION = '1.41.2';"
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
    old="CACHE_NAME = 'debtfree-1.41.2'"
    assert s.count(old)==1, 'CACHE_NAME'
    return s.replace(old, f"CACHE_NAME = 'debtfree-{VER}'",1)
def vj(s):
    d=json.loads(s); d['version']=VER; d['releaseDate']=DJ; d['releaseName']=NAME; d['notes']=NEW
    return json.dumps(d,indent=2,ensure_ascii=False)+'\n'
edit(sys.argv[1],dash); edit(sys.argv[2],sw); edit(sys.argv[3],vj)
