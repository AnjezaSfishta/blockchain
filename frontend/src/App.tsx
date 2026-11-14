import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type VerificationRecord = {
  invoiceId: string;
  wallet: string;
  pdfHash: string;
  result: "Valid" | "Invalid";
  verifiedAt: string;
  blockchainHash: string;
};

type IconName = "grid" | "plus" | "clock" | "arrows" | "shield";

const iconPaths: Record<IconName, string[]> = {
  grid: ["M3.5 3.5h6v6h-6z", "M14.5 3.5h6v6h-6z", "M3.5 14.5h6v6h-6z", "M14.5 14.5h6v6h-6z"],
  plus: ["M12 5v14", "M5 12h14"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  arrows: ["M7 7h13l-3-3", "M17 17H4l3 3", "M20 7l-3 3", "M4 17l3-3"],
  shield: ["M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z", "m9 12 2 2 4-4"]
};

function isVerificationRecord(value: unknown): value is VerificationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.invoiceId === "string"
    && typeof record.wallet === "string"
    && typeof record.pdfHash === "string"
    && (record.result === "Valid" || record.result === "Invalid")
    && typeof record.verifiedAt === "string"
    && typeof record.blockchainHash === "string";
}

const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
const registryAddress = import.meta.env.VITE_REGISTRY_ADDRESS;
const workflowAddress = import.meta.env.VITE_WORKFLOW_ADDRESS;
const rpcUrl = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const configuredChainId = Number(import.meta.env.VITE_CHAIN_ID || "31337");
const verificationHistoryKey = "fatura.verification-history";

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
  const [previewUrl, setPreviewUrl] = useState("");
  const [verificationHistory, setVerificationHistory] = useState<VerificationRecord[]>([]);
  const registerFormRef = useRef<HTMLFormElement>(null);
  const verifyFormRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({
    recipient: "",
    amount: "",
    currency: "EUR",
    file: undefined as File | undefined
  });
  const [actionNote, setActionNote] = useState("");

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(verificationHistoryKey);
      if (savedHistory) {
        const parsedHistory: unknown = JSON.parse(savedHistory);
        if (!Array.isArray(parsedHistory) || !parsedHistory.every(isVerificationRecord)) {
          throw new Error("Formati i historikut është i pavlefshëm.");
        }
        setVerificationHistory(parsedHistory);
      }
    } catch (historyError) {
      setError(`Historiku i verifikimeve nuk u lexua: ${readableError(historyError)}`);
    }
  }, []);

  const connected = Boolean(account);
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedId);
  const canDispute = Boolean(
    selectedInvoice
    && selectedInvoice.status === 1
    && accountMatches(selectedInvoice.recipient, account)
  );
  const canCancel = Boolean(
    selectedInvoice
    && [0, 1, 3].includes(selectedInvoice.status)
    && (
      accountMatches(selectedInvoice.issuer, account)
      || accountMatches(selectedInvoice.recipient, account)
    )
  );
  const statusCounts = useMemo(() => invoices.reduce<Record<number, number>>((counts, invoice) => {
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    return counts;
  }, {}), [invoices]);
  const invoiceActivity = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      return {
        label: month.toLocaleDateString("sq-AL", { month: "short" }),
        count: invoices.filter((invoice) => {
          const createdAt = new Date(Number(invoice.createdAt) * 1000);
          return createdAt.getFullYear() === month.getFullYear() && createdAt.getMonth() === month.getMonth();
        }).length
      };
    });
  }, [invoices]);

  useEffect(() => {
    if (!form.file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(form.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [form.file]);

  const activityPeak = Math.max(1, ...invoiceActivity.map((month) => month.count));
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
    const accountChanged = (...accounts: unknown[]) => {
      setAccount(String((accounts[0] as string[] | undefined)?.[0] ?? ""));
      setNotice("");
      setError("");
    };
    const chainChanged = (chain: unknown) => {
      setChainId(BigInt(String(chain)));
      setNotice("");
      setError("");
    };
    window.ethereum.on("accountsChanged", accountChanged);
    window.ethereum.on("chainChanged", chainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", accountChanged);
      window.ethereum?.removeListener("chainChanged", chainChanged);
    };
  }, []);

  const connectWallet = async () => {
    setError("");
    setNotice("");
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
    if (form.file.size > 10 * 1024 * 1024) {
      setError("PDF-ja duhet të jetë më e vogël se 10 MB.");
      return;
    }
    await withTransaction("Fatura dhe metadata u ruajtën në IPFS; hash-i dhe URI u regjistruan në blockchain.", async ({ registry }) => {
      if (!apiUrl) throw new Error("Konfiguro VITE_API_URL për të ngarkuar dokumentin në IPFS.");
      const documentHash = await hashFile(form.file!);
      const uploadResponse = await fetch(`${apiUrl}/api/storage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-Document-Hash": documentHash
        },
        body: form.file!
      });
      const uploadResult = await uploadResponse.json() as { error?: string; metadataURI?: string };
      if (!uploadResponse.ok || !uploadResult.metadataURI) {
        throw new Error(uploadResult.error || `Ngarkimi në IPFS dështoi (${uploadResponse.status}).`);
      }
      const amount = parseUnits(form.amount, 2);
      const tx = await registry.getFunction("registerInvoice")(
        form.recipient,
        documentHash,
        amount,
        form.currency,
        uploadResult.metadataURI
      );
      await tx.wait();
      setForm({ recipient: "", amount: "", currency: "EUR", file: undefined });
      registerFormRef.current?.reset();
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
    navigateToView("details");
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
    let pdfHash: string;
    try {
      pdfHash = await hashFile(verifyFile);
    } catch (verifyError) {
      setError(`Dokumenti nuk mund të lexohet: ${readableError(verifyError)}`);
      return;
    }
    const result = pdfHash === selectedInvoice.documentHash ? "match" : "mismatch";
    const record: VerificationRecord = {
      invoiceId: selectedInvoice.id.toString(),
      wallet: account || "Pa wallet të lidhur",
      pdfHash,
      result: result === "match" ? "Valid" : "Invalid",
      verifiedAt: new Date().toISOString(),
      blockchainHash: selectedInvoice.documentHash
    };
    setVerifyResult(result);
    try {
      const updatedHistory = [record, ...verificationHistory];
      localStorage.setItem(verificationHistoryKey, JSON.stringify(updatedHistory));
      setVerificationHistory(updatedHistory);
    } catch (historyError) {
      setError(`Historiku i verifikimeve nuk u ruajt: ${readableError(historyError)}`);
    }
  };

  const navigateToView = (nextView: View) => {
    if (view === nextView) return;
    setNotice("");
    setError("");
    if (view === "register") {
      setForm({ recipient: "", amount: "", currency: "EUR", file: undefined });
      registerFormRef.current?.reset();
    }
    if (view === "verify") {
      setVerifyFile(undefined);
      setVerifyResult("");
      verifyFormRef.current?.reset();
    }
    if (view === "actions") setActionNote("");
    setView(nextView);
  };

  const wrongChain = connected && chainId !== undefined && Number(chainId) !== configuredChainId;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigateToView("overview"); }}><span className="brand-mark">F</span><span>Fatura<span className="brand-dot"></span></span></a>
        <div className="side-label">MENAXHIMI</div>
        <nav className="navigation" aria-label="Navigimi kryesor">
          <NavButton active={view === "overview"} onClick={() => navigateToView("overview")} icon="grid">Përmbledhje</NavButton>
          <NavButton active={view === "register"} onClick={() => navigateToView("register")} icon="plus">Regjistro faturë</NavButton>
          <NavButton active={view === "details"} onClick={() => navigateToView("details")} icon="clock">Historia</NavButton>
          <NavButton active={view === "actions"} onClick={() => navigateToView("actions")} icon="arrows">Veprimet</NavButton>
          <NavButton active={view === "verify"} onClick={() => navigateToView("verify")} icon="shield">Verifiko PDF</NavButton>
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
            <div><span className="section-kicker">PAMJE E PËRGJITHSHME</span><h2>Faturat e ekipit</h2><p>Gjurmim i verifikueshëm, nga regjistrimi deri te pagesa.</p></div>
            <button className="primary-button" onClick={() => navigateToView("register")}><span>+</span> Regjistro faturë</button>
          </div>
          <div className="stats-grid">
            <Stat label="Gjithsej fatura" value={invoices.length} icon="▤" tone="blue" />
            <Stat label="Në pritje" value={(statusCounts[0] ?? 0) + (statusCounts[1] ?? 0)} icon="◷" tone="amber" />
            <Stat label="Kontestuara" value={statusCounts[3] ?? 0} icon="!" tone="red" />
            <Stat label="Të paguara" value={statusCounts[4] ?? 0} icon="✓" tone="green" />
          </div>
          <div className="dashboard-grid">
            <div className="panel activity-panel">
              <div className="panel-heading"><div><span className="section-kicker">GJASHTË MUAJT E FUNDIT</span><h3>Aktiviteti i faturave</h3><p>Fatura të regjistruara sipas muajit</p></div><span className="chart-total">{invoices.length} gjithsej</span></div>
              <div className="activity-chart" role="img" aria-label="Regjistrimet e faturave sipas muajit">
                {invoiceActivity.map((month, index) => {
                  return <div className="chart-column" key={index}><span className="chart-value">{month.count || ""}</span><div className="chart-track"><span style={{ height: `${Math.max(4, (month.count / activityPeak) * 100)}%` }} /></div><span className="chart-month">{month.label}</span></div>;
                })}
              </div>
              <div className="chart-footnote"><span><i /> Fatura të regjistruara</span><span>Burimi: regjistri në blockchain</span></div>
            </div>
            <div className="panel status-panel">
              <div className="panel-heading"><div><span className="section-kicker">PORTOFOLI</span><h3>Statusi i faturave</h3><p>Shpërndarja aktuale sipas statusit</p></div></div>
              <div className="status-breakdown">{statusNames.map((name, index) => {
                const count = statusCounts[index] ?? 0;
                const share = invoices.length ? (count / invoices.length) * 100 : 0;
                return <div className="status-breakdown-row" key={name}><div><span className={`status-key status-${statusClasses[index]}`} /><span>{name}</span><strong>{count}</strong></div><span className="status-meter"><i className={`status-${statusClasses[index]}`} style={{ width: `${share}%` }} /></span></div>;
              })}</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-heading"><div><span className="section-kicker">REGJISTRI</span><h3>Faturat e fundit</h3><p>Gjendja e faturave të regjistruara në kontratë</p></div><button className="text-button" onClick={() => loadInvoices().catch((loadError: unknown) => setError(readableError(loadError)))}>Rifresko <span>↻</span></button></div>
            <InvoiceTable invoices={invoices} onSelect={loadDetails} />
          </div>
          {apiUrl && <div className="panel api-panel"><div className="panel-heading"><div><h3>Aktiviteti në blockchain</h3><p>Eventet e fundit të indeksuara nga API</p></div><span className="event-count">{apiEvents.length} evente</span></div>
            {apiEvents.length ? <div className="event-feed">{[...apiEvents].reverse().slice(0, 5).map((entry, index) => <div className="event-feed-row" key={`${entry.invoiceId}-${entry.blockNumber}-${index}`}><span className={`event-mark status-${statusClasses[entry.status ?? 0]}`} /><div><strong>INV-{entry.invoiceId.padStart(4, "0")} · {statusNames[entry.status ?? 0] ?? "Status"}</strong><small>{entry.note} · {entry.changedBy ? shortAddress(entry.changedBy) : ""}</small></div><time>{entry.changedAt ? new Date(entry.changedAt * 1000).toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>)}</div> : <p className="muted">Duke pritur eventet nga API. Kontrollo lidhjen dhe konfigurimin e backend-it.</p>}
          </div>}
        </section>}

        {view === "register" && <section className="form-page">
          <div className="intro-card"><div className="intro-icon"><Icon name="plus" /></div><div><span className="section-kicker">FATURË E RE</span><h2>Krijo një faturë të verifikueshme</h2><p>PDF-ja nuk ngarkohet në blockchain. Aplikacioni llogarit SHA-256 në pajisjen tënde dhe publikon vetëm hash-in.</p></div></div>
          <div className="register-layout">
          <form ref={registerFormRef} className="panel invoice-form" onSubmit={registerInvoice}>
            <div className="form-grid">
              <label>Adresa e klientit<input value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} placeholder="0x…" autoComplete="off" required /></label>
              <label>Shuma<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="125.00" inputMode="decimal" required /></label>
              <label>Monedha<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option>EUR</option><option>USD</option><option>ALL</option></select></label>
            </div>
            <label className="file-drop"><span className="upload-icon">↑</span><strong>{form.file?.name ?? "Zgjidh PDF-në e faturës"}</strong><span>{form.file ? `${(form.file.size / (1024 * 1024)).toFixed(2)} MB · gati për ngarkim` : "Kliko për të zgjedhur një PDF nga pajisja jote"}</span><small>PDF · maksimumi 10 MB</small><input type="file" accept="application/pdf,.pdf" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] })} required /></label>
            <p className="storage-warning">IPFS është publik: kushdo që ka CID mund ta lexojë dokumentin. Mos ngarko të dhëna konfidenciale ose personale.</p>
            <div className="form-footer"><span>Hash-i llogaritet lokalisht · transaksion testues</span><button className="primary-button" disabled={busy || wrongChain}>{busy ? "Duke ngarkuar dhe regjistruar…" : "Ngarko dhe regjistro →"}</button></div>
          </form>
          <aside className="panel pdf-preview-panel">
            <div className="panel-heading"><div><span className="section-kicker">PARAPAMJE LIVE</span><h3>Parapamja e faturës</h3><p>Kontrollo dokumentin përpara regjistrimit</p></div><span className="preview-tag">PDF</span></div>
            {previewUrl ? <iframe className="pdf-preview" src={previewUrl} title="Parapamje e PDF-së së faturës" /> : <div className="preview-empty"><div className="preview-document"><span>PDF</span><i>+</i><b /><b /><b /><b /></div><strong>Ngarko një faturë për ta parë</strong><span>Parapamja shfaqet këtu, dokumenti mbetet në pajisjen tënde deri në ngarkim.</span></div>}
            <div className="preview-security"><Icon name="shield" /><span><strong>SHA-256 i sigurt</strong><small>Hash-i llogaritet lokalisht në pajisjen tënde.</small></span></div>
          </aside>
          </div>
        </section>}

        {view === "details" && <section className="panel">
          <div className="panel-heading"><div><h3>Detajet dhe historia</h3><p>Zgjidh një faturë për të parë gjurmën e auditimit.</p></div><InvoiceSelect invoices={invoices} selectedId={selectedId} onChange={(id) => void loadDetails(id)} /></div>
          {selectedInvoice ? <><InvoiceSummary invoice={selectedInvoice} /><div className="timeline">
            {history.map((entry, index) => <div className="timeline-entry" key={`${entry.changedAt}-${index}`}><span className={`timeline-dot status-${statusClasses[entry.status]}`} /><div className="timeline-body"><strong>{statusNames[entry.status] ?? "Status i panjohur"}</strong><p>{entry.note}</p><small>{new Date(Number(entry.changedAt) * 1000).toLocaleString("sq-AL")} · {shortAddress(entry.changedBy)}</small></div></div>)}
            {history.length === 0 && <EmptyState text="Nuk ka histori për këtë faturë." />}
          </div></> : <EmptyState text="Zgjidh një faturë nga lista ose krijo faturën e parë." />}
        </section>}

        {view === "actions" && <section className="panel">
          <div className="panel-heading"><div><h3>Veprimet e faturës</h3><p>Vetëm biznesi dhe klienti mund të ndryshojnë statusin.</p></div><InvoiceSelect invoices={invoices} selectedId={selectedId} onChange={(id) => { setSelectedId(id); setActionNote(""); }} /></div>
          {selectedInvoice ? <>
            <InvoiceSummary invoice={selectedInvoice} />
            <div className="action-status"><span>Status aktual</span><StatusBadge status={selectedInvoice.status} /></div>
            {(canDispute || canCancel) && <label className="note-input">Arsye / shënim për kontestim ose anulim<textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={200} placeholder="Shkruaj një shënim të shkurtër…" /></label>}
            <div className="actions-grid">
              <ActionButton title="Dërgo faturën" detail="Biznesi e dërgon te klienti" disabled={busy || selectedInvoice.status !== 0 || !accountMatches(selectedInvoice.issuer, account)} onClick={() => void runAction("send")} />
              <ActionButton title="Prano faturën" detail="Klienti e pranon" disabled={busy || ![1, 3].includes(selectedInvoice.status) || !accountMatches(selectedInvoice.recipient, account)} onClick={() => void runAction("accept")} />
              <ActionButton title="Kontesto" detail="Klienti hap kontestim" disabled={busy || !canDispute} onClick={() => void runAction("dispute")} />
              <ActionButton title="Shëno si të paguar" detail="Klienti konfirmon pagesën" disabled={busy || selectedInvoice.status !== 2 || !accountMatches(selectedInvoice.recipient, account)} onClick={() => void runAction("pay")} />
              <ActionButton title="Anulo faturën" detail="Biznesi ose klienti, para pagesës" disabled={busy || !canCancel} onClick={() => void runAction("cancel")} />
            </div>
            {!connected && <p className="muted center">Lidh MetaMask me njërën nga adresat e faturës për të aktivizuar veprimet.</p>}
          </> : <EmptyState text="Zgjidh një faturë për të menaxhuar statusin e saj." />}
        </section>}

        {view === "verify" && <section className="verify-layout">
          <div className="panel">
            <div className="panel-heading"><div><h3>Verifiko dokumentin</h3><p>Krahaso hash-in SHA-256 të PDF-së me regjistrin publik.</p></div></div>
            <form ref={verifyFormRef} onSubmit={verifyInvoice} className="verify-form">
              <label>Fatura<InvoiceSelect invoices={invoices} selectedId={selectedId} onChange={(id) => { setSelectedId(id); setVerifyResult(""); }} /></label>
              <label className="file-drop compact"><span className="upload-icon">⌕</span><strong>{verifyFile?.name ?? "Zgjidh PDF-në për krahasim"}</strong><span>Hash-i llogaritet lokalisht, dokumenti nuk ngarkohet</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => { setVerifyFile(event.target.files?.[0]); setVerifyResult(""); }} required /></label>
              <button className="primary-button" disabled={!selectedInvoice || !verifyFile}>Verifiko hash-in →</button>
            </form>
            {verifyResult && <div className={`verification-result ${verifyResult}`}><span>{verifyResult === "match" ? "✓" : "!"}</span><div><strong>{verifyResult === "match" ? "Dokumenti përputhet" : "Dokumenti është ndryshuar"}</strong><p>{verifyResult === "match" ? "Hash-i i PDF-së përputhet me hash-in e regjistruar në blockchain." : "Hash-i ndryshon. PDF-ja nuk është i njëjti dokument që u regjistrua."}</p></div></div>}
          </div>
          {selectedInvoice && <div className="panel hash-panel"><span className="eyebrow">HASH-I I REGJISTRUAR</span><code>{selectedInvoice.documentHash}</code><span className="muted">ID e faturës #{selectedInvoice.id.toString()}</span></div>}
        </section>}
        {view === "verify" && <section className="panel verification-history-panel">
          <div className="panel-heading"><div><h3>Historiku i verifikimeve</h3><p>Rezultatet ruhen lokalisht në këtë shfletues.</p></div><span className="event-count">{verificationHistory.length} verifikime</span></div>
          {verificationHistory.length ? <div className="table-scroll"><table className="verification-history-table"><thead><tr>
            <th>FATURA</th><th>WALLET</th><th>HASH-I I PDF-SË</th><th>REZULTATI</th><th>DATA DHE ORA</th><th>HASH-I NË BLOCKCHAIN</th>
          </tr></thead><tbody>{verificationHistory.map((record, index) => <tr key={`${record.verifiedAt}-${record.invoiceId}-${index}`}>
            <td><strong>INV-{record.invoiceId.padStart(4, "0")}</strong></td>
            <td><code>{record.wallet}</code></td>
            <td><code>{record.pdfHash}</code></td>
            <td><span className={`verification-history-result ${record.result === "Valid" ? "valid" : "invalid"}`}>{record.result}</span></td>
            <td>{new Date(record.verifiedAt).toLocaleString("sq-AL")}</td>
            <td><code>{record.blockchainHash}</code></td>
          </tr>)}</tbody></table></div> : <EmptyState text="Nuk ka ende verifikime të ruajtura." />}
        </section>}
      </main>
    </div>
  );
}

function accountMatches(expected: string, actual: string) {
  return Boolean(actual) && expected.toLowerCase() === actual.toLowerCase();
}

function pageTitle(view: View) {
  return { overview: "Përmbledhje", register: "Regjistro faturë", details: "Historia e auditimit", actions: "Menaxho faturën", verify: "Verifiko dokumentin" }[view];
}

function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name].map((path) => <path d={path} key={path} />)}</svg>;
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: IconName; children: React.ReactNode }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span className="nav-icon"><Icon name={icon} /></span>{children}</button>;
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
  const metadataGateway = invoice.metadataURI.startsWith("ipfs://")
    ? `https://gateway.pinata.cloud/ipfs/${invoice.metadataURI.slice("ipfs://".length)}`
    : undefined;
  return <div className="invoice-summary"><div className="summary-top"><div><span className="eyebrow">FATURA</span><h2>INV-{invoice.id.toString().padStart(4, "0")}</h2></div><StatusBadge status={invoice.status} /></div><div className="summary-grid"><div><span>Biznesi</span><strong>{shortAddress(invoice.issuer)}</strong></div><div><span>Klienti</span><strong>{shortAddress(invoice.recipient)}</strong></div><div><span>Shuma</span><strong>{formatAmount(invoice.amount, invoice.currency)}</strong></div><div><span>Hash SHA-256</span><code>{invoice.documentHash.slice(0, 18)}…</code></div><div><span>Dokumenti IPFS</span>{metadataGateway ? <a href={metadataGateway} target="_blank" rel="noreferrer">Hap metadata ↗</a> : <strong>{invoice.metadataURI || "Nuk u ruajt"}</strong>}</div></div></div>;
}

function ActionButton({ title, detail, disabled, onClick }: { title: string; detail: string; disabled: boolean; onClick: () => void }) {
  return <button className="action-card" disabled={disabled} onClick={onClick}><span className="action-arrow">↗</span><strong>{title}</strong><small>{detail}</small></button>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>▤</span><p>{text}</p></div>;
}
