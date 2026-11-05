import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, isAddress, parseUnits } from "ethers";
import {
  registryAbi,
  statusClasses,
  statusNames,
  workflowAbi,
  type HistoryEntry,
  type Invoice
} from "./contracts";

type View = "overview" | "register" | "details" | "actions" | "verify";
type ApiEvent = { invoiceId: string; status?: number; note?: string; changedBy?: string; changedAt?: number; blockNumber?: number };
const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
const registryAddress = import.meta.env.VITE_REGISTRY_ADDRESS;
const workflowAddress = import.meta.env.VITE_WORKFLOW_ADDRESS;
const rpcUrl = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const configuredChainId = Number(import.meta.env.VITE_CHAIN_ID || "31337");

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatAmount(amount: bigint, currency: string) {
  const numeric = Number(formatUnits(amount, 2));
  return `${numeric.toLocaleString("sq-AL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function readableError(error: unknown) {
  if (typeof error === "object" && error !== null && "shortMessage" in error) {
    return String(error.shortMessage);
  }
  if (error instanceof Error) return error.message;
  return "Ndodhi një gabim i panjohur.";
}

async function hashFile(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<bigint>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedId, setSelectedId] = useState<bigint>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [apiEvents, setApiEvents] = useState<ApiEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [verifyResult, setVerifyResult] = useState<"match" | "mismatch" | "">("");
  const [verifyFile, setVerifyFile] = useState<File>();
  const [form, setForm] = useState({
    recipient: "",
    amount: "",
    currency: "EUR",
    metadataURI: "",
    file: undefined as File | undefined
  });
  const [actionNote, setActionNote] = useState("");

  const connected = Boolean(account);
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedId);
  const statusCounts = useMemo(() => invoices.reduce<Record<number, number>>((counts, invoice) => {
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    return counts;
  }, {}), [invoices]);

  const wallet = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask nuk u gjet. Instaloje dhe provo përsëri.");
    return new BrowserProvider(window.ethereum);
  }, []);

  const loadInvoices = useCallback(async () => {
    if (!registryAddress || !workflowAddress) return;
    const provider = new JsonRpcProvider(rpcUrl, configuredChainId, { staticNetwork: true });
    const registry = new Contract(registryAddress, registryAbi, provider);
    const workflow = new Contract(workflowAddress, workflowAbi, provider);
    const count = Number(await registry.getFunction("invoiceCount")());
    const result: Invoice[] = [];
    for (let id = 1; id <= count; id += 1) {
      const [raw, status] = await Promise.all([
        registry.getFunction("getInvoice")(id),
        workflow.getFunction("statusOf")(id)
      ]);
      result.push({
        id: raw.id,
        issuer: raw.issuer,
        recipient: raw.recipient,
        documentHash: raw.documentHash,
        amount: raw.amount,
        currency: raw.currency,
        metadataURI: raw.metadataURI,
        createdAt: raw.createdAt,
        status: Number(status)
      });
    }
    setInvoices(result.reverse());
    setError((currentError) =>
      currentError.startsWith("Nuk u lexuan faturat:") ? "" : currentError
    );
    if (selectedId !== undefined) {
      const entries = await workflow.getFunction("getHistory")(selectedId) as HistoryEntry[];
      setHistory(entries);
    }
  }, [selectedId]);

  useEffect(() => {
    loadInvoices().catch((loadError: unknown) => setError(`Nuk u lexuan faturat: ${readableError(loadError)}`));
  }, [loadInvoices]);

  useEffect(() => {
    if (!apiUrl) return;
    const refresh = () => fetch(`${apiUrl}/api/events`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`API u përgjigj me ${response.status}`);
        const data = await response.json() as { events: ApiEvent[] };
        setApiEvents(data.events);
      })
      .catch((apiError: unknown) => console.error("Event API unavailable:", apiError));
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const accountChanged = (...accounts: unknown[]) => setAccount(String((accounts[0] as string[] | undefined)?.[0] ?? ""));
    const chainChanged = (chain: unknown) => setChainId(BigInt(String(chain)));
    window.ethereum.on("accountsChanged", accountChanged);
    window.ethereum.on("chainChanged", chainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", accountChanged);
      window.ethereum?.removeListener("chainChanged", chainChanged);
    };
  }, []);

  const connectWallet = async () => {
    setError("");
    try {
      const provider = await wallet();
      const accounts = await provider.send("eth_requestAccounts", []) as string[];
      const network = await provider.getNetwork();
      setAccount(accounts[0] ?? "");
      setChainId(network.chainId);
    } catch (walletError) {
      setError(readableError(walletError));
    }
  };

  const withTransaction = async (label: string, action: (contracts: { registry: Contract; workflow: Contract }) => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!connected) throw new Error("Lidhe MetaMask për të vazhduar.");
      if (!registryAddress || !workflowAddress) throw new Error("Kontratat nuk janë konfiguruar. Shiko udhëzimet e instalimit.");
      const provider = await wallet();
      const signer = await provider.getSigner();
      const contracts = {
        registry: new Contract(registryAddress, registryAbi, signer),
        workflow: new Contract(workflowAddress, workflowAbi, signer)
      };
      await action(contracts);
      setNotice(label);
      await loadInvoices();
    } catch (transactionError) {
      setError(readableError(transactionError));
    } finally {
      setBusy(false);
    }
  };

  const registerInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.file || !isAddress(form.recipient) || !form.amount || Number(form.amount) <= 0) {
      setError("Plotëso adresën e vlefshme të klientit, shumën dhe PDF-në.");
      return;
    }
    await withTransaction("Fatura u regjistrua në blockchain.", async ({ registry }) => {
      const documentHash = await hashFile(form.file!);
      const amount = parseUnits(form.amount, 2);
      const tx = await registry.getFunction("registerInvoice")(
        form.recipient,
        documentHash,
        amount,
        form.currency,
        form.metadataURI
      );
      await tx.wait();
      setForm({ recipient: "", amount: "", currency: "EUR", metadataURI: "", file: undefined });
    });
  };

  const runAction = async (action: "send" | "accept" | "dispute" | "pay" | "cancel") => {
    if (selectedId === undefined) return;
    await withTransaction("Statusi u përditësua dhe u regjistrua në historikun e faturës.", async ({ workflow }) => {
      let tx;
      if (action === "send") tx = await workflow.getFunction("sendInvoice")(selectedId);
      else if (action === "accept") tx = await workflow.getFunction("acceptInvoice")(selectedId);
      else if (action === "pay") tx = await workflow.getFunction("markPaid")(selectedId);
      else {
        if (!actionNote.trim()) throw new Error("Shkruaj arsyen për kontestim ose anulim.");
        tx = action === "dispute"
          ? await workflow.getFunction("disputeInvoice")(selectedId, actionNote.trim())
          : await workflow.getFunction("cancelInvoice")(selectedId, actionNote.trim());
      }
      await tx.wait();
      setActionNote("");
    });
  };

  const loadDetails = async (id: bigint) => {
    setSelectedId(id);
    setView("details");
    setError("");
    try {
      if (!workflowAddress) return;
      const provider = new JsonRpcProvider(rpcUrl, configuredChainId, { staticNetwork: true });
      const workflow = new Contract(workflowAddress, workflowAbi, provider);
      setHistory(await workflow.getFunction("getHistory")(id) as HistoryEntry[]);
    } catch (detailError) {
      setError(`Historia nuk u lexua: ${readableError(detailError)}`);
    }
  };

  const verifyInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedInvoice || !verifyFile) {
      setError("Zgjidh faturën dhe dokumentin PDF për verifikim.");
      return;
    }
    setError("");
    try {
      setVerifyResult(await hashFile(verifyFile) === selectedInvoice.documentHash ? "match" : "mismatch");
    } catch (verifyError) {
      setError(`Dokumenti nuk mund të lexohet: ${readableError(verifyError)}`);
    }
  };

  const wrongChain = connected && chainId !== undefined && Number(chainId) !== configuredChainId;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setView("overview")}><span className="brand-mark">F</span><span>fatura<span className="brand-dot">.</span></span></a>
        <div className="side-label">MENAXHIMI</div>
        <nav className="navigation" aria-label="Navigimi kryesor">
          <NavButton active={view === "overview"} onClick={() => setView("overview")} icon="▦">Pasqyra</NavButton>
          <NavButton active={view === "register"} onClick={() => setView("register")} icon="+">Regjistro faturë</NavButton>
          <NavButton active={view === "details"} onClick={() => setView("details")} icon="◷">Historia</NavButton>
          <NavButton active={view === "actions"} onClick={() => setView("actions")} icon="⇄">Veprimet</NavButton>
          <NavButton active={view === "verify"} onClick={() => setView("verify")} icon="✓">Verifiko PDF</NavButton>
        </nav>
        <div className="sidebar-bottom">
          <div className="network-indicator"><span className="pulse" /> Rrjet testues</div>
          <p>Dokumentet ruhen jashtë blockchain-it.<br />Vetëm hash-i dhe historia janë publike.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><div className="eyebrow">PLATFORMË E FATURAVE</div><h1>{pageTitle(view)}</h1></div>
          <div className="topbar-right">
            <span className={`chain-pill ${wrongChain ? "chain-warning" : ""}`}>{chainId === 11155111n ? "Sepolia" : "Local testnet"}</span>
            <button className={`wallet-button ${connected ? "connected" : ""}`} onClick={connectWallet}>
              <span className="wallet-icon">◈</span>{connected ? shortAddress(account) : "Lidh MetaMask"}
            </button>
          </div>
        </header>

        {wrongChain && <div className="alert warning">MetaMask është në chain ID {chainId?.toString()}. Zgjidh rrjetin {configuredChainId === 11155111 ? "Sepolia" : "Hardhat Local"}.</div>}
        {!registryAddress && <div className="alert warning">Adresa e kontratave mungon. Kopjo adresat e deploy-it në <code>frontend/.env.local</code> dhe rinis frontend-in.</div>}
        {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {view === "overview" && <section>
          <div className="welcome-row">
            <div><h2>Faturat e ekipit</h2><p>Gjurmim i verifikueshëm, nga regjistrimi deri te pagesa.</p></div>
            <button className="primary-button" onClick={() => setView("register")}><span>+</span> Regjistro faturë</button>
          </div>
          <div className="stats-grid">
            <Stat label="Gjithsej fatura" value={invoices.length} icon="▤" tone="blue" />
            <Stat label="Në pritje" value={(statusCounts[0] ?? 0) + (statusCounts[1] ?? 0)} icon="◷" tone="amber" />
            <Stat label="Kontestuara" value={statusCounts[3] ?? 0} icon="!" tone="red" />
            <Stat label="Të paguara" value={statusCounts[4] ?? 0} icon="✓" tone="green" />
          </div>
          <div className="panel">
            <div className="panel-heading"><div><h3>Faturat e fundit</h3><p>Gjendja e faturave të regjistruara në kontratë</p></div><button className="text-button" onClick={() => loadInvoices().catch((loadError: unknown) => setError(readableError(loadError)))}>Rifresko ↻</button></div>
            <InvoiceTable invoices={invoices} onSelect={loadDetails} />
          </div>
          {apiUrl && <div className="panel api-panel"><div className="panel-heading"><div><h3>Aktiviteti në blockchain</h3><p>Eventet e fundit të indeksuara nga API</p></div><span className="event-count">{apiEvents.length} evente</span></div>
            {apiEvents.length ? <div className="event-feed">{[...apiEvents].reverse().slice(0, 5).map((entry, index) => <div className="event-feed-row" key={`${entry.invoiceId}-${entry.blockNumber}-${index}`}><span className={`event-mark status-${statusClasses[entry.status ?? 0]}`} /><div><strong>INV-{entry.invoiceId.padStart(4, "0")} · {statusNames[entry.status ?? 0] ?? "Status"}</strong><small>{entry.note} · {entry.changedBy ? shortAddress(entry.changedBy) : ""}</small></div><time>{entry.changedAt ? new Date(entry.changedAt * 1000).toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>)}</div> : <p className="muted">Duke pritur eventet nga API. Kontrollo lidhjen dhe konfigurimin e backend-it.</p>}
          </div>}
        </section>}

        {view === "register" && <section className="form-page">
          <div className="intro-card"><div className="intro-icon">↗</div><div><h2>Krijo një faturë të verifikueshme</h2><p>PDF-ja nuk ngarkohet në blockchain. Aplikacioni llogarit SHA-256 në pajisjen tënde dhe publikon vetëm hash-in.</p></div></div>
          <form className="panel invoice-form" onSubmit={registerInvoice}>
            <div className="form-grid">
              <label>Adresa e klientit<input value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} placeholder="0x…" required /></label>
              <label>Shuma<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="125.00" required /></label>
              <label>Monedha<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option>EUR</option><option>USD</option><option>ALL</option></select></label>
              <label>URI e metadata (opsionale)<input value={form.metadataURI} onChange={(event) => setForm({ ...form, metadataURI: event.target.value })} placeholder="ipfs://…" maxLength={256} /></label>
            </div>
            <label className="file-drop"><span className="upload-icon">↑</span><strong>{form.file?.name ?? "Zgjidh PDF-në e faturës"}</strong><span>PDF nuk largohet nga pajisja gjatë llogaritjes së hash-it · max sipas shfletuesit</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] })} required /></label>
            <div className="form-footer"><span>Transaksion testues · nuk kryhen pagesa reale</span><button className="primary-button" disabled={busy || wrongChain}>{busy ? "Duke regjistruar…" : "Regjistro faturën →"}</button></div>
          </form>
        </section>}

        {view === "details" && <section className="panel">
          <div className="panel-heading"><div><h3>Detajet dhe historia</h3><p>Zgjidh një faturë për të parë gjurmën e auditimit.</p></div><InvoiceSelect invoices={invoices} selectedId={selectedId} onChange={(id) => void loadDetails(id)} /></div>
          {selectedInvoice ? <><InvoiceSummary invoice={selectedInvoice} /><div className="timeline">
            {history.map((entry, index) => <div className="timeline-entry" key={`${entry.changedAt}-${index}`}><span className={`timeline-dot status-${statusClasses[entry.status]}`} /><div className="timeline-body"><strong>{statusNames[entry.status] ?? "Status i panjohur"}</strong><p>{entry.note}</p><small>{new Date(Number(entry.changedAt) * 1000).toLocaleString("sq-AL")} · {shortAddress(entry.changedBy)}</small></div></div>)}
            {history.length === 0 && <EmptyState text="Nuk ka histori për këtë faturë." />}
          </div></> : <EmptyState text="Zgjidh një faturë nga lista ose krijo faturën e parë." />}
        </section>}

        {view === "actions" && <section className="panel">
          <div className="panel-heading"><div><h3>Veprimet e faturës</h3><p>Vetëm biznesi dhe klienti mund të ndryshojnë statusin.</p></div><InvoiceSelect invoices={invoices} selectedId={selectedId} onChange={(id) => void loadDetails(id)} /></div>
          {selectedInvoice ? <>
            <InvoiceSummary invoice={selectedInvoice} />
            <div className="action-status"><span>Status aktual</span><StatusBadge status={selectedInvoice.status} /></div>
            <label className="note-input">Arsye / shënim për kontestim ose anulim<textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={200} placeholder="Shkruaj një shënim të shkurtër…" /></label>
            <div className="actions-grid">
              <ActionButton title="Dërgo faturën" detail="Biznesi e dërgon te klienti" disabled={busy || selectedInvoice.status !== 0 || !accountMatches(selectedInvoice.issuer, account)} onClick={() => void runAction("send")} />
              <ActionButton title="Prano faturën" detail="Klienti e pranon" disabled={busy || ![1, 3].includes(selectedInvoice.status) || !accountMatches(selectedInvoice.recipient, account)} onClick={() => void runAction("accept")} />
              <ActionButton title="Kontesto" detail="Klienti hap kontestim" disabled={busy || selectedInvoice.status !== 1 || !accountMatches(selectedInvoice.recipient, account)} onClick={() => void runAction("dispute")} />
              <ActionButton title="Shëno si të paguar" detail="Klienti konfirmon pagesën" disabled={busy || selectedInvoice.status !== 2 || !accountMatches(selectedInvoice.recipient, account)} onClick={() => void runAction("pay")} />
              <ActionButton title="Anulo faturën" detail="Biznesi ose klienti, para pagesës" disabled={busy || ![0, 1, 3].includes(selectedInvoice.status) || (!accountMatches(selectedInvoice.issuer, account) && !accountMatches(selectedInvoice.recipient, account))} onClick={() => void runAction("cancel")} />
            </div>
            {!connected && <p className="muted center">Lidh MetaMask me njërën nga adresat e faturës për të aktivizuar veprimet.</p>}
          </> : <EmptyState text="Zgjidh një faturë për të menaxhuar statusin e saj." />}
        </section>}

        {view === "verify" && <section className="verify-layout">
          <div className="panel">
            <div className="panel-heading"><div><h3>Verifiko dokumentin</h3><p>Krahaso hash-in SHA-256 të PDF-së me regjistrin publik.</p></div></div>
            <form onSubmit={verifyInvoice} className="verify-form">
              <label>Fatura<InvoiceSelect invoices={invoices} selectedId={selectedId} onChange={(id) => { setSelectedId(id); setVerifyResult(""); }} /></label>
              <label className="file-drop compact"><span className="upload-icon">⌕</span><strong>{verifyFile?.name ?? "Zgjidh PDF-në për krahasim"}</strong><span>Hash-i llogaritet lokalisht, dokumenti nuk ngarkohet</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => { setVerifyFile(event.target.files?.[0]); setVerifyResult(""); }} required /></label>
              <button className="primary-button" disabled={!selectedInvoice || !verifyFile}>Verifiko hash-in →</button>
            </form>
            {verifyResult && <div className={`verification-result ${verifyResult}`}><span>{verifyResult === "match" ? "✓" : "!"}</span><div><strong>{verifyResult === "match" ? "Dokumenti përputhet" : "Dokumenti është ndryshuar"}</strong><p>{verifyResult === "match" ? "Hash-i i PDF-së përputhet me hash-in e regjistruar në blockchain." : "Hash-i ndryshon. PDF-ja nuk është i njëjti dokument që u regjistrua."}</p></div></div>}
          </div>
          {selectedInvoice && <div className="panel hash-panel"><span className="eyebrow">HASH-I I REGJISTRUAR</span><code>{selectedInvoice.documentHash}</code><span className="muted">ID e faturës #{selectedInvoice.id.toString()}</span></div>}
        </section>}
      </main>
    </div>
  );
}

function accountMatches(expected: string, actual: string) {
  return Boolean(actual) && expected.toLowerCase() === actual.toLowerCase();
}

function pageTitle(view: View) {
  return { overview: "Pasqyra", register: "Regjistro faturë", details: "Historia e auditimit", actions: "Menaxho faturën", verify: "Verifiko dokumentin" }[view];
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: string; children: React.ReactNode }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span className="nav-icon">{icon}</span>{children}</button>;
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: string }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div><span className="stat-label">{label}</span><strong>{value}</strong></div></div>;
}

function StatusBadge({ status }: { status: number }) {
  return <span className={`status-badge status-${statusClasses[status] ?? "registered"}`}><i />{statusNames[status] ?? "Panjohur"}</span>;
}

function InvoiceTable({ invoices, onSelect }: { invoices: Invoice[]; onSelect: (id: bigint) => void }) {
  if (!invoices.length) return <EmptyState text="Nuk ka fatura ende. Regjistro të parën për të filluar demonstrimin." />;
  return <div className="table-scroll"><table><thead><tr><th>FATURA</th><th>KLIENTI</th><th>DATA</th><th>SHUMA</th><th>STATUSI</th><th /></tr></thead><tbody>
    {invoices.map((invoice) => <tr key={invoice.id.toString()} onClick={() => onSelect(invoice.id)}><td><strong>INV-{invoice.id.toString().padStart(4, "0")}</strong><small>{shortAddress(invoice.issuer)}</small></td><td>{shortAddress(invoice.recipient)}</td><td>{new Date(Number(invoice.createdAt) * 1000).toLocaleDateString("sq-AL")}</td><td className="amount">{formatAmount(invoice.amount, invoice.currency)}</td><td><StatusBadge status={invoice.status} /></td><td className="row-arrow">›</td></tr>)}
  </tbody></table></div>;
}

function InvoiceSelect({ invoices, selectedId, onChange }: { invoices: Invoice[]; selectedId?: bigint; onChange: (id: bigint) => void }) {
  return <select className="invoice-select" value={selectedId?.toString() ?? ""} onChange={(event) => event.target.value && onChange(BigInt(event.target.value))}>
    <option value="">Zgjidh faturën…</option>{invoices.map((invoice) => <option value={invoice.id.toString()} key={invoice.id.toString()}>INV-{invoice.id.toString().padStart(4, "0")} · {formatAmount(invoice.amount, invoice.currency)}</option>)}
  </select>;
}

function InvoiceSummary({ invoice }: { invoice: Invoice }) {
  return <div className="invoice-summary"><div className="summary-top"><div><span className="eyebrow">FATURA</span><h2>INV-{invoice.id.toString().padStart(4, "0")}</h2></div><StatusBadge status={invoice.status} /></div><div className="summary-grid"><div><span>Biznesi</span><strong>{shortAddress(invoice.issuer)}</strong></div><div><span>Klienti</span><strong>{shortAddress(invoice.recipient)}</strong></div><div><span>Shuma</span><strong>{formatAmount(invoice.amount, invoice.currency)}</strong></div><div><span>Hash SHA-256</span><code>{invoice.documentHash.slice(0, 18)}…</code></div></div></div>;
}

function ActionButton({ title, detail, disabled, onClick }: { title: string; detail: string; disabled: boolean; onClick: () => void }) {
  return <button className="action-card" disabled={disabled} onClick={onClick}><span className="action-arrow">↗</span><strong>{title}</strong><small>{detail}</small></button>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>▤</span><p>{text}</p></div>;
}
