# Gjurmimi dhe verifikimi i faturave të biznesit

## Dokumentacioni teknik i projektit

**Lënda:** Teknologjitë Blockchain  
**Niveli:** Master  
**Projekti:**  Gjurmimi dhe verifikimi i faturave të biznesit

**Ekipi:** Anjeza Sfishta & Erza Merovci & Fortesa Cena 



## Përmbledhje

Ky projekt trajton regjistrimin dhe gjurmimin e faturave të biznesit përmes një aplikacioni të decentralizuar. Sistemi regjistron në blockchain hash-in SHA-256 të dokumentit PDF, adresat e palëve, shumën e faturës, monedhën dhe referencën opsionale të metadata-s. Dokumenti PDF nuk vendoset në blockchain. Përmes hash-it, përdoruesi mund të kontrollojë nëse kopja që disponon përputhet me dokumentin e regjistruar.

Zgjidhja përbëhet nga dy kontrata inteligjente të lidhura (`InvoiceRegistry` dhe `InvoiceWorkflow`), një ndërfaqe React, integrimi me MetaMask dhe një API REST me Node.js/Express për indeksimin e eventeve. Kontratat ruajnë statusin dhe historikun e veprimeve, ndërsa API-ja ofron lexime të përshtatshme për aplikacionin. Testet automatike verifikojnë rregullat e procesit, autorizimin dhe rastet e pavlefshme.

**Fjalë kyçe:** blockchain, kontratë inteligjente, faturë, SHA-256, auditim, dApp, Sepolia.

> **Sqarim për rrjetet:** Testimi praktik i aplikacionit, integrimeve dhe rrjedhave të faturave është kryer në Sepolia. Hardhat Network përdoret veçmas si mjedis lokal për ekzekutimin e 35 testeve automatike të kontratave me komandën `npm test`.

## 1. Hyrje dhe përkufizimi i problemit

Faturat kalojnë nëpër disa faza, nga lëshimi deri te pranimi, kontestimi ose pagesa. Kur dokumentet dhe ndryshimet e statusit menaxhohen vetëm përmes sistemeve të centralizuara, palët mund ta kenë të vështirë të provojnë se cili dokument është regjistruar dhe kur është ndryshuar statusi i tij.

Projekti demonstron se si një regjistër publik dhe i pandryshueshëm mund të përdoret për të ruajtur gjurmën e auditimit, pa publikuar përmbajtjen e vetë dokumentit. Blockchain-i nuk e vërteton ligjërisht faturën dhe nuk provon se pagesa bankare është kryer; ai dokumenton vetëm veprimet e regjistruara në kontratë.

### 1.1 Qëllimi

Qëllimi është ndërtimi i një prototipi funksional që mundëson regjistrimin e një fature, verifikimin e integritetit të dokumentit dhe ndjekjen e statusit të tij nga palët e autorizuara.

### 1.2 Objektivat

- Të ruhen në blockchain identifikuesit dhe hash-i i dokumentit, pa ruajtur PDF-në.
- Të zbatohen rregulla për rolet dhe kalimet e lejuara të statusit.
- Të ruhet një histori e auditueshme për çdo ndryshim statusi.
- Të ofrohet ndërfaqe me pesë pamje funksionale dhe integrim me MetaMask.
- Të indeksohen eventet e kontratave përmes një API-je REST.
- Të verifikohen kërkesat me teste automatike dhe demonstrim lokal.

## Pamje nga aplikacioni

Pamjet më poshtë paraqesin përmbledhjen e faturave, formularin e regjistrimit me parapamjen PDF, historikun e ciklit jetësor dhe ndërfaqen e verifikimit.

<table>
  <tr>
    <td align="center"><strong>Përmbledhja</strong><br><img src="docs/screenshots/01-permbledhje.png" alt="Paneli i përmbledhjes me statistika, grafik dhe faturat" width="100%"></td>
    <td align="center"><strong>Regjistrimi i faturës</strong><br><img src="docs/screenshots/02-regjistro-fature.png" alt="Formulari i regjistrimit të faturës dhe parapamja PDF" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>Historia e faturës</strong><br><img src="docs/screenshots/03-historia-fatures.png" alt="Detajet dhe historia e auditimit për faturën INV-0001" width="100%"></td>
    <td align="center"><strong>Verifikimi i PDF-së</strong><br><img src="docs/screenshots/04-verifikimi-pdf.png" alt="Ndërfaqja e verifikimit të PDF-së dhe historiku i rezultateve" width="100%"></td>
  </tr>
