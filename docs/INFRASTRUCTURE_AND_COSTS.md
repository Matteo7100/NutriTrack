# Infrastruttura locale, provenienza e costi
Aggiornamento: 30 ottobre 2026. Nessun abbonamento o servizio cloud a pagamento attivato per NutriTrack.

## Da dove arriva PostgreSQL
compose.yaml richiede l'immagine pubblica `postgres:16-alpine` dalla [Docker Official Image su Docker Hub](https://hub.docker.com/_/postgres), mantenuta dalla PostgreSQL Docker Community.
Un'immagine è un pacchetto eseguibile contenente PostgreSQL e l'ambiente necessario; il container è la sua istanza in esecuzione. Alpine indica la distribuzione Linux usata. Il tag 16-alpine indica la famiglia PostgreSQL 16 e può ricevere aggiornamenti di manutenzione: non è un digest immutabile.

Con `docker compose up -d db`, Docker ha scaricato i layer pubblici e creato il container sul PC. Non è stata fornita una nuova credenziale di un registry privato. Docker Desktop può utilizzare le impostazioni già presenti sul PC; il download pubblico non richiede l'attivazione di un piano a pagamento.

PostgreSQL ascolta nel container sulla porta 5432; Compose espone solo 127.0.0.1:15432 sul PC. La porta inizialmente prevista 54329 non era utilizzabile su Windows ed è stata sostituita con 15432 dopo verifica. Non è stato creato un database remoto.
Il volume Docker nutritrack-data conserva i dati oltre la vita del container. Le credenziali del compose sono esclusivamente dimostrative, visibili nel progetto; non sono credenziali di un vostro servizio esterno. Non usare dati personali reali in questa configurazione demo.

## Pagamenti e licenze
- PostgreSQL e le librerie applicative scelte sono disponibili senza canoni per questa esecuzione locale.
- Docker Desktop ha licenza distinta: è gratuito per uso personale e didattico secondo le [condizioni ufficiali](https://docs.docker.com/desktop/setup/install/windows-install/); alcuni contesti aziendali richiedono un abbonamento. Non è interamente open source.
- Lo sviluppo con Codex è separato dall'applicazione e dipende dal piano dell'utente. NutriTrack non chiama API OpenAI e non richiede API key AI.
- Nessun hosting, dominio, database gestito, servizio email, storage cloud o provider auth esterno è stato attivato. La futura pubblicazione richiederà una scelta esplicita con valutazione dei costi.

## Spegnimento
Ctrl+C ferma il backend. `docker compose stop db` ferma il database preservando i dati. Riavviarlo con `docker compose up -d db`. Non rimuovere i volumi se si vogliono conservare le registrazioni.
