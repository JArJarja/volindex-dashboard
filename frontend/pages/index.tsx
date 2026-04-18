// pages/index.tsx
import { useState, useCallback, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { fetchTop, TopRow } from "../lib/api";
import { useTopWS } from "../lib/wsClient";
import { localCache } from "../lib/localCache";
import dynamic from "next/dynamic";

const TradingViewWidget = dynamic(() => import("../components/TradingViewWidget"), { ssr: false });

// ── Constantes ────────────────────────────────────────────────────────────────
const CRYPTO_SYMBOLS = new Set(["BINANCE:BTCUSDT","BINANCE:ETHUSDT","BINANCE:SOLUSDT","BINANCE:DOGEUSDT","BINANCE:SHIBUSDT","BINANCE:PEPEUSDT","BINANCE:WIFUSDT","BINANCE:BONKUSDT"]);
const ETF_SYMBOLS    = new Set(["SPY","QQQ","DIA","IWM","IVV","VTI","EFA","EEM","GLD","SLV","TLT","IEF","HYG","LQD","XLE","XLF","XLK","XLV","XLI","XLC","XLY","XLP","XLU","XLB","XLRE","USO","BNO","VXX","UVXY","SQQQ","TQQQ","UPRO","FXI","GDX","SMH","ARKK"]);
const CAC40_SYMBOLS  = new Set(["OR.PA","MC.PA","TTE.PA","SAN.PA","AIR.PA","BNP.PA","SU.PA","HO.PA","SAF.PA","AI.PA","DG.PA","RI.PA","CAP.PA","BN.PA","DSY.PA","CS.PA","GLE.PA","RMS.PA","EL.PA","KER.PA"]);
const TECH_SYMBOLS   = new Set(["AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSM","AVGO","ORCL","ASML"]);

const TV_MAP: Record<string,string> = {
  "BINANCE:BTCUSDT":"BINANCE:BTCUSDT","BINANCE:ETHUSDT":"BINANCE:ETHUSDT","BINANCE:SOLUSDT":"BINANCE:SOLUSDT","BINANCE:DOGEUSDT":"BINANCE:DOGEUSDT","BINANCE:SHIBUSDT":"BINANCE:SHIBUSDT","BINANCE:PEPEUSDT":"BINANCE:PEPEUSDT","BINANCE:WIFUSDT":"BINANCE:WIFUSDT","BINANCE:BONKUSDT":"BINANCE:BONKUSDT",
  "OR.PA":"EURONEXT:OR","MC.PA":"EURONEXT:MC","TTE.PA":"EURONEXT:TTE","SAN.PA":"EURONEXT:SAN","AIR.PA":"EURONEXT:AIR","BNP.PA":"EURONEXT:BNP","SU.PA":"EURONEXT:SU","HO.PA":"EURONEXT:HO","SAF.PA":"EURONEXT:SAF","AI.PA":"EURONEXT:AI","DG.PA":"EURONEXT:DG","RI.PA":"EURONEXT:RI","CAP.PA":"EURONEXT:CAP","BN.PA":"EURONEXT:BN","DSY.PA":"EURONEXT:DSY","CS.PA":"EURONEXT:CS","GLE.PA":"EURONEXT:GLE","RMS.PA":"EURONEXT:RMS","EL.PA":"EURONEXT:EL","KER.PA":"EURONEXT:KER",
  "AAPL":"NASDAQ:AAPL","MSFT":"NASDAQ:MSFT","NVDA":"NASDAQ:NVDA","GOOGL":"NASDAQ:GOOGL","META":"NASDAQ:META","AMZN":"NASDAQ:AMZN","TSM":"NYSE:TSM","AVGO":"NASDAQ:AVGO","ORCL":"NYSE:ORCL","ASML":"NASDAQ:ASML",
};
const tvSym = (s: string) => TV_MAP[s] || `AMEX:${s}`;

function isMarketOpen(exchange: "US"|"EU"): boolean {
  const tz = exchange==="EU" ? "Europe/Paris" : "America/New_York";
  const now = new Date(new Date().toLocaleString("en-US",{timeZone:tz}));
  const d=now.getDay(), m=now.getHours()*60+now.getMinutes();
  if(d===0||d===6) return false;
  return exchange==="EU" ? m>=540&&m<1020 : m>=570&&m<960;
}

function getExchange(sym: string): "crypto"|"EU"|"US" {
  if(CRYPTO_SYMBOLS.has(sym)) return "crypto";
  if(CAC40_SYMBOLS.has(sym)) return "EU";
  return "US";
}

function dispSym(s: string){ return s.replace("BINANCE:","").replace("USDT","").replace(".PA",""); }
function fmtPrice(p: number){ if(p<=0)return "—"; if(p<0.00001)return p.toExponential(2); if(p<0.01)return p.toFixed(6); if(p<1)return p.toFixed(4); if(p>10000)return p.toLocaleString("fr-FR",{maximumFractionDigits:0}); return p.toFixed(2); }

type TabKey="crypto"|"etf"|"actions";
type Period="24h"|"1W"|"1M"|"YTD"|"1Y"|"5Y";
type ActionSub="all"|"cac40"|"tech"|"open_actions"|"closed_actions"|"all_etf"|"open_etf"|"closed_etf";

const PERIOD_LABELS: Record<string,string>={  "24h":"24h","1W":"Semaine","1M":"Mois","YTD":"YTD","1Y":"1 an","5Y":"5 ans"};
const BIAS_COLOR: Record<string,string>={ haussier:"#00c49a",baissier:"#e05060",neutre:"#7a8098"};

// ── Composants UI ─────────────────────────────────────────────────────────────
function Pill({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){
  return(
    <button onClick={onClick} style={{padding:"3px 10px",borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer",border:`1px solid ${active?"#00c49a":"#1e2130"}`,background:active?"#00c49a":"#0f1117",color:active?"#000":"#7a8098",fontWeight:active?600:400}}>
      {children}
    </button>
  );
}

function ConfBar({value}:{value:number}){
  const color=value>=70?"#00c49a":value>=40?"#d49a00":"#3a3f55";
  return(
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{flex:1,height:3,background:"#1e2130",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:`${value}%`,height:"100%",background:color}}/>
      </div>
      <span style={{fontFamily:"monospace",fontSize:10,color,minWidth:22,textAlign:"right"}}>{value}</span>
    </div>
  );
}

function MarketBadge({sym}:{sym:string}){
  const ex=getExchange(sym);
  if(ex==="crypto") return <span style={{fontSize:9,fontFamily:"monospace",color:"#00c49a",background:"rgba(0,196,154,.1)",padding:"1px 5px",borderRadius:3}}>24/7</span>;
  const open=isMarketOpen(ex);
  return <span style={{fontSize:9,fontFamily:"monospace",padding:"1px 5px",borderRadius:3,color:open?"#00c49a":"#7a8098",background:open?"rgba(0,196,154,.1)":"rgba(122,128,152,.1)"}}>{open?"OUVERT":"FERMÉ"}</span>;
}

// ── Tableau ───────────────────────────────────────────────────────────────────
function Table({rows,selected,onSelect,period,usMarketOpen,euMarketOpen}:{rows:TopRow[];selected:string;onSelect:(r:TopRow)=>void;period:Period;usMarketOpen:boolean;euMarketOpen:boolean;}){
  type SK="vol_volume_score"|"change_pct"|"price"|"realized_vol"|"confidence";
  const[sk,setSk]=useState<SK>("vol_volume_score");
  const[sd,setSd]=useState<1|-1>(-1);
  function sort(k:SK){if(k===sk)setSd(d=>d===1?-1:1);else{setSk(k);setSd(-1);}}
  const sorted=[...rows].sort((a,b)=>sd*((b[sk] as number)-(a[sk] as number)));

  function Th({label,k,right}:{label:string;k?:SK;right?:boolean}){
    return(
      <th onClick={()=>k&&sort(k)} style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,letterSpacing:".06em",textAlign:right?"right":"left",cursor:k?"pointer":"default",color:k===sk?"#00c49a":"#7a8098",userSelect:"none",whiteSpace:"nowrap"}}>
        {label}{k===sk&&(sd===-1?" ↓":" ↑")}
      </th>
    );
  }

  return(
    <div style={{overflowX:"auto",borderRadius:6,border:"1px solid #1e2130"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead>
          <tr style={{background:"#0f1117",borderBottom:"1px solid #1e2130"}}>
            <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"#7a8098",textAlign:"left"}}>#</th>
            <Th label="SYMB"/>
            <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"#7a8098",textAlign:"left"}}>NOM</th>
            <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>MARCHÉ</th>
            <Th label="PRIX" k="price" right/>
            <Th label={period==="24h"?"VAR% 24H":"VAR% ≈24H"} k="change_pct" right/>
            <Th label="VOL.RÉ." k="realized_vol" right/>
            <Th label="SCORE" k="vol_volume_score" right/>
            <th style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>BIAIS</th>
            <Th label="CONF." k="confidence"/>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row,i)=>{
            const sel=row.symbol===selected;
            const ex=getExchange(row.symbol);
            const closed=ex!=="crypto"&&(ex==="EU"?!euMarketOpen:!usMarketOpen);
            return(
              <tr key={row.symbol} onClick={()=>onSelect(row)} style={{borderTop:"1px solid #1e2130",cursor:"pointer",background:sel?"rgba(0,196,154,.07)":closed?"rgba(122,128,152,.02)":"transparent",opacity:closed?.75:1,transition:"background .15s"}}>
                <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>{i+1}</td>
                <td style={{padding:"5px 8px"}}>
                  <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#00c49a"}}>{dispSym(row.symbol)}</span>
                </td>
                <td style={{padding:"5px 8px",fontSize:11,color:"#7a8098",maxWidth:180}}>
                  <span style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.name}</span>
                </td>
                <td style={{padding:"5px 8px"}}><MarketBadge sym={row.symbol}/></td>
                <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",color:"#c8cfe0"}}>{fmtPrice(row.price)}</td>
                <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",color:row.change_pct>=0?"#00c49a":"#e05060"}}>
                  {row.change_pct!==0?`${row.change_pct>=0?"+":""}${row.change_pct.toFixed(2)}%`:"—"}
                </td>
                <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",color:"#7a8098"}}>
                  {row.realized_vol>0?(row.realized_vol*100).toFixed(3)+"%":"—"}
                </td>
                <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,textAlign:"right",fontWeight:700,color:"#00c49a"}}>{row.vol_volume_score.toFixed(3)}</td>
                <td style={{padding:"5px 8px"}}>
                  <span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:10,fontWeight:600,color:BIAS_COLOR[row.bias]||"#7a8098",background:`${BIAS_COLOR[row.bias]||"#888"}18`}}>
                    {row.bias.toUpperCase()}
                  </span>
                </td>
                <td style={{padding:"5px 8px",minWidth:110}}><ConfBar value={row.confidence}/></td>
              </tr>
            );
          })}
          {sorted.length===0&&(
            <tr><td colSpan={10} style={{padding:28,textAlign:"center",fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Aucune donnée</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function HomePage(){
  // Charger depuis cache d'abord pour éviter flash vide
  const[allRows,setAllRows]=useState<TopRow[]>(()=>localCache.getStale<TopRow[]>("top:rows")||[]);
  const[loading,setLoading]=useState(()=>localCache.isStale("top:rows"));
  const[refreshing,setRefreshing]=useState(false);
  const[tab,setTab]=useState<TabKey>("crypto");
  const[actionSub,setActionSub]=useState<ActionSub>("all");
  const[period,setPeriod]=useState<Period>("24h");
  const[selected,setSelected]=useState<TopRow|null>(()=>{
    const rows=localCache.getStale<TopRow[]>("top:rows")||[];
    return rows.find(r=>CRYPTO_SYMBOLS.has(r.symbol))||rows[0]||null;
  });
  const[lastUpdate,setLastUpdate]=useState("");
  const[error,setError]=useState("");
  const[tvFullscreen,setTvFullscreen]=useState(false);
  const[alerts,setAlerts]=useState<any[]>([]);
  const loadingRef=useRef(false);

  // Fermer plein écran avec Escape
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setTvFullscreen(false);};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);

  // Charger alertes
  async function loadAlerts(){
    try{
      const r=await fetch(`${process.env.NEXT_PUBLIC_API_URL||"http://localhost:8000"}/api/alerts`);
      if(r.ok){const d=await r.json();setAlerts(d.alerts||[]);}
    }catch{}
  }

  async function load(showSpinner=false){
    if(loadingRef.current) return; // Éviter appels parallèles
    loadingRef.current=true;
    if(showSpinner) setLoading(true);
    else setRefreshing(true);
    setError("");
    try{
      const data=await fetchTop(60,"1",200);
      if(data.length>0){
        setAllRows(data);
        localCache.set("top:rows",data,90_000); // 90s cache
        setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
        // Garder la sélection si elle est toujours dans les données
        setSelected(prev=>{
          if(prev){
            const found=data.find(r=>r.symbol===prev.symbol);
            if(found) return found;
          }
          return data.find(r=>CRYPTO_SYMBOLS.has(r.symbol))||data[0]||null;
        });
      }
    }catch(e:any){
      setError(e.message||"Erreur backend");
      // Garder les données existantes du cache
    }finally{
      setLoading(false);setRefreshing(false);loadingRef.current=false;
    }
  }

  useEffect(()=>{
    load(allRows.length===0);
    loadAlerts();
  },[]);

  // Refresh toutes les 30s sans vider les données
  useEffect(()=>{
    const id=setInterval(()=>{load(false);loadAlerts();},30000);
    return()=>clearInterval(id);
  },[]);

  // WebSocket — mise à jour sans flash
  const onWs=useCallback((data:TopRow[])=>{
    if(data.length===0) return; // Ignorer updates vides
    setAllRows(data);
    localCache.set("top:rows",data,90_000);
    setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
    setSelected(prev=>{
      if(prev){const found=data.find(r=>r.symbol===prev.symbol);if(found)return found;}
      return prev;
    });
  },[]);
  const wsConnected=useTopWS(onWs);

  function setTabAndReset(t:TabKey){
    setTab(t);
    if(t==="etf") setActionSub("all_etf" as ActionSub);
    else setActionSub("all");
  }

  const usMarketOpen=isMarketOpen("US");
  const euMarketOpen=isMarketOpen("EU");

  const cryptoRows =allRows.filter(r=>CRYPTO_SYMBOLS.has(r.symbol));
  const etfRows    =allRows.filter(r=>ETF_SYMBOLS.has(r.symbol));
  const cac40Rows  =allRows.filter(r=>CAC40_SYMBOLS.has(r.symbol));
  const techRows   =allRows.filter(r=>TECH_SYMBOLS.has(r.symbol));
  const actionsRows=allRows.filter(r=>CAC40_SYMBOLS.has(r.symbol)||TECH_SYMBOLS.has(r.symbol));

  const activeRows=
    tab==="crypto" ? cryptoRows
    : tab==="etf" ? (
        actionSub==="open_etf"   ? etfRows.filter(r=>ETF_SYMBOLS.has(r.symbol)&&usMarketOpen)
      : actionSub==="closed_etf" ? etfRows.filter(r=>!usMarketOpen?true:r.price===0)
      : etfRows
    )
    : (
        actionSub==="cac40"          ? cac40Rows
      : actionSub==="tech"           ? techRows
      : actionSub==="open_actions"   ? actionsRows.filter(r=>CAC40_SYMBOLS.has(r.symbol)?euMarketOpen:usMarketOpen)
      : actionSub==="closed_actions" ? actionsRows.filter(r=>CAC40_SYMBOLS.has(r.symbol)?!euMarketOpen:!usMarketOpen)
      : actionsRows
    );

  const tabCounts={crypto:cryptoRows.length,etf:etfRows.length,actions:actionsRows.length};

  return(
    <>
      <Head><title>VOLINDEX · Dashboard</title></Head>

      {/* Overlay plein écran TradingView */}
      {tvFullscreen&&selected&&(
        <div style={{position:"fixed",inset:0,zIndex:9999,background:"#07080a",display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid #1e2130",background:"#0f1117",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontFamily:"monospace",fontSize:13,color:"#00c49a",fontWeight:700}}>{dispSym(selected.symbol)}</span>
              <span style={{fontFamily:"monospace",fontSize:11,color:"#c8cfe0"}}>{fmtPrice(selected.price)}</span>
              <span style={{fontFamily:"monospace",fontSize:11,color:selected.change_pct>=0?"#00c49a":"#e05060"}}>
                {selected.change_pct>=0?"+":""}{selected.change_pct.toFixed(2)}%
              </span>
              <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>{tvSym(selected.symbol)}</span>
            </div>
            <button onClick={()=>setTvFullscreen(false)} style={{padding:"5px 12px",fontFamily:"monospace",fontSize:10,cursor:"pointer",background:"rgba(224,80,96,.1)",color:"#e05060",border:"1px solid rgba(224,80,96,.3)",borderRadius:4}}>
              ✕ Fermer (Esc)
            </button>
          </div>
          <div style={{flex:1,overflow:"hidden"}}>
            <TradingViewWidget symbol={tvSym(selected.symbol)} height={typeof window!=="undefined"?window.innerHeight-51:800}/>
          </div>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:14}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div>
            <h1 style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:"#00c49a",letterSpacing:".05em"}}>VOLINDEX DASHBOARD</h1>
            <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginTop:2}}>
              {allRows.length} instruments · {lastUpdate&&`Mis à jour ${lastUpdate}`}
              {refreshing&&" · ↻"}
            </p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {alerts.length>0&&(
              <span style={{fontFamily:"monospace",fontSize:10,padding:"3px 8px",borderRadius:4,background:"rgba(240,165,0,.12)",color:"#d49a00",border:"1px solid rgba(240,165,0,.3)"}}>
                ⚡ {alerts.length} alerte{alerts.length>1?"s":""}
              </span>
            )}
            <span style={{fontFamily:"monospace",fontSize:10,color:wsConnected?"#00c49a":"#7a8098"}}>
              {wsConnected?"● LIVE":"○ POLLING"}
            </span>
          </div>
        </div>

        {error&&allRows.length===0&&(
          <div style={{borderRadius:6,border:"1px solid #e05060",background:"rgba(224,80,96,.08)",padding:"10px 14px",fontFamily:"monospace",fontSize:12,color:"#e05060"}}>⚠ {error}</div>
        )}

        {/* Layout 2 colonnes */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 420px",gap:14,alignItems:"start"}}>

          {/* Colonne gauche : tableaux */}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>

            {/* Onglets principaux */}
            <div style={{display:"flex",alignItems:"stretch",borderBottom:"1px solid #1e2130",gap:0}}>
              {(["crypto","etf","actions"] as TabKey[]).map(t=>(
                <button key={t} onClick={()=>setTabAndReset(t)} style={{padding:"9px 16px",fontFamily:"monospace",fontSize:11,letterSpacing:".08em",cursor:"pointer",background:"transparent",border:"none",color:tab===t?"#00c49a":"#7a8098",borderBottom:tab===t?"2px solid #00c49a":"2px solid transparent"}}>
                  {t==="crypto"?"🪙":t==="etf"?"📊":"🏢"} {t==="crypto"?"CRYPTO":t==="etf"?"ETF":"ACTIONS"} ({tabCounts[t]})
                </button>
              ))}
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4,paddingBottom:6}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>VAR% :</span>
                {(["24h","1W","1M","YTD","1Y","5Y"] as Period[]).map(p=>(
                  <Pill key={p} active={period===p} onClick={()=>setPeriod(p)}>{PERIOD_LABELS[p]}</Pill>
                ))}
              </div>
            </div>

            {/* Sous-onglets Actions */}
            {tab==="actions"&&(
              <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>Filtrer :</span>
                {([["all","Tout ("+actionsRows.length+")"],["cac40","🇫🇷 CAC40"],["tech","💻 Tech US"],["open_actions","✅ Ouverts"],["closed_actions","🔴 Fermés"]] as [ActionSub,string][]).map(([k,l])=>(
                  <Pill key={k} active={actionSub===k} onClick={()=>setActionSub(k)}>{l}</Pill>
                ))}
              </div>
            )}

            {tab==="etf"&&(
              <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>Filtrer :</span>
                {([["all_etf","Tous ("+etfRows.length+")"],["open_etf","✅ Ouverts"],["closed_etf","🔴 Fermés"]] as [ActionSub,string][]).map(([k,l])=>(
                  <Pill key={k} active={actionSub===k} onClick={()=>setActionSub(k)}>{l}</Pill>
                ))}
              </div>
            )}

            {period!=="24h"&&(
              <div style={{background:"rgba(240,165,0,.08)",border:"1px solid rgba(240,165,0,.25)",borderRadius:5,padding:"6px 12px",fontFamily:"monospace",fontSize:10,color:"#d49a00"}}>
                ℹ Variations historiques ({PERIOD_LABELS[period]}) nécessitent Finnhub payant. Affichage 24h.
              </div>
            )}

            {/* Spinner uniquement si vraiment vide */}
            {loading&&allRows.length===0?(
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",height:180}}>
                <div style={{width:26,height:26,borderRadius:"50%",border:"2px solid #00c49a",borderTopColor:"transparent",animation:"spin 1s linear infinite"}}/>
              </div>
            ):(
              <Table rows={activeRows} selected={selected?.symbol||""} onSelect={setSelected} period={period} usMarketOpen={usMarketOpen} euMarketOpen={euMarketOpen}/>
            )}
          </div>

          {/* Colonne droite : fiche + TradingView */}
          <div style={{display:"flex",flexDirection:"column",gap:10,position:"sticky",top:60}}>

            {/* Alertes récentes */}
            {alerts.length>0&&(
              <div style={{background:"#0f1117",border:"1px solid rgba(240,165,0,.3)",borderRadius:6,padding:"10px 14px"}}>
                <p style={{fontFamily:"monospace",fontSize:10,color:"#d49a00",marginBottom:6,letterSpacing:".08em"}}>⚡ ALERTES RÉCENTES</p>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {alerts.slice(0,3).map((a,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
                      <span style={{fontFamily:"monospace",color:"#c8cfe0"}}>{a.symbol} · {a.kind==="resistance"?"Résistance":"Support"} {a.level.toFixed(2)}</span>
                      <span style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>{new Date(a.triggered_at).toLocaleTimeString("fr-FR")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fiche instrument sélectionné */}
            {selected&&(
              <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:6,padding:"10px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:6}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:15,fontWeight:700,color:"#00c49a"}}>{dispSym(selected.symbol)}</div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginTop:2}}>{selected.name}</div>
                    <div style={{marginTop:4}}><MarketBadge sym={selected.symbol}/></div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"monospace",fontSize:17,fontWeight:600,color:"#c8cfe0"}}>{fmtPrice(selected.price)}</div>
                    <div style={{fontFamily:"monospace",fontSize:12,color:selected.change_pct>=0?"#00c49a":"#e05060"}}>
                      {selected.change_pct!==0?`${selected.change_pct>=0?"+":""}${selected.change_pct.toFixed(2)}%`:"—"}
                    </div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:1,background:"#1e2130",borderRadius:4,marginTop:10,overflow:"hidden"}}>
                  {[{l:"SCORE",v:selected.vol_volume_score.toFixed(3),c:"#00c49a"},{l:"BIAIS",v:selected.bias.toUpperCase(),c:BIAS_COLOR[selected.bias]},{l:"CONF.",v:selected.confidence+"/100",c:selected.confidence>=70?"#00c49a":"#d49a00"}].map(m=>(
                    <div key={m.l} style={{background:"#0f1117",padding:"7px 8px",textAlign:"center"}}>
                      <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:2}}>{m.l}</div>
                      <div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:m.c}}>{m.v}</div>
                    </div>
                  ))}
                </div>
                <Link href={`/index/${encodeURIComponent(selected.symbol)}`} style={{display:"block",marginTop:8,fontFamily:"monospace",fontSize:10,color:"#00c49a",textDecoration:"none",textAlign:"center",padding:"5px",border:"1px solid #1e2130",borderRadius:4}}>
                  Diagnostic complet + point de vue →
                </Link>
              </div>
            )}

            {/* TradingView */}
            <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:6,overflow:"hidden"}}>
              <div style={{padding:"8px 12px",borderBottom:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>TRADINGVIEW</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:"monospace",fontSize:10,color:"#00c49a"}}>{selected?tvSym(selected.symbol):"—"}</span>
                  {selected&&<button onClick={()=>setTvFullscreen(true)} style={{padding:"3px 8px",fontFamily:"monospace",fontSize:9,cursor:"pointer",background:"rgba(0,196,154,.1)",color:"#00c49a",border:"1px solid rgba(0,196,154,.3)",borderRadius:3}}>⛶ Plein écran</button>}
                </div>
              </div>
              {selected?(
                <TradingViewWidget symbol={tvSym(selected.symbol)} height={460}/>
              ):(
                <div style={{height:460,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Sélectionnez un instrument</div>
              )}
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