</table>

## 2. Kërkesat dhe kufiri i projektit

Në fushëveprimin e zgjidhjes përfshihen:

1. Dy kontrata inteligjente të ndërlidhura.
2. Role të dallueshme dhe validime të autorizimit.
3. Gjashtë statuse të faturës dhe historik i ndryshimeve.
4. Evente blockchain-i për regjistrimin dhe veprimet e procesit.
5. Pesë pamje të dApp-it: përmbledhja, regjistrimi, historia, veprimet dhe verifikimi.
6. API REST për indeksimin dhe leximin e eventeve.
7. Teste automatike, përfshirë kërkesa të paautorizuara dhe kalime të pavlefshme.

PDF-ja e faturës dhe metadata ruhen off-chain në IPFS përmes Pinata. Backend-i mban JWT-në e Pinata-s dhe ngarkon PDF-në bashkë me një JSON që përmban CID-në dhe hash-in SHA-256; blockchain-i ruan hash-in dhe URI-në e metadata-s. Përmbajtja e IPFS është publike dhe nuk duhet përdorur për dokumente konfidenciale apo të dhëna personale.

## 3. Arkitektura e sistemit

```text
┌──────────────────────┐      ┌─────────────────────────────┐
│ React dApp           │─────▶│ MetaMask                    │
│ pesë pamje           │      │ nënshkrimi i transaksioneve │
└──────────┬───────────┘      └──────────────┬──────────────┘
           │ ethers.js                       │
           │ leximet/ngarkimet                │ transaksionet
           ▼                                  ▼
┌──────────────────────┐      ┌─────────────────────────────┐
│ API REST             │─────▶│ Pinata / IPFS               │
│ Node.js / Express    │ upload│ PDF dhe JSON metadata       │
│ indeksues në memorie │      └─────────────────────────────┘
└──────────┬───────────┘
           │ evente
           ▼
┌─────────────────────────────┐
│ Hardhat / Sepolia           │
│ InvoiceRegistry             │
│ InvoiceWorkflow             │
└─────────────────────────────┘

PDF dhe metadata: IPFS (publike)
Hash SHA-256, palët dhe historiku i statusit: në blockchain
```

### 3.1 Përbërësit

| Përbërësi | Përgjegjësia |
|---|---|
| `InvoiceRegistry` | Regjistron faturat, adresat e palëve, hash-in, shumën, monedhën dhe URI-në opsionale. |
| `InvoiceWorkflow` | Zbaton kalimet e statusit dhe ruan historikun me autorin, kohën dhe shënimin. |
| Frontend React | Ofron pamjet e përdoruesit, llogarit hash-in e PDF-së dhe lexon kontratat. |
| MetaMask | Jep llogarinë aktive dhe nënshkruan transaksionet e përdoruesit. |
| API Express | Indekson eventet, pranon PDF-në dhe publikon PDF/metadata në Pinata/IPFS. |
| Hardhat / Sepolia | Rrjetet për zhvillim lokal dhe demonstrim testues. |

### 3.2 Rolet

- **Administratori:** deployer-i i kontratës së regjistrit; konfiguron lidhjen me workflow-n dhe autorizon auditorët.
- **Biznesi / lëshuesi:** regjistron faturën dhe e dërgon te klienti.
- **Klienti / pranuesi:** pranon faturën, hap kontestim ose shënon statusin si të paguar.
- **Auditori:** mund të autorizohet nga administratori. Regjistri është publik, prandaj auditori nuk ka privilegj të veçantë për lexim dhe nuk mund të ndryshojë statusin.

Thirrjet për ndryshimin e statusit kontrollojnë në kontratë adresën e palës përkatëse. Asnjë rol nuk mund të ndryshojë një faturë që nuk i përket.

### 3.3 Modeli i të dhënave

