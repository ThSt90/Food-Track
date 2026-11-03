#!/usr/bin/env python3
"""Erzeugt 20 Rezepte (Quelle: lecker.de, Angaben aus dem JSON-LD der Seite) als SQL + Bilder.
Nur Werte aus der Quelle; Schritte sind eigene, gekürzte Formulierungen."""
import json, re, subprocess, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TR = Path("/root/.claude/projects/-home-claude/c2054e4c-8c36-53fa-8e0b-b368a4719029/tool-results")
OUT = ROOT / "docs" / "img"; OUT.mkdir(parents=True, exist_ok=True)

# slug, titel, kategorie, kcal, protein, kohlenhydrate, fett, portionen, minuten, tags, bilddatei, (links, rechts)
R = [
 ("kartoffel-spinat-topf-62385","Kartoffel-Spinat-Topf","main",515,13,55,27,4,35,"vegetarisch, kartoffel","blob-1793655193842-t00mw3",(100,700)),
 ("gemuese-kartoffel-curry-70868","Gemüse-Kartoffel-Curry","main",452,14,35,30,4,30,"vegetarisch, kartoffel","blob-1793655232853-tn5bog",(80,560)),
 ("gefuellte-kartoffeln-aus-dem-ofen-84218","Gefüllte Kartoffeln aus dem Ofen","main",539,19,43,32,4,50,"vegetarisch, kartoffel","blob-1793655232853-38sngr",(80,560)),
 ("kartoffeln-mit-quark-75039","Kartoffeln mit Kräuterquark","main",320,23,53,0,4,25,"vegetarisch, kartoffel, schnell, proteinreich","blob-1793655232853-9papxt",(80,560)),
 ("linsen-kartoffel-curry-suppe-73919","Linsen-Kartoffel-Curry-Suppe","main",669,25,81,26,4,75,"vegetarisch, kartoffel, suppe","blob-1793655232853-w2furu",(80,560)),
 ("lange-satt-gemuesepasta-127364","„Lange satt“-Gemüsepasta","main",597,24,57,30,4,20,"vegetarisch, pasta, vollkorn, schnell","blob-1793655232853-x9haym",(80,560)),
 ("vollkorn-pasta-mit-garnelen-und-brokkolini-129348","Vollkorn-Pasta mit Garnelen und Brokkolini","main",432,26,51,14,4,25,"pasta, vollkorn, proteinreich","blob-1793655232853-fyn1dn",(80,560)),
 ("vollkornnudeln-mit-kirschtomaten-35005","Vollkornnudeln mit Kirschtomaten","main",225,8,34,6,1,15,"vegetarisch, pasta, vollkorn, schnell","blob-1793655250817-ojg59s",(80,560)),
 ("spaghetti-mit-gemuese-tomatensosse-12046","Spaghetti mit Gemüse-Tomatensoße","main",402,15,58,11,4,30,"vegetarisch, pasta","blob-1793655250817-dqlix5",(80,560)),
 ("vollkornpasta-advanced-nourishment-74040","Vollkornpasta „Advanced Nourishment“","main",574,42,58,19,4,30,"pasta, vollkorn, proteinreich","blob-1793655250817-v8wxqb",(80,560)),
 ("gemuese-reis-pfanne-mit-joghurt-dip-44196","Gemüse-Reis-Pfanne mit Joghurt-Dip","main",470,10,48,26,4,30,"vegetarisch, reis","blob-1793655250817-pthb15",(80,560)),
 ("einfacher-paprika-linsen-reis-aus-dem-ofen-81367","Paprika-Linsen-Reis aus dem Ofen","main",417,16,59,12,4,50,"vegetarisch, reis, ofen","blob-1793655250817-t05xgm",(80,560)),
 ("bratreis-mit-gemuese-und-ei-70916","Bratreis mit Gemüse und Ei","main",564,16,85,17,4,30,"vegetarisch, reis","blob-1793655250818-zh25jc",(80,560)),
 ("gemuese-paella-10566","Gemüse-Paella","main",439,11,66,14,4,30,"vegetarisch, reis","blob-1793655268833-udw4z3",(80,560)),
 ("ruckzuck-reis-mit-moehre-und-tofu-132031","Ruckzuck-Reis mit Möhre und Tofu","main",436,22,56,13,4,20,"vegetarisch, reis, schnell, proteinreich","blob-1793655268834-liwn3e",(80,560)),
 ("klassisches-porridge-62688","Klassisches Porridge","fruehstueck",220,9,29,7,1,10,"vegetarisch, schnell, porridge","blob-1793655268834-t183lx",(80,560)),
 ("buchweizen-porridge-mit-beeren-67424","Buchweizen-Porridge mit Beeren","fruehstueck",444,15,52,19,4,30,"vegetarisch, porridge","blob-1793655268834-axobh4",(80,560)),
 ("herzhaftes-porridge-mit-feta-79833","Herzhaftes Porridge mit Feta","fruehstueck",408,17,35,22,4,25,"porridge","blob-1793655268834-mkfeux",(80,560)),
 ("power-porridge-aus-dem-ofen-75341","Apfel-Porridge aus dem Ofen","fruehstueck",330,9,31,14,4,50,"vegetarisch, porridge, ofen","blob-1793655268834-6gi4cf",(80,560)),
 ("waermendes-rueblimuesli-sonnengruss-73981","Wärmendes Rüblimüsli „Sonnengruß“","fruehstueck",547,18,79,17,2,20,"vegetarisch, porridge","blob-1793655268834-4lqbt8",(80,560)),
]
ING = json.load(open(ROOT / "tools" / "lecker_batch_data.json", encoding="utf-8"))

