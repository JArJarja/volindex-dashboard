// pages/index.tsx
import { useState, useCallback, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { fetchTop, TopRow } from "../lib/api";
import { useTopWS } from "../lib/wsClient";
import dynamic from "next/dynamic";

const TradingViewWidget = dynamic(() => import("../components/TradingViewWidget"), { ssr: false });

// ── constantes ────────────────────────────────────────────────────────────────

const CRYPTO_SYMBOLS = new Set([
  "BINANCE:BTCUSDT","BINANCE:ETHUSDT","BINANCE:SOLUSDT",
  "BINANCE:DOGEUSDT","BINANCE:SHIBUSDT","BINANCE:PEPEUSDT",
  "BINANCE:WIFUSDT","BINANCE:BONKUSDT",
]);

const ETF_SYMBOLS = new Set([
  "SPY","QQQ","DIA","IWM","IVV","VTI","EFA","EEM","GLD","SLV",
  "TLT","IEF","HYG","LQD","XLE","XLF","XLK","XLV","XLI","XLC",
  "XLY","XLP","XLU","XLB","XLRE","USO","BNO","UNG","VXX","UVXY",
  "SQQQ","TQQQ","UPRO","SPXS","FXI","EWJ","EWZ","EWG","EWU",
  "GDX","SMH","ARKK",
]);

const CAC40_SYMBOLS = new Set([
  "OR","MC","TTE","SAN","AIR","BNP","SU","HO","SAF","AI",
  "DG","RI","CAP","BN","DSY","AXA","SG","RMS","EL","KER",
]);

const TECH_SYMBOLS = new Set([
  "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSM","AVGO","ORCL","ASML",
]);

// TradingView symbol mapping
const TV_MAP: Record<string, string> = {
  "BINANCE:BTCUSDT":"BINANCE:BTCUSDT","BINANCE:ETHUSDT":"BINANCE:ETHUSDT",
  "BINANCE:SOLUSDT":"BINANCE:SOLUSDT","BINANCE:DOGEUSDT":"BINANCE:DOGEUSDT",
  "BINANCE:SHIBUSDT":"BINANCE:SHIBUSDT","BINANCE:PEPEUSDT":"BINANCE:PEPEUSDT",
  "BINANCE:WIFUSDT":"BINANCE:WIFUSDT","BINANCE:BONKUSDT":"BINANCE:BONKUSDT",
  "OR":"EURONEXT:OR","MC":"EURONEXT:MC","TTE":"EURONEXT:TTE","SAN":"EURONEXT:SAN",
  "AIR":"EURONEXT:AIR","BNP":"EURONEXT:BNP","SU":"EURONEXT:SU","HO":"EURONEXT:HO",
  "SAF":"EURONEXT:SAF","AI":"EURONEXT:AI","DG":"EURONEXT:DG","RI":"EURONEXT:RI",
  "CAP":"EURONEXT:CAP","BN":"EURONEXT:BN","DSY":"EURONEXT:DSY","AXA":"EURONEXT:CS",
  "SG":"EURONEXT:GLE","RMS":"EURONEXT:RMS","EL":"EURONEXT:EL","KER":"EURONEXT:KER",
  "AAPL":"NASDAQ:AAPL","MSFT":"NASDAQ:MSFT","NVDA":"NASDAQ:NVDA","GOOGL":"NASDAQ:GOOGL",
  "META":"NASDAQ:META","AMZN":"NASDAQ:AMZN","TSM":"NYSE:TSM","AVGO":"NASDAQ:AVGO",
  "ORCL":"NYSE:ORCL","ASML":"NASDAQ:ASML",
};

function tvSym(symbol: string): string {
  return TV_MAP[symbol] || `AMEX:${symbol}`;
}

function isMarketOpen(exchange: "US"|"EU"): boolean {
  const now = new Date();
  if (exchange === "US") {
    const ny = new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
    const d = ny.getDay();
    if (d===0||d===6) return false;
    const m = ny.getHours()*60+ny.getMinutes();
    return m>=570 && m<960;
  } else {
    const par = new Date(now.toLocaleString("en-US",{timeZone:"Europe/Paris"}));
    const d = par.getDay();
    if (d===0||d===6) return false;
    const m = par.getHours()*60+par.getMinutes();
    return m>=540 && m<1020; // 9h-17h Paris
  }
}

type TabKey = "crypto"|"etf"|"actions";
type Period = "24h"|"1W"|"1M"|"YTD"|"1Y"|"5Y";
type ActionSub = "all"|"cac40"|"tech";

const PERIOD_LABELS: Record<string,string> = {
  "24h":"24h","1W":"Semaine","1M":"Mois","YTD":"YTD","1Y":"1 an","5Y":"5 ans",
};

const BIAS_COLOR: Record<string,string> = {
  haussier:"var(--bull)", baissier:"var(--bear)", neutre:"var(--neutral)",
};

function fmtPrice(p: number, sym: string): string {
  if (p===0) return "—";
  if (p<0.00001) return p.toExponential(2);
  if (p<0.01) return p.toFixed(6);
  if (p<1) return p.toFixed(4);
  if (p>10000) return p.toLocaleString("fr-FR",{maximumFractionDigits:0});
  return p.toFixed(2);
}

function displaySym(symbol: string): string {
  return symbol.replace("BINANCE:","").replace("USDT","");
}

function getExchange(symbol: string): string {
  if (CRYPTO_SYMBOLS.has(symbol)) return "24/7";
  if (CAC40_SYMBOLS.has(symbol)) return "EU";
  return "US";
}

// ── composants UI ─────────────────────────────────────────────────────────────

function Pill({ active, onClick, children }: { active:boolean; onClick:()=>void; children:React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding:"3px 10px", borderRadius:4, fontFamily:"monospace", fontSize:10,
      cursor:"pointer", border:`1px solid ${active?"var(--acc)":"var(--brd)"}`,
      background:active?"var(--acc)":"var(--surf)",
      color:active?"#000":"var(--neu)", fontWeight:active?600:400,
    }}>{children}</button>
  );
}