Regjistrimi i faturës përmban:

| Fusha | Përshkrimi |
|---|---|
| `id` | Identifikues numerik, unik për kontratën. |
| `issuer` | Adresa blockchain e biznesit lëshues. |
| `recipient` | Adresa blockchain e klientit. |
| `documentHash` | Hash 32-bajtësh SHA-256 i PDF-së. |
| `amount` | Shuma në njësi me dy shifra dhjetore, e ruajtur si numër i plotë. |
| `currency` | Kodi i monedhës, për shembull `EUR`. |
| `metadataURI` | URI IPFS e JSON metadata-s që përmban URI-në e PDF-së dhe hash-in SHA-256. |
| `createdAt` | Koha e regjistrimit në blockchain. |

Për çdo ndryshim statusi regjistrohen statusi i ri, adresa që kreu veprimin, koha dhe një shënim.

### 3.4 Modeli i procesit

Statuset janë `Registered`, `Sent`, `Accepted`, `Disputed`, `Paid` dhe `Cancelled`.

```text
Registered ──biznesi──▶ Sent ──klienti──▶ Accepted ──klienti──▶ Paid
                           │
                           └──klienti──▶ Disputed ──klienti──▶ Accepted

Registered / Sent / Disputed ──biznesi ose klienti──▶ Cancelled
```

Pagesa është status demonstrues: kontratat nuk transferojnë fonde. Anulimi lejohet vetëm para statusit `Paid`.

## 4. Implementimi teknik

### 4.1 Kontratat inteligjente

`InvoiceRegistry` dhe `InvoiceWorkflow` implementohen në Solidity 0.8.24. Regjistri thërret workflow-n kur krijohet faturë, ndërsa workflow-ja lexon të dhënat e palëve nga regjistri para se të lejojë ndryshimin e statusit.

Kontratat emetojnë nëntë lloje eventesh: `InvoiceRegistered`, `StatusChanged`, `AuditorUpdated`, `WorkflowConfigured`, `InvoiceSent`, `InvoiceAccepted`, `InvoiceDisputed`, `InvoicePaid` dhe `InvoiceCancelled`.

### 4.2 Hash-i dhe verifikimi i dokumentit

Frontend-i lexon bajtet e PDF-së dhe llogarit SHA-256 në shfletues. Hash-i ruhet si vlerë 32-bajtëshe në kontratë. Gjatë verifikimit, aplikacioni llogarit hash-in e dokumentit të zgjedhur dhe e krahason me vlerën e regjistruar. Ndryshimi i dokumentit prodhon hash tjetër dhe krahasimi dështon.

Verifikimi provon përputhjen e bajteve me hash-in e regjistruar; nuk provon origjinën, përmbajtjen ligjore ose vërtetësinë e palëve.

### 4.3 API-ja

Backend-i përdor Express dhe ethers.js për të lexuar eventet në blloqe dhe për t’i ofruar përmes endpoint-eve:

| Metoda | Endpoint | Qëllimi |
|---|---|---|
| `GET` | `/api/health` | Gjendja e API-së dhe e lidhjes me rrjetin. |
| `GET` | `/api/invoices` | Faturat e indeksuara nga eventet e regjistrimit. |
| `GET` | `/api/events` | Eventet e ndryshimit të statusit. |
| `GET` | `/api/invoices/:id/history` | Historiku i një fature sipas identifikuesit. |
| `GET` | `/api/addresses/:address/invoices` | Faturat ku adresa është lëshues ose pranues. |

Indeksi aktual mbahet në memorie dhe rindërtohet nga eventet pas rinisjes së backend-it. Për këtë arsye API-ja është indeksues ndihmës; gjendja autoritative ruhet në blockchain.

## 5. Struktura e repository-t

```text
contracts/                 Kontratat Solidity
test/                      Testet automatike të kontratave
scripts/deploy.js          Deploy lokal dhe Sepolia
scripts/seed-demo.js       Të dhënat lokale demonstrative
frontend/                  Aplikacioni React dhe konfigurimi Vite
backend/                   API REST dhe indeksuesi i eventeve
demo/documents/             PDF-të e krijuara për demonstrim lokal
deployments/                Adresat e kontratave pas deploy-it
README.md                   Dokumentacioni teknik
```

