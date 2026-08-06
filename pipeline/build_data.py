#!/usr/bin/env python3
"""Build the static-site data files for the Support Analysis Dashboard.

Downloads the six Google Sheets via the public CSV export, processes them with
exactly the same logic as the old Streamlit app (short-name renames, project
renames, date derivation, ticket status), and writes ready-to-serve JSON files
under web/data/. Runs hourly via GitHub Actions; the website never touches
Google Sheets directly.

Outputs:
  web/data/meta.json      build metadata, filter option lists, quality board parse
  web/data/tickets.json   processed merchant+client ticket rows (columnar)
  web/data/agent.json     agent_perf sheet (cols + rows)
  web/data/sla.json       inbound_sla sheet (cols + rows)
  web/data/redemption.json redemption sheet (cols + rows)
"""

import concurrent.futures
import gzip
import json
import math
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

S_ID = "1f3L3zsB9u_kje2QezsL5qWKeg0vfbVDK8u42Q_gaio8"

SHEET_GIDS = {
    "merchant_support": 471895160,
    "client_support": 1950888044,
    "quality_board": 10002,
    "agent_perf": 1306770575,
    "inbound_sla": 1713632809,
    "redemption": 17439532,
}

BLACK_LIST = ['', 'n/a', 'n.a', 'n', 'dropped call', 'call dropped', 'out of our scope', 'other', '0', 'na', ' ', 'N', 'none', 'nan', 'N/A', '0.0', 'NaN', 'None', 'n/m', 'N/M', "what's app"]

SHORT_NAMES = {
    "Not Done": "Solved",
    "This Number Belongs To An Inactive Wallet": "Inactive Wallet",
    "Escalated- Tech Support": "Esc-Tech",
    "Escalated- Field Team": "Esc-FO",
    "Escalated- Management Team": "Esc-MGT",
    "Escalated- Sys.Set-Up": "Esc-Sys",
    "Escalated- Monitoring Team": "Esc-M&C",
    "Escalated- Product Team": "Esc-PR",
    "Escalated- CCubed Team": "Esc-CCubed",
    "Escalated- Data Team": "Esc-Data",
    "Escalated- Fraud Team": "Esc-Fraud",
    "Escalated- YGG/Like Card": "Esc-YGG",
    "Escalated- PS Team": "Esc-PS",
    "Escalated- PM Team": "Esc-PM",
    "Escalated- AM Team": "Esc-AM",
    "Escalated- Merchant": "Esc - Merchant",
    "Connection Problem or Invalid MMI Code": "Connection Problem",
    "Mismatch (Coupon Number & CST MSISDN)": "Mismatch",
}

PROJECT_RENAME = {"Red Ramadan": "VF Red Ramadan"}

TZ = ZoneInfo("Africa/Cairo")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data")


def csv_url(gid):
    return f"https://docs.google.com/spreadsheets/d/{S_ID}/export?format=csv&gid={gid}"


def load_csv(gid):
    return pd.read_csv(csv_url(gid), dtype=str).dropna(axis=1, how="all").fillna("")


def process_ticket_df(d):
    """Mirror _process_ticket_df from the Streamlit app."""
    if d.empty:
        return d
    d = d[d.iloc[:, 0].astype(str).str.strip() != ""].copy()
    for old, new in SHORT_NAMES.items():
        d = d.replace(old, new)
    d_col = next((c for c in d.columns if any(k in c.lower() for k in ["created", "date"])), d.columns[0])
    dt = pd.to_datetime(d[d_col], errors="coerce")
    d["D_Obj"] = dt.dt.strftime("%Y-%m-%d").fillna("")
    d = d[d["D_Obj"] != ""]
    return d


def to_numeric(series):
    return pd.to_numeric(series.astype(str).str.replace("%", "").str.replace(",", ""), errors="coerce").fillna(0)


def clean_col(df, col):
    if col not in df.columns:
        return df
    t = df.copy()
    t[col] = t[col].astype(str).str.strip()
    mask = (t[col] != "") & (~t[col].str.lower().isin([x.lower() for x in BLACK_LIST]))
    return t[mask]


def rows_to_columnar(df, drop=()):
    cols = [c for c in df.columns if c not in drop]
    rows = [list(r) for r in df[cols].itertuples(index=False)]
    return {"cols": cols, "rows": rows}


