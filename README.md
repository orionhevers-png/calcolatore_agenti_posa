# Pianificatore Posa — Longato

Sito per agenti e gestore: ogni agente inserisce le proprie offerte e vede la settimana di posa prevista;
il gestore vede tutto, modifica le impostazioni e scarica l'Excel.

* **Senza configurazione** il sito parte in *modalità demo* (dati solo nel browser): utile per provarlo.
* **In produzione** usa GitHub Pages (sito) + Supabase gratuito (login e database).

## Messa online (circa 15 minuti)

### 1. Supabase (login + database)
1. Crea un account su <https://supabase.com> e un nuovo progetto (piano Free).
2. **SQL Editor → New query**: incolla tutto `supabase/schema.sql` e premi **Run**.
3. **Authentication → Providers → Email**: lascia attivo, **disattiva "Allow new users to sign up"** (gli account li crei tu) e **"Confirm email"**.
4. **Authentication → Users → Add user**: crea per primo **te stesso** (il primo utente diventa automaticamente *gestore*), poi gli agenti (email + password). Spunta "Auto Confirm User".
5. **Project Settings → API**: copia *Project URL* e la chiave *anon public* (non è segreta, è pensata per stare nel sito).

### 2. Configura il sito
Apri `config.js` e incolla URL e chiave:

```js
window.APP_CONFIG = { SUPABASE_URL: "https://xxxx.supabase.co", SUPABASE_ANON_KEY: "eyJ..." };
```

### 3. GitHub Pages
Repository → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`. Dopo un minuto il sito è su `https://<utente>.github.io/<repo>/`.

## Come funziona
* **Privacy**: ogni agente vede solo le proprie offerte (regole di sicurezza nel database, non solo nell'interfaccia).
* **Slot**: calendario e Gantt tengono conto dell'occupazione di tutti, in forma anonima.
* **Conferma = congelamento**: una volta salvata, la posa non si sposta da sola. Se un'offerta viene eliminata lo slot si libera e il gestore vede in Panoramica le «pose anticipabili».
* **Impostazioni**: le capacità valgono dalla settimana scelta; tempi e parametri si applicano alle offerte nuove o modificate.
* **Salvataggi simultanei**: se due agenti prenotano lo stesso slot, il secondo viene ricalcolato in automatico.
* **Excel** (gestore): Cruscotto, Offerte, Gantt, Carico, Impostazioni, Tempi_Materiali. Contiene i valori calcolati.

## Da verificare
Ore per pezzo alluminio (segnaposto 1), date di chiusura, code iniziali.