## 6. Instalimi dhe ekzekutimi lokal

### 6.1 Parakushtet

- Node.js 20 ose më i ri dhe npm.
- MetaMask për nënshkrimin e transaksioneve nga shfletuesi.
- Windows PowerShell, terminal ose mjedis ekuivalent.

### 6.2 Instalimi dhe testimi

Nga rrënja e projektit ekzekutoni:

```powershell
npm install
npm run compile
npm test
```

Paketa aktuale përmban 35 teste automatike të kontratave, përfshirë testet e autorizimit, validimeve, eventeve dhe kalimeve të statusit.

### 6.3 Nisja e rrjetit dhe deploy-i lokal

Në terminalin e parë nisni rrjetin:

```powershell
npm run node
```

Në terminalin e dytë bëni deploy:

```powershell
npm run deploy:local
```

Adresat dhe identifikuesi i rrjetit shënohen në `deployments/localhost.json`.

Krijoni `frontend/.env.local` dhe vendosni adresat e kontratave nga skedari i deploy-it:

```dotenv
VITE_REGISTRY_ADDRESS=0x...
VITE_WORKFLOW_ADDRESS=0x...
VITE_API_URL=http://localhost:3001
VITE_RPC_URL=http://127.0.0.1:8545
VITE_CHAIN_ID=31337
```

Kopjoni `backend/.env.example` në `backend/.env` dhe plotësoni:

```dotenv
PORT=3001
RPC_URL=http://127.0.0.1:8545
REGISTRY_ADDRESS=0x...
WORKFLOW_ADDRESS=0x...
DEPLOYMENT_BLOCK=0
CORS_ORIGIN=http://localhost:5173
PINATA_JWT=vendosni_jwt_e_pinata_s
```

Krijoni një JWT me leje ngarkimi në Pinata dhe mbajeni vetëm në `backend/.env`; mos e vendosni në frontend, repository ose blockchain. Regjistrimi ngarkon PDF-në (deri në 10 MB) dhe JSON metadata para se të dërgojë transaksionin. Nëse transaksioni refuzohet pas ngarkimit, përmbajtja mund të mbetet e pin-uar në IPFS.

Nisni shërbimet në terminale të ndara:

```powershell
npm run backend:dev
npm run frontend:dev
```

Ndërfaqja bëhet e disponueshme në `http://localhost:5173`. Për të nënshkruar veprime lokale, konfiguroni rrjetin Hardhat në MetaMask me RPC `http://127.0.0.1:8545` dhe chain ID `31337`. Llogaritë e Hardhat-it janë vetëm për testim lokal dhe nuk duhet përdorur çelësi i tyre në Sepolia ose mainnet.

### 6.4 Përgatitja e të dhënave demonstrative

Në rrjetin lokal të sapo deploy-uar, vendosni adresat në sesionin PowerShell dhe ekzekutoni seed-in. Skripti lexon `PINATA_JWT` nga `backend/.env`, ngarkon pesë PDF sintetike dhe metadata-n e tyre në Pinata, pastaj regjistron URI-të në kontratë:

```powershell
$env:REGISTRY_ADDRESS="0x..."
$env:WORKFLOW_ADDRESS="0x..."
npm run demo:seed -- --network localhost
```

Skripti krijon pesë PDF sintetike në `demo/documents/` dhe regjistron pesë fatura me metadataURI IPFS. Ai përgatit tri rrjedha të dallueshme: fatura #1 dërgohet, pranohet dhe paguhet; #2 dërgohet dhe kontestohet; #3 dërgohet dhe pranohet. Për demonstrimin e verifikimit:

1. Verifikoni faturën #1 me `invoice-001.pdf`; hash-i duhet të përputhet.
2. Verifikoni të njëjtën faturë me `invoice-001-altered.pdf`; hash-i duhet të mos përputhet.
3. Verifikoni faturën #3 me `invoice-003.pdf`; hash-i duhet të përputhet.