UNITS = {"g":"g","kg":"kg","ml":"ml","l":"l","EL":"EL","TL":"TL","Dose":"Dose","Bund":"Bund","Packungen":"Packung","Packung":"Packung","Stiele":"Stiel","Stiel":"Stiel","Stange":"Stange","Scheiben":"Scheibe","Beet":"Beet"}
def num(s):
    s = s.replace(",", ".")
    if "/" in s:
        a, b = s.split("/"); return float(a) / float(b)
    return float(s)
def parse(raw):
    raw = re.sub(r"\s+", " ", raw.replace("­", "")).strip()
    m = re.match(r"^(?:ca\. )?(\d+[.,]?\d*(?:/\d+)?)(?:-\d+[.,]?\d*)? ?(.*)$", raw)
    if not m: return {"amount": None, "unit": None, "name": raw, "raw": raw, "foodId": None}
    amount = num(m.group(1)); rest = m.group(2)
    mu = re.match(r"^(g|kg|ml|l|EL|TL|Dose\(n\)|Dose|Bund|Packungen|Stiele|Stiel/e|Stange|dünne Scheiben|Beet)\b ?(.*)$", rest)
    unit = None
    if mu:
        u = mu.group(1); unit = {"Dose(n)":"Dose","Stiel/e":"Stiel","dünne Scheiben":"Scheibe"}.get(u, UNITS.get(u, u)); rest = mu.group(2)
    if unit in ("Dose","Packung","Bund"): rest = re.sub(r"^\((?:ca\. |à )?[^)]*\) ?", "", rest)
    return {"amount": amount if amount != int(amount) else int(amount), "unit": unit, "name": rest or raw, "raw": raw, "foodId": None}

def q(s): return "'" + s.replace("'", "''") + "'"
node = r"""const L=require(process.argv[1]);process.stdout.write(JSON.stringify(process.argv.slice(2).map(t=>L.norm(t))))"""
titles = [r[1] for r in R]
keys = json.loads(subprocess.check_output(["node", "-e", node, str(ROOT / "src" / "logic.js")] + titles))
now = "2026-11-02T21:30:00.000Z"
rows = []
for (slug, title, cat, kcal, pro, kh, fat, serv, mins, tags, blob, (l, r_)), key in zip(R, keys):
    d = ING[slug]
    im = Image.open(TR / f"mcp-remote-devices-{blob}.jpg").convert("RGB")
    im = im.crop((l, 0, r_, im.height)).resize((min(im.width, 600),) * 2 if False else (r_ - l, im.height))
    side = min(im.size); im = im.crop(((im.width - side) // 2, 0, (im.width - side) // 2 + side, side))
    if side > 600: im = im.resize((600, 600), Image.LANCZOS)
    img_id = "lk-" + slug.rsplit("-", 1)[0][:40].strip("-") + "-" + slug.rsplit("-", 1)[1]
    im.save(OUT / f"{img_id}.jpg", quality=84, optimize=True)
    doc = {"category": cat, "createdAt": now, "effort": None, "image": img_id, "importId": None,
           "ingredients": [parse(x) for x in d["ing"]], "instructions": "\n".join(d["steps"]),
           "nutrition": {"basis": "portion", "carbs": kh, "fat": fat, "kcal": kcal, "protein": pro, "quality": "original"},
           "prepMinutes": mins, "servings": serv, "source": "https://www.lecker.de/" + slug + ".html",
           "tags": tags, "title": title, "titleKey": key, "updatedAt": now, "version": 1}
    rows.append((f"recipes/lk-{slug}", "recipes", doc))
sql = ["-- 20 gesunde Rezepte (Quelle: lecker.de; Nährwerte je Portion laut Quelle). Mehrfaches Ausführen ist unbedenklich.",
       "insert into public.docs (path, coll, data) values",
       ",\n".join(f"({q(p)}, {q(c)}, {q(json.dumps(d, ensure_ascii=False))}::jsonb)" for p, c, d in rows),
       "on conflict (path) do update set data = excluded.data;"]
(ROOT / "supabase" / "3_rezepte_lecker.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
print(len(rows), "Rezepte,", len(list(OUT.glob("lk-*.jpg"))), "Bilder")
