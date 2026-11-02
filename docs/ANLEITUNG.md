# Mahlzeit auf GitHub Pages + Supabase (kostenlos)

1. **Supabase**: auf supabase.com ein kostenloses Projekt anlegen (Region Frankfurt).
   - SQL Editor: erst `supabase/1_setup.sql`, dann `supabase/2_daten.sql` einfügen und ausführen.
   - Authentication > Users > "Add user": zwei Nutzer (Thomas, Caro) mit E-Mail + Passwort, "Auto Confirm" an.
   - Authentication > Sign In / Providers: "Allow new users to sign up" ausschalten (sonst kann sich jeder registrieren).
   - Project Settings > API: "Project URL" und "anon public key" kopieren.
2. **`docs/config.js`**: URL und Key eintragen.
3. **GitHub**: neues Repository, Inhalt dieses Ordners hochladen, Settings > Pages > Branch `main`, Ordner `/docs`.
4. **iPhone**: Adresse in Safari öffnen > Teilen > Zum Home-Bildschirm.
