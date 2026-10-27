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

## Piano definitivo e offerte sospese (aggiornamento)

**Una tantum:** in Supabase → SQL Editor → New query, incolla il contenuto di `supabase/aggiornamento_piano_reale.sql` e premi Run. Poi ricarica il sito (Ctrl+F5).

- **Sito del gestore in tre sezioni.** «Piano definitivo» (petrolio, quella principale: panoramica, commesse, Gantt, carico), «Stime agenti» (ambra, solo consultazione) e «Impostazioni».
- **Piano definitivo, commesse (solo gestore).** Scrivi il numero offerta, il numero di commessa e la settimana di rilievo: il sistema calcola conferma ordine, acquisti, produzione e posa con gli stessi parametri delle Impostazioni. Ogni data si può modificare a mano (le successive si ricalcolano; svuota il campo per tornare all'automatico). Ogni commessa mostra composizione e tipologie (standard / fuori standard), ha un pannello note e un «OK» di approvazione. Il piano definitivo ha un proprio carico e non cambia le stime degli agenti. «Ricalcola tutto» riordina le commesse per settimana di rilievo.
- **Offerte confermate.** Quando il gestore assegna la commessa, l'offerta dell'agente mostra solo «Confermata» e il numero commessa; l'agente non può più modificarla né cancellarla.
- **Offerte sospese.** Senza commessa dopo 15 giorni (modificabile in Impostazioni) l'offerta passa nel riquadro «Offerte sospese» dell'agente, che può cancellarla (libera lo slot) o riprogrammarla (data di inserimento = oggi, nuova scelta della settimana di posa).

## Da verificare
Ore per pezzo alluminio (segnaposto 1), date di chiusura, code iniziali.

## Aggiornamento: schermate del piano definitivo

- **Commesse**: collegando un'offerta compare subito la composizione, correggibile prima di inserire. Sotto restano solo le commesse collegate negli ultimi 7 giorni.
- **Tutte le commesse**: elenco completo con rilievo, conferma ordine, acquisti, produzione e posa, con filtri combinabili (agente, stato, intervalli di rilievo e posa, composizione, confronto con la stima agente) e ricerca.
- **Gantt** definitivo in ordine di posa (cambiabile) con ricerca per commessa o cliente.
- **Ricalcola tutto** è rosso e chiede conferma.

## Composizione serramenti (aggiornamento)

- PVC: serramenti a **1, 2 o 3 ante**. Contano 1 foro, ma occupano 1, 2 o 3 di capacità del reparto PVC (capacità in *ante* a settimana).
- Alluminio: serramenti a **1 o 2 ante** (ore = ante × ore per anta). Portoncini PVC e **portoncini alluminio** distinti; questi ultimi usano le ore «per portoncino alluminio» (Impostazioni, default 4: da verificare).
- Le offerte già inserite restano valide: le vecchie «ante PVC / ante alluminio» sono lette come serramenti a 1 anta. Nessun aggiornamento del database.
- Per gli agenti il banner «Tempi indicativi» è più evidente.

## Due tipi di coda (Impostazioni)

- **Coda iniziale: primo slot da riempire.** Per ogni reparto una settimana fissa (es. 2026-W50) da cui il sistema comincia a riempire la capacità; prima è considerato occupato. Serve al passaggio dal vecchio programma e non scorre con le settimane. Vuoto = da oggi. Le vecchie «settimane di coda» vengono convertite nella settimana corrispondente al primo salvataggio.
- **Recupero ritardo di produzione.** Righe «reparto (o tutti) · dalla settimana · N settimane» (di norma 1): gli slot di quelle settimane sono chiusi ai nuovi ordini, così la produzione recupera il ritardo. Nel Carico compaiono come «Recupero ritardo»; per gli agenti risultano chiusi. Le offerte già calcolate non si spostano.