Seed-i mund të ekzekutohet vetëm mbi një deploy pa fatura ekzistuese dhe përdor llogari të ndara të Hardhat-it për biznesin dhe klientin; është për demonstrim lokal, jo për Sepolia. Për një demonstrim të ri, nisni rrjet lokal të pastër, bëni deploy përsëri dhe pastaj ekzekutoni seed-in. PDF-të janë të dhëna sintetike dhe nuk përmbajnë dokumente reale.

## 7. Deploy dhe testimi në Sepolia

Kontratat `InvoiceRegistry` dhe `InvoiceWorkflow` janë deploy-uar dhe aplikacioni është testuar në rrjetin testues Sepolia. Për arsye sigurie, URL-ja private RPC, çelësat, të dhënat e llogarive dhe konfigurimet lokale nuk përfshihen në këtë dokument ose në repository.

Për ta përsëritur deploy-in, përdorni një llogari dhe fonde testuese:

1. Kopjoni `.env.example` në `.env`.
2. Plotësoni `SEPOLIA_RPC_URL` dhe `DEPLOYER_PRIVATE_KEY`. Mos e komitoni skedarin `.env`.
3. Siguroni Sepolia ETH përmes një faucet-i të përshtatshëm.
4. Ekzekutoni:

```powershell
npm run deploy:sepolia
```

5. Përdorni adresat e krijuara te `deployments/sepolia.json` për konfigurimin e frontend-it dhe backend-it. Vendosni `VITE_CHAIN_ID=11155111` dhe `RPC_URL` të rrjetit Sepolia.
6. Rinisni frontend-in dhe backend-in, lidhni MetaMask me Sepolia dhe kryeni transaksione vetëm me llogari testuese.

### 7.1 Rezultatet e testimit në Sepolia

Në demonstrimin e realizuar u regjistruan pesë fatura dhe u provuan fazat kryesore të ciklit jetësor:

| Fatura | Statusi përfundimtar |
|---|---|
| `INV-0001` | E paguar (`Paid`) |
| `INV-0002` | E anuluar (`Cancelled`), pas testimit të kontestimit dhe anulimit |
| `INV-0003` | E pranuar (`Accepted`) |
| `INV-0004` | E dërguar (`Sent`) |
| `INV-0005` | E regjistruar (`Registered`) |

Gjatë testimit u krye deploy-i i kontratave, lidhja e aplikacionit dhe MetaMask me Sepolia, regjistrimi i faturave nga llogaria e biznesit, si dhe veprime nga llogaria e klientit. Transaksionet dhe statuset u kontrolluan përmes aplikacionit dhe regjistrit në blockchain. Identifikuesit e transaksioneve, adresat dhe blloqet mund të shtohen në aneksin e raportit nëse kërkohen për demonstrimin; çelësat privatë nuk duhet të publikohen.

## 8. Përmbledhje e testimeve dhe kriteret e pranimit

Testet automatike ekzekutohen nga rrënja e projektit me `npm test`. Në testimin e raportuar, **35 teste të kontratave inteligjente kaluan me sukses**. Përveç tyre, u kryen testime integrimi në Sepolia dhe verifikime përmes ndërfaqes, API-së dhe IPFS.

### 8.1 Testet e kontratave inteligjente

Testet Hardhat mbulojnë konfigurimin e `InvoiceWorkflow` me `InvoiceRegistry`, autorizimet e administratorit dhe të palëve, regjistrimin e faturave dhe validimin e të dhënave, si dhe veprimet e ciklit jetësor. U testuan gjithashtu inputet e pavlefshme, kalimet e palejuara të statusit, faturat që nuk ekzistojnë, emetimi i eventeve dhe ruajtja e historikut.

Rastet e përfshira përfshijnë dërgimin, pranimin, kontestimin, pagesën dhe anulimin; refuzimin e arsyeve bosh për kontestim; refuzimin e pagesës para pranimit; dhe refuzimin e ndryshimit të statusit pas pagesës.

### 8.2 Testimi i faturave dhe ciklit jetësor në Sepolia

U testuan **5 fatura** me biznesin si lëshues dhe llogari të veçantë si klient. U verifikuan lidhja me MetaMask, regjistrimi në `InvoiceRegistry`, ndryshimet e statusit përmes `InvoiceWorkflow`, transaksionet dhe paraqitja e statusit aktual në aplikacion.