function ConfBar({ value }:{ value:number }) {
  const color = value>=70?"var(--bull)":value>=40?"var(--warn)":"var(--mut)";
  return (
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{flex:1,height:3,background:"var(--brd)",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:`${value}%`,height:"100%",background:color}}/>
      </div>
      <span style={{fontFamily:"monospace",fontSize:10,color,minWidth:22,textAlign:"right"}}>{value}</span>
    </div>
  );
}

function MarketBadge({ sym }:{ sym:string }) {
  const ex = getExchange(sym);
  if (ex==="24/7") return <span style={{fontSize:9,fontFamily:"monospace",color:"var(--acc)",background:"rgba(0,196,154,.1)",padding:"1px 5px",borderRadius:3}}>24/7</span>;
  const open = isMarketOpen(ex as "US"|"EU");
  return (
    <span style={{fontSize:9,fontFamily:"monospace",padding:"1px 5px",borderRadius:3,
      color:open?"var(--bull)":"var(--neu)",
      background:open?"rgba(0,196,154,.1)":"rgba(122,128,152,.1)"}}>
      {open?"OUVERT":"FERMÉ"}
    </span>
  );
}

// ── tableau principal ──────────────────────────────────────────────────────────

function Table({ rows, selected, onSelect, period }:{
  rows:TopRow[]; selected:string; onSelect:(r:TopRow)=>void; period:Period;
}) {
  type SK = "vol_volume_score"|"change_pct"|"price"|"realized_vol"|"confidence";
  const [sk, setSk] = useState<SK>("vol_volume_score");
  const [sd, setSd] = useState<1|-1>(-1);
  const [hideClosed, setHideClosed] = useState(false);

  function sort(k:SK){ if(k===sk)setSd(d=>d===1?-1:1); else{setSk(k);setSd(-1);} }

  const hasClosed = rows.some(r=>r.price===0 && !CRYPTO_SYMBOLS.has(r.symbol));
  const filtered = hideClosed ? rows.filter(r=>r.price>0||CRYPTO_SYMBOLS.has(r.symbol)) : rows;
  const sorted = [...filtered].sort((a,b)=>sd*((b[sk] as number)-(a[sk] as number)));

  function Th({label,k,right}:{label:string;k?:SK;right?:boolean}){
    return (
      <th onClick={()=>k&&sort(k)} style={{
        padding:"6px 8px",fontFamily:"monospace",fontSize:10,letterSpacing:".06em",
        textAlign:right?"right":"left",cursor:k?"pointer":"default",
        color:k===sk?"var(--acc)":"var(--neu)",userSelect:"none",whiteSpace:"nowrap",
      }}>
        {label}{k===sk&&(sd===-1?" ↓":" ↑")}
      </th>
    );
  }

  return (
    <div>
      {hasClosed && (
        <div style={{marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
          <label style={{display:"flex",alignItems:"center",gap:5,fontFamily:"monospace",fontSize:10,color:"var(--neu)",cursor:"pointer"}}>
            <input type="checkbox" checked={hideClosed} onChange={e=>setHideClosed(e.target.checked)} style={{accentColor:"var(--acc)"}}/>
            Masquer les marchés fermés
          </label>
        </div>
      )}
      <div style={{overflowX:"auto",borderRadius:6,border:"1px solid var(--brd)"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:"var(--surf)",borderBottom:"1px solid var(--brd)"}}>
              <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"var(--neu)",textAlign:"left"}}>#</th>
              <Th label="SYMB"/>
              <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"var(--neu)",textAlign:"left"}}>NOM</th>
              <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"var(--neu)"}}>MARCHÉ</th>
              <Th label="PRIX" k="price" right/>
              <Th label={period==="24h"?"VAR% 24H":`VAR% ≈24H`} k="change_pct" right/>
              <Th label="VOL.RÉ." k="realized_vol" right/>
              <Th label="SCORE" k="vol_volume_score" right/>
              <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"var(--neu)"}}>BIAIS</th>
              <Th label="CONF." k="confidence"/>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row,i)=>{
              const sel = row.symbol===selected;
              const closed = row.price===0 && !CRYPTO_SYMBOLS.has(row.symbol);
              return (
                <tr key={row.symbol} onClick={()=>onSelect(row)} style={{
                  borderTop:"1px solid var(--brd)",cursor:"pointer",
                  background:sel?"rgba(0,196,154,.07)":closed?"rgba(122,128,152,.03)":"transparent",
                  opacity:closed?.55:1,
                }}>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10,color:"var(--neu)"}}>{i+1}</td>
                  <td style={{padding:"5px 8px"}}>
                    <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:"var(--acc)"}}>
                      {displaySym(row.symbol)}
                    </span>
                  </td>
                  <td style={{padding:"5px 8px",fontSize:11,color:"var(--neu)",maxWidth:180}}>
                    <span style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.name}</span>
                  </td>
                  <td style={{padding:"5px 8px"}}><MarketBadge sym={row.symbol}/></td>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",color:closed?"var(--neu)":"var(--txt)"}}>
                    {closed?"—":fmtPrice(row.price,row.symbol)}
                  </td>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",color:row.change_pct>=0?"var(--bull)":"var(--bear)"}}>
                    {closed?"—":`${row.change_pct>=0?"+":""}${row.change_pct.toFixed(2)}%`}
                  </td>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",color:"var(--neu)"}}>
                    {row.realized_vol>0?(row.realized_vol*100).toFixed(3)+"%":"—"}
                  </td>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",fontWeight:700,color:"var(--acc)"}}>
                    {row.vol_volume_score.toFixed(3)}
                  </td>
                  <td style={{padding:"5px 8px"}}>
                    <span style={{
                      padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:10,fontWeight:600,
                      color:BIAS_COLOR[row.bias]||"var(--neu)",
                      background:`${BIAS_COLOR[row.bias]||"#888"}18`,
                    }}>{row.bias.toUpperCase()}</span>
                  </td>
                  <td style={{padding:"5px 8px",minWidth:110}}><ConfBar value={row.confidence}/></td>
                </tr>
              );
            })}
            {sorted.length===0&&(
              <tr><td colSpan={10} style={{padding:28,textAlign:"center",fontFamily:"monospace",fontSize:11,color:"var(--neu)"}}>
                Aucune donnée disponible
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── page principale ────────────────────────────────────────────────────────────

export default function HomePage() {
  const [allRows, setAllRows] = useState<TopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("crypto");
  const [actionSub, setActionSub] = useState<ActionSub>("all");
  const [period, setPeriod] = useState<Period>("24h");
  const [selected, setSelected] = useState<TopRow|null>(null);
  const [lastUpdate, setLastUpdate] = useState("");
  const [error, setError] = useState("");

  async function load(){
    setLoading(true); setError("");
    try {
      const data = await fetchTop(60,"1",200);
      setAllRows(data);
      setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
      if(!selected && data.length>0){
        const first = data.find(r=>CRYPTO_SYMBOLS.has(r.symbol))||data[0];
        setSelected(first);
      }
    } catch(e:any){ setError(e.message||"Erreur backend"); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{load();},[]);
  useEffect(()=>{const id=setInterval(load,30000);return()=>clearInterval(id);},[]);

  const onWs = useCallback((data:TopRow[])=>{
    setAllRows(data);
    setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
    setLoading(false);
  },[]);
  const wsConnected = useTopWS(onWs);

  // Filtrage par onglet
  const cryptoRows  = allRows.filter(r=>CRYPTO_SYMBOLS.has(r.symbol));
  const etfRows     = allRows.filter(r=>ETF_SYMBOLS.has(r.symbol));
  const cac40Rows   = allRows.filter(r=>CAC40_SYMBOLS.has(r.symbol));
  const techRows    = allRows.filter(r=>TECH_SYMBOLS.has(r.symbol));
  const actionsRows = allRows.filter(r=>CAC40_SYMBOLS.has(r.symbol)||TECH_SYMBOLS.has(r.symbol));

  const activeRows = tab==="crypto" ? cryptoRows
    : tab==="etf" ? etfRows
    : actionSub==="cac40" ? cac40Rows
    : actionSub==="tech"  ? techRows
    : actionsRows;

  const tabCounts = {
    crypto: cryptoRows.length,
    etf: etfRows.length,
    actions: actionsRows.length,
  };

  return (
    <>
      <Head><title>VOLINDEX · Dashboard</title></Head>

      <div style={{display:"flex",flexDirection:"column",gap:14}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div>
            <h1 style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:"var(--acc)",letterSpacing:".05em"}}>
              VOLINDEX DASHBOARD
            </h1>
            <p style={{fontFamily:"monospace",fontSize:10,color:"var(--neu)",marginTop:2}}>
              {allRows.length} instruments · {lastUpdate&&`Mis à jour ${lastUpdate}`}
              {loading&&" · Chargement…"}
            </p>
          </div>
          <span style={{fontFamily:"monospace",fontSize:10,color:wsConnected?"var(--bull)":"var(--neu)"}}>
            {wsConnected?"● LIVE":"○ POLLING"}
          </span>
        </div>

        {error&&(
          <div style={{borderRadius:6,border:"1px solid var(--bear)",background:"rgba(224,80,96,.08)",padding:"10px 14px",fontFamily:"monospace",fontSize:12,color:"var(--bear)"}}>
            ⚠ {error}
          </div>
        )}

        {/* Layout 2 colonnes */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 420px",gap:14,alignItems:"start"}}>

          {/* ── Colonne gauche : tableaux ── */}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>

            {/* Onglets principaux */}
            <div style={{display:"flex",alignItems:"stretch",borderBottom:"1px solid var(--brd)",gap:0}}>
              {(["crypto","etf","actions"] as TabKey[]).map(t=>(
                <button key={t} onClick={()=>setTab(t)} style={{
                  padding:"9px 16px",fontFamily:"monospace",fontSize:11,letterSpacing:".08em",
                  cursor:"pointer",background:"transparent",border:"none",
                  color:tab===t?"var(--acc)":"var(--neu)",
                  borderBottom:tab===t?"2px solid var(--acc)":"2px solid transparent",
                }}>
                  {t==="crypto"?"🪙":"t"==="etf"?"📊":"🏢"}
                  {t==="crypto"?" CRYPTO":t==="etf"?" ETF":" ACTIONS"} ({tabCounts[t]})
                </button>
              ))}

              {/* Période */}
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,paddingBottom:6}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"var(--neu)"}}>VAR% :</span>
                {(["24h","1W","1M","YTD","1Y","5Y"] as Period[]).map(p=>(
                  <Pill key={p} active={period===p} onClick={()=>setPeriod(p)}>
                    {PERIOD_LABELS[p]}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Sous-onglets Actions */}
            {tab==="actions"&&(
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"var(--neu)"}}>Filtrer :</span>
                {([["all","Tout ("+actionsRows.length+")"],["cac40","🇫🇷 CAC40 ("+cac40Rows.length+")"],["tech","💻 Tech US ("+techRows.length+")"]] as [ActionSub,string][]).map(([k,l])=>(
                  <Pill key={k} active={actionSub===k} onClick={()=>setActionSub(k)}>{l}</Pill>
                ))}
              </div>
            )}

            {/* Note période */}
            {period!=="24h"&&(
              <div style={{background:"rgba(240,165,0,.08)",border:"1px solid rgba(240,165,0,.25)",borderRadius:5,padding:"6px 12px",fontFamily:"monospace",fontSize:10,color:"var(--warn)"}}>
                ℹ Les variations historiques ({PERIOD_LABELS[period]}) nécessitent un plan Finnhub payant. Affichage variation 24h.
              </div>
            )}

            {/* Tableau */}
            {loading&&allRows.length===0?(
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",height:180}}>
                <div style={{width:26,height:26,borderRadius:"50%",border:"2px solid var(--acc)",borderTopColor:"transparent",animation:"spin 1s linear infinite"}}/>
              </div>
            ):(
              <Table rows={activeRows} selected={selected?.symbol||""} onSelect={setSelected} period={period}/>
            )}
          </div>

          {/* ── Colonne droite : widget ── */}
          <div style={{display:"flex",flexDirection:"column",gap:10,position:"sticky",top:60}}>

            {/* Fiche instrument */}
            {selected&&(
              <div style={{background:"var(--surf)",border:"1px solid var(--brd)",borderRadius:6,padding:"10px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:6}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:15,fontWeight:700,color:"var(--acc)"}}>{displaySym(selected.symbol)}</div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:"var(--neu)",marginTop:2}}>{selected.name}</div>
                    <div style={{marginTop:4}}><MarketBadge sym={selected.symbol}/></div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"monospace",fontSize:17,fontWeight:600,color:"var(--txt)"}}>
                      {selected.price>0?fmtPrice(selected.price,selected.symbol):"—"}
                    </div>
                    <div style={{fontFamily:"monospace",fontSize:12,color:selected.change_pct>=0?"var(--bull)":"var(--bear)"}}>
                      {selected.change_pct>=0?"+":""}{selected.change_pct.toFixed(2)}%
                    </div>
                  </div>
                </div>
                {/* Métriques */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:1,background:"var(--brd)",borderRadius:4,marginTop:10,overflow:"hidden"}}>
                  {[
                    {l:"SCORE",v:selected.vol_volume_score.toFixed(3),c:"var(--acc)"},
                    {l:"BIAIS",v:selected.bias.toUpperCase(),c:BIAS_COLOR[selected.bias]},
                    {l:"CONF.",v:selected.confidence+"/100",c:selected.confidence>=70?"var(--bull)":"var(--warn)"},
                  ].map(m=>(
                    <div key={m.l} style={{background:"var(--surf)",padding:"7px 8px",textAlign:"center"}}>
                      <div style={{fontFamily:"monospace",fontSize:9,color:"var(--neu)",marginBottom:2}}>{m.l}</div>
                      <div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:m.c}}>{m.v}</div>
                    </div>
                  ))}
                </div>
                <Link href={`/index/${encodeURIComponent(selected.symbol)}`}
                  style={{display:"block",marginTop:8,fontFamily:"monospace",fontSize:10,color:"var(--acc)",textDecoration:"none",textAlign:"center",padding:"5px",border:"1px solid var(--brd)",borderRadius:4}}>
                  Diagnostic complet + point de vue →
                </Link>
              </div>
            )}

            {/* TradingView — agrandi */}
            <div style={{background:"var(--surf)",border:"1px solid var(--brd)",borderRadius:6,overflow:"hidden"}}>
              <div style={{padding:"8px 12px",borderBottom:"1px solid var(--brd)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"var(--neu)",letterSpacing:".08em"}}>TRADINGVIEW</span>
                <span style={{fontFamily:"monospace",fontSize:10,color:"var(--acc)"}}>{selected?tvSym(selected.symbol):"—"}</span>
              </div>
              {selected?(
                <TradingViewWidget symbol={tvSym(selected.symbol)} height={480}/>
              ):(
                <div style={{height:480,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",fontSize:11,color:"var(--neu)"}}>
                  Sélectionnez un instrument
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        :root{
          --acc:#00c49a;--bear:#e05060;--bull:#00c49a;
          --neu:#7a8098;--mut:#3a3f55;--warn:#d49a00;
          --surf:#0f1117;--brd:#1e2130;--txt:#c8cfe0;
        }
      `}</style>
    </>
  );
}
