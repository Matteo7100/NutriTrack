# Collaborazione su GitHub
Codice, test, lockfile e docs/ sono condivisi nella repository NutriTrack.
node_modules/, cache, file .env e riferimenti sincronizzati sources/ sono esclusi.
La conversazione condivisa è separata: GitHub conserva le nostre note persistenti,
non aggiorna automaticamente un link alla chat.

## Per il secondo collaboratore
1. Accettare l'invito alla repository e copiarne l'URL dalla pagina GitHub.
2. Clonarla in una propria cartella e aprire quella cartella in VS Code.
3. Predisporre Node.js e pnpm (versione dichiarata nel package.json principale).
4. Dalla radice eseguire `pnpm --dir apps/api install --frozen-lockfile --store-dir .pnpm-store`.
5. Eseguire `pnpm check`: fase 1, due suite e nove test attesi.

Non copiare i percorsi del runtime Codex di un altro PC: le guide li riportano
solo per il terminale locale dell'autore. Il progetto usa dipendenze locali e lockfile.

## Piccoli incrementi
Prima di lavorare recuperare le modifiche remote; usare un branch per il proprio
incremento. Un commit salva una modifica con messaggio; una pull request permette
all'altro collaboratore di leggerla prima dell'integrazione. Coordinare gli interventi
sugli stessi file e aggiornare sempre notebook e registro incrementi.

## Stato del primo caricamento
Repository: https://github.com/Matteo7100/NutriTrack. Branch iniziale: main.
Primo snapshot: baseline documentale, ADR-001..024, configurazione fase 0 e resolver
temporale fase 1. Il caricamento viene verificato confrontando il commit locale
con il riferimento remoto. Nessuna fase applicativa successiva avviata.