def clean_json(obj):
    """Recursively convert non-finite floats (NaN/Inf) to null so the output is
    always valid JSON (pandas leaves NaN after concat of different-width sheets)."""
    if isinstance(obj, float):
        return None if not math.isfinite(obj) else obj
    if isinstance(obj, dict):
        return {k: clean_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean_json(v) for v in obj]
    return obj


def parse_quality_board(raw):
    """Mirror the inline parsing from the Streamlit app (agent summary, top errors,
    per-agent errors). raw has no header row (header=None)."""
    summary = []
    top_errors = {"EC": [], "BC": [], "NC": []}
    per_agent = []
    for i in range(len(raw)):
        r = raw.iloc[i].tolist()
        if r[1] == "Agent Name" and r[2] == "Total Volume":
            for j in range(i + 1, len(raw)):
                nr = raw.iloc[j].tolist()
                if nr[1] and nr[2] and str(nr[2]).replace(".", "").isdigit():
                    summary.append({"Agent": nr[1], "Volume": nr[2], "Avg EC%": nr[3], "Avg BC%": nr[4], "Overall Avg": nr[5]})
                else:
                    break
        if r[1] == "Top EC Errors":
            for j in range(i + 1, len(raw)):
                nr = raw.iloc[j].tolist()
                if nr[1] and str(nr[2]).replace(".", "").isdigit():
                    top_errors["EC"].append({"Error": nr[1], "Count": nr[2]})
                    if nr[5] and str(nr[6]).replace(".", "").isdigit():
                        top_errors["BC"].append({"Error": nr[5], "Count": nr[6]})
                    if nr[9] and len(nr) > 10 and str(nr[10]).replace(".", "").isdigit():
                        top_errors["NC"].append({"Error": nr[9], "Count": nr[10]})
                else:
                    break
        if r[1] == "Agent" and r[2] == "EC Error":
            for j in range(i + 1, len(raw)):
                nr = raw.iloc[j].tolist()
                if nr[1] and nr[2] and str(nr[3]).replace(".", "").isdigit():
                    per_agent.append({"Agent": nr[1], "Type": "EC", "Error": nr[2], "Count": nr[3]})
                    if nr[5] and nr[6] and len(nr) > 7 and str(nr[7]).replace(".", "").isdigit():
                        per_agent.append({"Agent": nr[5], "Type": "BC", "Error": nr[6], "Count": nr[7]})
                    if nr[9] and nr[10] and len(nr) > 11 and str(nr[11]).replace(".", "").isdigit():
                        per_agent.append({"Agent": nr[9], "Type": "NC", "Error": nr[10], "Count": nr[11]})
                else:
                    break
    return {"agent_summary": summary, "top_errors": top_errors, "per_agent_errors": per_agent}