Statuset përfundimtare të faturave janë dokumentuar te [rezultatet e testimit në Sepolia](#71-rezultatet-e-testimit-në-sepolia). Gjatë demonstrimit u testua edhe kontestimi i `INV-0002`, para se fatura të anulohej.

### 8.3 Testimi i PDF-së dhe integritetit SHA-256

U kryen **5 verifikime PDF**, përfshirë dokumente origjinale dhe të ndryshuara:

- Për PDF-në origjinale, hash-i SHA-256 i llogaritur në shfletues përputhet me hash-in e faturës së regjistruar dhe rezultati shfaqet si `Valid`.
- Për PDF-në e ndryshuar, hash-i nuk përputhet dhe rezultati shfaqet si `Invalid`.
- U kontrolluan shfaqja e hash-it të PDF-së dhe hash-it të regjistruar, si dhe ruajtja e rezultatit, datës, orës dhe wallet-it në historikun lokal të verifikimeve.

Numri minimal i kërkuar për demonstrim ishte tri verifikime; u realizuan pesë.

### 8.4 Testimi i roleve dhe autorizimeve

U përdorën llogari të veçanta për biznesin dhe klientin. Gjithashtu u testua një wallet i paautorizuar; veprimet e ndryshimit të statusit nuk iu mundësuan në ndërfaqe. Rregullat e autorizimit të kontratave mbulohen edhe nga testet automatike Hardhat.

### 8.5 Testimi i API-së, IPFS-së dhe historikut

U testuan komunikimi ndërmjet frontend-it dhe backend-it, API-ja REST për leximin e të dhënave dhe indeksimin e eventeve të kontratave. U kontrollua shfaqja e eventeve të regjistrimit dhe ndryshimeve të statusit, përfshirë adresën që kreu veprimin, kohën dhe shënimin kur është i disponueshëm.

PDF-të u ngarkuan në IPFS përmes Pinata-s; URI-ja e metadata-s u lidh me faturën në blockchain. U testua hapja e metadata-s përmes lidhjes IPFS, shfaqja kronologjike e historikut të statusit dhe ruajtja lokale e historikut të verifikimeve pas rifreskimit të faqes.


## 9. Analiza e sigurisë dhe kufizimet

- **Publikimi i të dhënave:** adresat, shumat, hash-et dhe URI-të në blockchain janë publike dhe të pandryshueshme. Hash-i nuk siguron anonimitet absolut, sidomos nëse dokumenti mund të merret me mend ose ekziston një kopje e njohur.
- **Privilegjet administrative:** administratori mund të konfigurojë workflow-n dhe auditorët. Çelësi administrativ duhet të mbahet jashtë repository-t dhe përdorimit të përditshëm.
- **Kufizimet e hash-it:** krahasimi provon integritetin e bajteve të dokumentit ndaj hash-it të ruajtur, por jo vërtetësinë ligjore, identitetin ose vlefshmërinë tregtare.
- **API-ja:** indeksuesi nuk ruan gjendje të qëndrueshme dhe varet nga disponueshmëria e RPC-së. Verifikimet kritike duhet të bazohen në kontrata.
- **Ruajtja off-chain:** PDF-ja dhe metadata ngarkohen në IPFS përmes Pinata. IPFS është publik dhe përmbajtja e pin-uar mund të mbetet e qasshme edhe pas fshirjes nga llogaria Pinata; përdorni vetëm dokumente sintetike/testuese. Endpoint-i i demonstrimit nuk ka autentikim apo kufizim shpejtësie dhe nuk duhet ekspozuar publikisht pa këto masa.
- **Pagesa:** statusi `Paid` është deklarim i klientit në kontratë. Projekti nuk kryen pagesa bankare dhe nuk transferon tokena.
- **Varësitë:** kontrolli `npm audit --omit=dev` ka raportuar zero dobësi në varësitë e runtime-it. Auditimi i plotë mund të raportojë këshillime për paketat e zhvillimit; përpara përdorimit në prodhim nevojitet vlerësim dhe përditësim i toolchain-it.

