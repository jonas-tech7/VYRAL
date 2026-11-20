# VYRAL live schalten

Diese Anleitung schaltet die Seite von der Demo auf echtes Launchen, Traden und echte Auszahlungen um. Alles passiert in Vercel und im Admin-Bereich der Seite, du brauchst nichts lokal.

## 1. Reward-Vault anlegen (Auszahlungs-Wallet)

1. Lege in Phantom ein **neues, eigenes Wallet** nur für VYRAL an. Nimm nicht dein persönliches Wallet.
2. Notiere die Adresse. Das ist `FEE_VAULT_ADDRESS`.
3. Exportiere den Private Key (Phantom → Einstellungen → Private Key anzeigen). Das ist `PAYOUT_SIGNER_SECRET_KEY`.
4. Schicke etwa **0,05 SOL** darauf. Davon werden die Netzwerkgebühren und die einmalige Lookup-Table (≈ 0,01 SOL) bezahlt.

In dieses Wallet fließt automatisch die Competition-Hälfte der Creator Fees, und von dort werden die Creators bezahlt. Halte nur so viel darin, wie gerade für Auszahlungen gebraucht wird.

## 2. Solana-RPC besorgen

Die öffentlichen Solana-Server sind für eine Live-Seite zu langsam und limitiert. Lege bei [Helius](https://www.helius.dev) (es gibt einen kostenlosen Plan) einen Account an und kopiere die Mainnet-RPC-URL.

## 3. Variablen in Vercel setzen

Vercel → dein Projekt → Settings → Environment Variables. Setze oder ändere:

| Variable | Wert |
| --- | --- |
| `SOLANA_CLUSTER` | `mainnet-beta` |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` |
| `SOLANA_RPC_URL` | deine Helius-URL |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | deine Helius-URL (am besten ein zweiter Key nur für den Browser) |
| `LAUNCH_PROVIDER` | `pumpfun` |
| `FEE_PROVIDER` | `pumpfun` |
| `PAYOUT_EXECUTOR` | `solana` |
| `PRICE_PROVIDER` | `jupiter` |
| `SOCIAL_PROVIDER` | `live` |
| `FEE_VAULT_ADDRESS` | Adresse aus Schritt 1 |
| `PAYOUT_SIGNER` | `env-keypair` |
| `PAYOUT_SIGNER_SECRET_KEY` | Private Key aus Schritt 1 (als „Sensitive“ markieren) |
| `PAYOUT_ALLOW_HOT_WALLET` | `true` |
| `PAYOUT_MAX_LAMPORTS` | `5000000000` (= 5 SOL; größere Auszahlungen gehen nicht automatisch raus, siehe unten) |
| `SEED_DEMO_DATA` | `false` |
| `APP_URL` | `https://makevyral.com` |

Für die Video-Plattformen kommen deren API-Keys dazu (siehe `.env.example`, Abschnitt „Social platforms“). Eine Plattform ohne Keys bleibt einfach geschlossen; die Seite sagt dann „opens soon“.

Danach: **Deployments → Redeploy**.

## 4. Einmalige Schritte im Admin-Bereich

Melde dich mit deiner Admin-Wallet an und öffne **Admin → Go live**. Oben siehst du eine Checkliste, was noch fehlt. Dann der Reihe nach:

1. **Create lookup table**: legt eine kleine Tabelle on-chain an, damit ein Launch samt gesperrtem 50/50-Split in eine Transaktion passt.
2. **Run test**: baut einen kompletten Launch und testet ihn gegen pump.fun, ohne etwas zu senden. Muss „OK“ zeigen.
3. **Remove demonstration data**: löscht die Demo-Coins, -Videos und -Auszahlungen. Tippe dazu `REMOVE DEMO DATA` ein.

## 5. Den $VYRAL-Coin launchen

Gehe mit deiner Admin-Wallet auf **Launch** und setze das Häkchen **„This is the official $VYRAL coin“**. Sobald der Launch bestätigt ist, erscheint die Contract-Adresse oben im Header mit Copy-Button.

Wenn du ihn woanders launchst: **Admin → Overview → Official $VYRAL coin** und die Adresse dort eintragen.

## Wie das Geld fließt

- Jeder Coin wird auf pump.fun erstellt. In derselben Transaktion werden seine Creator Fees **50/50** aufgeteilt und **on-chain gesperrt**: 50 % an den Reward-Vault, 50 % direkt an den Deployer. Niemand kann das danach ändern, auch du nicht.
- Alle 15 Minuten löst die Seite die Auszahlung der Fees jedes Coins bei pump.fun aus. Das darf jeder, auch der Deployer über pump.fun selbst. Die Seite liest deshalb alle Eingänge im Vault und schreibt jeden Vault-Anteil dem richtigen Coin gut, egal wer die Auszahlung ausgelöst hat.
- An jedem Checkpoint (alle 3 oder 6 Stunden) bekommt das Video mit dem höchsten Viral Score (mindestens 500 Views) diesen Betrag in SOL auf seine Wallet. Gibt es noch kein berechtigtes Video, wird der Betrag zum nächsten Checkpoint mitgenommen.
- Eine Auszahlung über `PAYOUT_MAX_LAMPORTS` wird nicht automatisch gesendet. Sie erscheint unter **Admin → Payouts** als „Requires attention“. Du schickst den Betrag selbst aus dem Vault-Wallet (z. B. mit Phantom) und trägst dort bei **Settle** die Transaktions-Signatur ein. Die Seite prüft die Überweisung on-chain.
