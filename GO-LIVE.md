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
| `PLATFORM_FEE_ADDRESS` | Adresse einer **zweiten neuen Wallet** (Plattform-Wallet für Rückkauf + Treasury) |
| `PLATFORM_SIGNER_SECRET_KEY` | Private Key dieser Plattform-Wallet (als „Sensitive“/Secret, nur Production) |
| `FEE_TREASURY_ADDRESS` | Adresse deiner Treasury-Wallet (nur die Adresse; am besten eine sichere Wallet, z. B. Hardware-Wallet) |
| `SEED_DEMO_DATA` | `false` |
| `APP_URL` | `https://makevyral.com` |

Für die Video-Plattformen kommen deren API-Keys dazu (siehe `.env.example`, Abschnitt „Social platforms“). Eine Plattform ohne Keys bleibt einfach geschlossen; die Seite sagt dann „opens soon“.

Danach: **Deployments → Redeploy**.

## 4. Einmalige Schritte im Admin-Bereich

Melde dich mit deiner Admin-Wallet an und öffne **Admin → Go live**. Oben siehst du eine Checkliste, was noch fehlt. Dann der Reihe nach:

1. **Create lookup table**: legt eine kleine Tabelle on-chain an, damit ein Launch samt gesperrtem Fee-Split in eine Transaktion passt.
2. **Run test**: baut einen kompletten Launch und testet ihn gegen pump.fun, ohne etwas zu senden. Muss „OK“ zeigen.
3. **Remove demonstration data**: löscht die Demo-Coins, -Videos und -Auszahlungen. Tippe dazu `REMOVE DEMO DATA` ein.

## 5. Den $VYRAL-Coin launchen

Gehe mit deiner Admin-Wallet auf **Launch** und setze das Häkchen **„This is the official $VYRAL coin“**. Sobald der Launch bestätigt ist, erscheint die Contract-Adresse oben im Header mit Copy-Button.

Wenn du ihn woanders launchst: **Admin → Overview → Official $VYRAL coin** und die Adresse dort eintragen.

## Wie das Geld fließt

- Jeder Coin wird auf pump.fun erstellt. In derselben Transaktion werden seine Creator Fees aufgeteilt und **on-chain gesperrt**: **45 %** an den Reward-Vault (Wettbewerb), **25 %** direkt an den Deployer, **30 %** an die Plattform-Wallet. Niemand kann das danach ändern, auch du nicht.
- Von allem, was auf der Plattform-Wallet ankommt, leitet die Seite automatisch **ein Drittel (= 10 % der Fees)** an deine Treasury weiter. Mit **zwei Dritteln (= 20 %)** kauft sie $VYRAL über Jupiter in kleinen Stücken (max. 0,5 SOL alle 10 Minuten, max. 1,5 % Preisbewegung pro Kauf) und **verbrennt** jeden gekauften Token. Bevor $VYRAL existiert, sammelt sich der Rückkauf-Anteil einfach an. Alles steht öffentlich auf der Seite **Buyback & burn** (`/burns`).
- Alle 15 Minuten löst die Seite die Auszahlung der Fees jedes Coins bei pump.fun aus. Das darf jeder, auch der Deployer über pump.fun selbst. Die Seite liest deshalb alle Eingänge im Vault und schreibt jeden Vault-Anteil dem richtigen Coin gut, egal wer die Auszahlung ausgelöst hat.
- An jedem Checkpoint (alle 3 oder 6 Stunden) bekommt das Video mit dem höchsten Viral Score (mindestens 500 Views) diesen Betrag in SOL auf seine Wallet. Gibt es noch kein berechtigtes Video, wird der Betrag zum nächsten Checkpoint mitgenommen.
- Eine Auszahlung über `PAYOUT_MAX_LAMPORTS` wird nicht automatisch gesendet. Sie erscheint unter **Admin → Payouts** als „Requires attention“. Du schickst den Betrag selbst aus dem Vault-Wallet (z. B. mit Phantom) und trägst dort bei **Settle** die Transaktions-Signatur ein. Die Seite prüft die Überweisung on-chain.