def build_agent(raw):
    """Pre-aggregate agent_perf the same way the app does (avg EC%/BC% per agent,
    WA/Call volumes) and also keep the raw rows for future tabs."""
    if raw.empty:
        return {"summary": {}, "per_agent": [], "raw": {"cols": [], "rows": []}}
    cols = list(raw.columns)
    name_col = cols[0]
    ec_col = "EC%" if "EC%" in cols else next((c for c in cols if c.upper() == "EC"), None)
    bc_col = "BC%" if "BC%" in cols else next((c for c in cols if c.upper() == "BC"), None)
    summary = {}
    if ec_col is not None:
        ec_vals = to_numeric(raw[ec_col])
        summary["avg_ec"] = round(float(ec_vals.mean()), 1)
    if bc_col is not None:
        bc_vals = to_numeric(raw[bc_col])
        summary["avg_bc"] = round(float(bc_vals.mean()), 1)
    summary["total_volume"] = int(len(raw))
    if "Queue" in cols:
        summary["wa_volume"] = int(len(raw[raw["Queue"].str.contains("WhatsApp", case=False, na=False)]))
        summary["call_volume"] = int(len(raw[raw["Queue"].str.contains("Call", case=False, na=False)]))
    else:
        summary["wa_volume"] = 0
        summary["call_volume"] = 0
    per_agent = []
    if ec_col is not None and bc_col is not None:
        q = raw.copy()
        q["EC_num"] = to_numeric(q[ec_col])
        q["BC_num"] = to_numeric(q[bc_col])
        agg = q.groupby(name_col, as_index=False)[["EC_num", "BC_num"]].mean()
        for r in agg.itertuples(index=False):
            per_agent.append({"agent": r[0], "ec": round(float(r[1]), 1), "bc": round(float(r[2]), 1)})
    return {"summary": summary, "per_agent": per_agent, "raw": rows_to_columnar(raw)}


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f"Output dir: {OUT}")

    keys = list(SHEET_GIDS.keys())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(load_csv, SHEET_GIDS[k]): k for k in keys}
        raw = {}
        for f in concurrent.futures.as_completed(futs):
            k = futs[f]
            try:
                raw[k] = f.result()
                print(f"  fetched {k}: {len(raw[k])} rows")
            except Exception as e:
                print(f"  FAILED {k}: {e}")
                sys.exit(1)

    df_merchant = process_ticket_df(raw["merchant_support"])
    df_client = process_ticket_df(raw["client_support"])
    for d in (df_merchant, df_client):
        if not d.empty and "Closed time" in d.columns:
            d["Ticket_Status"] = pd.to_datetime(d["Closed time"], errors="coerce").notna().map({True: "Closed", False: "Open"})
        if not d.empty and "Project" in d.columns:
            d["Project"] = d["Project"].replace(PROJECT_RENAME)

    df_merchant["_team"] = "merchant"
    df_client["_team"] = "client"
    df_all = pd.concat([df_merchant, df_client], ignore_index=True)

    date_col = next((c for c in df_all.columns if any(k in c.lower() for k in ["created", "date"])), None)
    tickets = rows_to_columnar(df_all, drop=("Month_Name", "Month_Num"))

    def opt_list(col):
        if col not in df_all.columns:
            return []
        return sorted(df_all[col].dropna().astype(str).str.strip().unique().tolist())

    meta = {
        "updated": datetime.now(TZ).strftime("%d %b %Y %H:%M"),
        "updated_iso": datetime.now(TZ).isoformat(),
        "counts": {
            "merchant": int(len(df_merchant)),
            "client": int(len(df_client)),
            "all": int(len(df_all)),
        },
        "date_min": str(df_all["D_Obj"].min()) if not df_all.empty else "",
        "date_max": str(df_all["D_Obj"].max()) if not df_all.empty else "",
        "date_col": date_col,
        "filters": {
            "Merchant": opt_list("Merchant"),
            "Project": opt_list("Project"),
            "Branch User Name": opt_list("Branch User Name"),
            "District": opt_list("District"),
            "Ticket type": opt_list("Ticket type"),
            "Ticket subtype": opt_list("Ticket subtype"),
            "Call Microtype": opt_list("Call Microtype"),
            "Action taken": opt_list("Action taken"),
        },
        "quality": parse_quality_board(raw["quality_board"]),
        "sheet_cols": {k: list(v.columns) for k, v in raw.items()},
    }

    agent = build_agent(raw["agent_perf"])
    sla = rows_to_columnar(raw["inbound_sla"])
    redemption = rows_to_columnar(raw["redemption"])

    def write_json(name, obj, gzip_level=9):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(clean_json(obj), f, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        size = os.path.getsize(path)
        gz_path = path + ".gz"
        with open(path, "rb") as f:
            gz = gzip.compress(f.read(), gzip_level)
        with open(gz_path, "wb") as f:
            f.write(gz)
        gz_size = len(gz)
        print(f"  {name}: {size/1024:.0f} KB (gz {gz_size/1024:.0f} KB)")
        return size, gz_size

    sizes = {}
    sizes["meta.json"] = write_json("meta.json", meta)
    sizes["tickets.json"] = write_json("tickets.json", tickets)
    sizes["agent.json"] = write_json("agent.json", agent)
    sizes["sla.json"] = write_json("sla.json", sla)
    sizes["redemption.json"] = write_json("redemption.json", redemption)

    total = sum(s[0] for s in sizes.values())
    total_gz = sum(s[1] for s in sizes.values())
    print(f"TOTAL: {total/1024:.0f} KB  (gz {total_gz/1024:.0f} KB)")
    print("Done.")


if __name__ == "__main__":
    main()
