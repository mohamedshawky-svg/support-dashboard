import streamlit as st
import pandas as pd
import plotly.express as px
import base64
import os
import hmac
import time
from datetime import datetime
from zoneinfo import ZoneInfo
import streamlit.components.v1 as components

# ==========================================
# 1. Page config
# ==========================================
st.set_page_config(page_title="Support Analysis Dashboard", layout="wide", initial_sidebar_state="expanded")

DS_BLUE, DS_NAVY, DS_LIGHT = "#0055A4", "#002147", "#00AEEF"

BLACK_LIST = [
    '', 'n/a', 'n.a', 'n', 'dropped call', 'call dropped',
    'out of our scope', 'other', '0', 'na', ' ', 'N',
    'none', 'nan', 'N/A', '0.0', 'NaN', 'None'
]

SHORT_NAMES = {
    "Not Done": "Solved",
    "This Number Belongs To An Inactive Wallet": "Inactive Wallet",
    "Escalated- Tech Support": "Esc-Tech",
    "Escalated- Field Team": "Esc-FO",
    "Escalated- Management Team": "Esc-MGT",
    "Escalated- Sys.Set-Up": "Esc-Sys",
    "Escalated- Monitoring Team": "Esc-M&C"
}

PROJECT_RENAME = {
    "Red Ramadan": "VF Red Ramadan",
}

PASSWORD_PROJECTS = {
    "vodafone123": ["Red", "Red DOM", "Redrebalance (HHT)", "VF Enterprise Packs", "Sherkety", "VF Red Ramadan", "VF Mass Retail", "VF Marketplace", "VF Cash Deals"],
    "nbe123": ["Alahly Points"],
    "Alex123": ["Alex Bank"],
    "cib123": ["CIB Bonus"],
    "wdc123": ["Wadi Degla"],
    "bm123": ["Bank Misr"],
    "Exxon123": ["Exxon Mobil"],
    "Mashreq123": ["El Mashreq Bank"],
    "Agricole123": ["Credit Agricole"],
    "FAB123": ["FAB"],
    "NBK123": ["NBK"],
    "WE123": ["WE"],
    "QNB123": ["QNB"],
    "Jotun123": ["Jotun"],
    "Mazaya123": ["Mazaya"],
    "Sky Logistics123": ["Sky Logistics"],
}

CACHE_TTL_SECONDS = 60
APP_TIMEZONE = ZoneInfo("Africa/Cairo")
DEFAULT_ADMIN_KEY = "admin123"
DEFAULT_USER_KEY  = "dsq123"

def get_setting(name, default=None):
    if name in os.environ:
        return os.environ[name]
    try:
        return st.secrets.get(name, default)
    except Exception:
        return default

ADMIN_ACCESS_KEY = get_setting("ADMIN_ACCESS_KEY", DEFAULT_ADMIN_KEY)
USER_ACCESS_KEY  = get_setting("USER_ACCESS_KEY",  DEFAULT_USER_KEY)
SPREADSHEET_ID   = get_setting("GOOGLE_SHEET_ID",  "18ujwRjkA8L3BIJzevw1QCxjtjIRXdgQ8Du6P2m9LYRc")

def is_valid_key(inp, exp):
    if not inp or not exp: return False
    return hmac.compare_digest(str(inp), str(exp))

# ==========================================
# 2. Helpers
# ==========================================
def get_img_64(path):
    try:
        if os.path.exists(path):
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode()
    except: return None
    return None

logo_big = get_img_64("logo_big.png")
logo_sm  = get_img_64("logo_small.png")

def to_n(s):
    return pd.to_numeric(s.astype(str).str.replace('%','').str.replace(',',''), errors='coerce').fillna(0)

def clean_st(df, col):
    if col not in df.columns: return df
    t = df.copy()
    t[col] = t[col].astype(str).str.strip()
    mask = (
        (t[col] != "") & (t[col].str.lower() != "nan") & (t[col].str.lower() != "none") &
        (~t[col].str.lower().isin([x.lower() for x in BLACK_LIST]))
    )
    return t[mask]

def get_top_safe(df, col):
    t = clean_st(df, col)
    return t[col].mode()[0] if not t.empty else "N/A"

def smart_analysis(df_filtered, df_base, filter_context):
    if df_filtered.empty:
        return [("⚠️ No data for this filter", "gray")]
    lines = []
    total_filtered = len(df_filtered)
    total_base     = len(df_base)
    share = (total_filtered / total_base * 100) if total_base > 0 else 0
    lines.append((f"📊 {share:.1f}% of all tickets", DS_NAVY))

    if 'Month_Num' in df_filtered.columns:
        monthly_num = (df_filtered.groupby('Month_Num').size()
                       .reset_index(name='count').sort_values('count', ascending=False))
        if not monthly_num.empty:
            peak_label = str(monthly_num.iloc[0]['Month_Num'])
            peak_val   = int(monthly_num.iloc[0]['count'])
            if len(monthly_num) >= 2:
                second_val = int(monthly_num.iloc[1]['count'])
                diff_pct   = ((peak_val - second_val) / second_val * 100) if second_val > 0 else 0
                lines.append((f"⭐ Peak: {peak_label} ({peak_val:,} tickets)", "#00873d"))
                lines.append((f"   ▲ {diff_pct:.0f}% above 2nd month", DS_BLUE))
            else:
                lines.append((f"⭐ Peak: {peak_label} ({peak_val:,} tickets)", "#00873d"))
    return lines


# ==========================================
# Scorecard HTML — بدون tooltip
# ==========================================
def build_card_html(card_id, title, value_str, analysis_lines, tooltip_lines, delay, border_color):
    # tooltip_html = ""  # تم إزالة الـ tooltip بالكامل

    analysis_html  = ""
    divider_html   = ""
    if analysis_lines:
        divider_html = '<div class="sc-divider"></div>'
        for i, (text, color) in enumerate(analysis_lines):
            anim_delay = i * 0.06
            analysis_html += (
                f'<div class="sc-insight" '
                f'style="color:{color};animation-delay:{anim_delay:.2f}s;">'
                f'{text}</div>'
            )

    raw_num = value_str.replace(',','').replace('%','').strip()
    has_pct = '%' in value_str
    try:
        float(raw_num)
        data_attrs = f'data-target="{raw_num}" data-suffix="{"%" if has_pct else ""}"'
    except:
        data_attrs = ''

    return f"""
    <div class="sc-card" id="{card_id}"
         style="animation-delay:{delay:.2f}s; --top-color:{border_color};">
        <div class="sc-header">
            <span class="sc-label-txt">{title}</span>
        </div>
        <div class="sc-value-txt" {data_attrs}>{value_str}</div>
        {divider_html}
        <div class="sc-analysis-wrap">{analysis_html}</div>
    </div>"""


def render_scorecards_row(cards):
    cards_html = "".join(
        build_card_html(
            card_id        = c.get("id", f"sc_{i}"),
            title          = c["title"],
            value_str      = c["value_str"],
            analysis_lines = c.get("analysis_lines") or [],
            tooltip_lines  = c.get("tooltip_lines")  or [],
            delay          = i * 0.09,
            border_color   = c.get("border_color", DS_NAVY),
        )
        for i, c in enumerate(cards)
    )

    has_analysis = any(c.get("analysis_lines") for c in cards)
    card_height  = 200 if has_analysis else 165

    iframe_height = card_height + 20

    full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@700;900&family=DM+Sans:wght@500;700&display=swap" rel="stylesheet">
<style>
*{{box-sizing:border-box;margin:0;padding:0;}}
html, body{{
    background:transparent;
    font-family:'DM Sans',sans-serif;
    overflow:visible !important;
    height:auto !important;
}}

.sc-row{{
    display:grid;
    grid-template-columns:repeat(4,1fr);
    gap:16px;
    padding:4px 2px 8px;
    overflow:visible;
    position:relative;
}}

.sc-card{{
    background:#f7faff;
    border:1px solid rgba(0,33,71,.09);
    border-top:4px solid var(--top-color,{DS_NAVY});
    border-radius:16px;
    box-shadow:0 4px 10px rgba(0,33,71,.06),0 10px 28px rgba(0,33,71,.10);
    padding:16px 18px;
    position:relative;
    overflow:visible;
    cursor:default;
    animation:slideUp .5s cubic-bezier(.18,.89,.32,1.28) both;
    transition:transform .25s ease,box-shadow .25s ease,border-top-color .25s ease,background .2s ease;
}}
.sc-card:hover{{
    transform:translateY(-6px);
    box-shadow:0 10px 18px rgba(0,33,71,.10),0 20px 45px rgba(0,33,71,.16),0 0 0 1px rgba(0,174,239,.20);
    border-top-color:{DS_LIGHT} !important;
    background:#fff;
}}
@keyframes slideUp{{
    0%  {{opacity:0;transform:translateY(16px) scale(.95);}}
    65% {{opacity:1;transform:translateY(-4px) scale(1.01);}}
    100%{{opacity:1;transform:translateY(0)   scale(1);}}
}}

.sc-header{{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}}
.sc-label-txt{{font-size:9px;font-weight:800;color:#999;text-transform:uppercase;letter-spacing:.9px;}}

.sc-value-txt{{
    font-family:'Sora',sans-serif;
    font-size:34px;
    font-weight:900;
    color:{DS_NAVY};
    line-height:1.1;
    margin-bottom:4px;
    animation:popIn .5s cubic-bezier(.18,.89,.32,1.28) both;
}}
@keyframes popIn{{
    0%  {{opacity:0;transform:scale(.8);}}
    70% {{opacity:1;transform:scale(1.04);}}
    100%{{opacity:1;transform:scale(1);}}
}}

.sc-divider{{height:1px;background:linear-gradient(90deg,{DS_LIGHT}55,transparent);margin:8px 0 6px;}}

.sc-insight{{
    font-size:10px;
    font-weight:700;
    margin:3px 0;
    line-height:1.35;
    animation:fadeSlide .4s ease both;
}}
@keyframes fadeSlide{{
    from{{opacity:0;transform:translateX(-5px);}}
    to  {{opacity:1;transform:translateX(0);}}
}}
</style>
</head>
<body>
<div class="sc-row">{cards_html}</div>

<script>
function runCountUp(){{
    document.querySelectorAll('.sc-value-txt[data-target]').forEach(function(el){{
        if(el.dataset.animated) return;
        el.dataset.animated='1';
        var target  = parseFloat(el.dataset.target);
        var suffix  = el.dataset.suffix||'';
        var isFloat = el.dataset.target.indexOf('.')>-1;
        var steps=50, dur=800, step=target/steps, cur=0;
        var iv=setInterval(function(){{
            cur=Math.min(cur+step,target);
            el.textContent = isFloat
                ? cur.toFixed(1)+suffix
                : Math.round(cur).toLocaleString()+suffix;
            if(cur>=target) clearInterval(iv);
        }}, dur/steps);
    }});
}}
setTimeout(runCountUp,400);
new MutationObserver(function(){{setTimeout(runCountUp,300);}})
    .observe(document.body,{{childList:true,subtree:true}});
</script>
</body>
</html>"""

    components.html(full_html, height=iframe_height, scrolling=False)


# ==========================================
# 3. CSS — sidebar arrow + global styles
# ==========================================
st.markdown(f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;900&family=DM+Sans:wght@500;700&display=swap');

*{{box-sizing:border-box;}}
.main .block-container{{padding-top:.4rem;}}
[data-testid="stHeader"]{{background:rgba(0,0,0,0)!important;visibility:visible!important;}}

[data-testid="stSidebarHeader"],
[data-testid="stSidebarCollapsedControl"] {{
    overflow: hidden !important;
}}
[data-testid="stSidebarHeader"] *:not(button),
[data-testid="stSidebarCollapsedControl"] *:not(button) {{
    font-size: 0 !important;
    color: transparent !important;
    visibility: hidden !important;
    line-height: 0 !important;
}}

[data-testid="stSidebarHeader"] button,
[data-testid="stSidebarCollapsedControl"] button,
button[title*="sidebar" i],
button[aria-label*="sidebar" i],
button[aria-expanded] {{
    width: 36px !important;
    height: 36px !important;
    border-radius: 50% !important;
    background: rgba(255,255,255,0.13) !important;
    border: 1.5px solid rgba(255,255,255,0.30) !important;
    box-shadow: 0 4px 16px rgba(0,33,71,.22) !important;
    color: transparent !important;
    font-size: 0 !important;
    transition: background .2s ease,transform .2s ease,box-shadow .2s ease !important;
    position: relative !important;
    overflow: hidden !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
    padding: 0 !important;
}}
[data-testid="stSidebarHeader"] button:hover,
[data-testid="stSidebarCollapsedControl"] button:hover,
button[title*="sidebar" i]:hover,
button[aria-label*="sidebar" i]:hover,
button[aria-expanded]:hover {{
    background: rgba(0,174,239,0.28) !important;
    transform: translateY(-1px) scale(1.06) !important;
    box-shadow: 0 8px 22px rgba(0,33,71,.30) !important;
}}

[data-testid="stSidebarHeader"] button svg,
[data-testid="stSidebarCollapsedControl"] button svg,
button[title*="sidebar" i] svg,
button[aria-label*="sidebar" i] svg,
button[aria-expanded] svg {{
    display: none !important;
    visibility: hidden !important;
}}

[data-testid="stSidebarHeader"] button::after,
[data-testid="stSidebarCollapsedControl"] button::after,
button[title*="sidebar" i]::after,
button[aria-label*="sidebar" i]::after,
button[aria-expanded]::after {{
    content: "" !important;
    display: block !important;
    width: 8px !important;
    height: 8px !important;
    border-left: 2.5px solid #ffffff !important;
    border-bottom: 2.5px solid #ffffff !important;
    transform: rotate(45deg) translate(2px,-1px) !important;
    border-radius: 1px !important;
    transition: transform .25s ease !important;
    visibility: visible !important;
    opacity: 1 !important;
}}
[data-testid="stSidebarCollapsedControl"] button::after,
button[aria-expanded="false"]::after {{
    transform: rotate(225deg) translate(-1px,2px) !important;
}}

[data-testid="stSidebar"] > div:first-child {{
    background: linear-gradient(175deg, #001225 0%, #001e42 40%, #00307a 100%) !important;
    padding: 0 !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
}}
[data-testid="stSidebar"] label,
[data-testid="stSidebar"] .stMarkdown p,
[data-testid="stSidebar"] span {{
    color: rgba(255,255,255,.88) !important;
    font-family: 'DM Sans',sans-serif !important;
    font-weight: 600 !important;
    font-size: 12px !important;
}}
[data-testid="stSidebar"] .stMarkdown p {{
    font-size: 9px !important;
    font-weight: 700 !important;
    color: rgba(255,255,255,.35) !important;
    text-transform: uppercase;
    letter-spacing: 1.6px !important;
    padding-left: 2px !important;
}}
[data-testid="stSidebar"] div[data-baseweb="select"] > div {{
    background: rgba(255,255,255,.07) !important;
    border: 1px solid rgba(255,255,255,.10) !important;
    border-radius: 10px !important;
    color: white !important;
    transition: all .25s ease !important;
    min-height: 36px !important;
}}
[data-testid="stSidebar"] div[data-baseweb="select"] > div:hover {{
    background: rgba(255,255,255,.12) !important;
    border-color: rgba(255,255,255,.22) !important;
}}
[data-testid="stSidebar"] div[data-baseweb="select"] > div > div,
[data-testid="stSidebar"] div[data-baseweb="select"] > div > div > div,
[data-testid="stSidebar"] div[data-baseweb="select"] > div > div > div > div {{
    color: white !important;
}}
[data-testid="stSidebar"] span[data-baseweb="tag"] {{
    background: rgba(0,174,239,.25) !important;
    border-radius: 6px !important;
    font-size: 11px !important;
    padding: 2px 6px !important;
}}
[data-testid="stSidebar"] div[data-testid="stDateInput"] > div,
[data-testid="stSidebar"] [data-testid="stDateInput"] div[data-baseweb="input"],
[data-testid="stSidebar"] [data-testid="stDateInput"] input {{
    background: rgba(255,255,255,.07) !important;
    border: 1px solid rgba(255,255,255,.10) !important;
    border-radius: 10px !important;
    color: white !important;
    min-height: 36px !important;
    transition: all .25s ease !important;
}}
[data-testid="stSidebar"] [data-testid="stDateInput"] input::placeholder {{
    color: rgba(255,255,255,.45) !important;
}}
[data-testid="stSidebar"] [data-testid="stDateInput"] svg {{
    color: rgba(255,255,255,.60) !important;
    fill: rgba(255,255,255,.60) !important;
}}
[data-testid="stSidebar"] hr {{
    border-color: rgba(255,255,255,.06) !important;
    margin: 8px 14px !important;
}}
[data-testid="stSidebar"] .stButton > button {{
    background: rgba(255,255,255,.08) !important;
    color: rgba(255,255,255,.85) !important;
    border: 1px solid rgba(255,255,255,.12) !important;
    border-radius: 10px !important;
    font-family: 'DM Sans',sans-serif !important;
    font-weight: 700 !important;
    font-size: 12px !important;
    transition: all .25s ease !important;
    width: 100% !important;
    padding: 7px 10px !important;
    letter-spacing: .3px !important;
}}
[data-testid="stSidebar"] .stButton > button:hover {{
    background: rgba(255,255,255,.15) !important;
    border-color: rgba(255,255,255,.30) !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 14px rgba(0,0,0,.25) !important;
}}
[data-testid="stSidebar"] .stButton:last-of-type > button {{
    background: rgba(200,50,50,.20) !important;
    border-color: rgba(255,100,100,.25) !important;
    color: rgba(255,180,180,.9) !important;
}}
[data-testid="stSidebar"] .stButton:last-of-type > button:hover {{
    background: rgba(200,50,50,.35) !important;
    border-color: rgba(255,100,100,.45) !important;
}}
[data-testid="stSidebar"] [data-testid="stAlert"] {{
    background: rgba(255,255,255,.09) !important;
    border: 1px solid rgba(255,255,255,.20) !important;
    border-radius: 8px !important;
    color: white !important;
}}
[data-testid="stSidebar"] [data-testid="stAlert"] {{
    background: rgba(255,255,255,.09) !important;
    border: 1px solid rgba(255,255,255,.20) !important;
    border-radius: 8px !important;
    color: white !important;
}}

.live-badge{{
    display:inline-flex;align-items:center;gap:6px;
    background:rgba(0,200,80,.10);
    border:1px solid rgba(0,200,80,.35);
    border-radius:20px;padding:3px 10px;
    font-size:11px;font-weight:700;color:#007a3a;
    font-family:'DM Sans',sans-serif;
}}
.live-dot{{
    width:8px;height:8px;background:#00cc55;
    border-radius:50%;animation:pulse 1.5s infinite;flex-shrink:0;
}}
@keyframes pulse{{
    0%,100%{{box-shadow:0 0 0 0 rgba(0,204,85,.5);}}
    50%{{box-shadow:0 0 0 5px rgba(0,204,85,0);}}
}}

.filter-badge{{
    background:{DS_NAVY};color:white;border-radius:6px;
    padding:3px 10px;font-size:11px;font-weight:700;
    display:inline-block;margin:2px 3px;
    font-family:'DM Sans',sans-serif;
}}

.dashboard-header{{text-align:center;margin-bottom:8px;}}
.dashboard-header h2{{
    color:{DS_NAVY};font-weight:900;font-size:22px;margin-top:4px;
    font-family:'Sora',sans-serif;
}}

[data-testid="stTable"] td,[data-testid="stDataFrame"] td,
[data-testid="stDataFrame"] div,[data-testid="stTable"] th{{
    color:{DS_NAVY}!important;font-weight:800!important;font-size:13px!important;
}}

.wa-card,.overall-card{{
    background-color:white!important;border-top:6px solid {DS_NAVY}!important;
    border-radius:12px!important;box-shadow:0 6px 18px rgba(0,0,0,.09)!important;
    padding:18px!important;transition:all .3s ease!important;
}}
.wa-card:hover,.overall-card:hover{{
    transform:translateY(-6px);
    box-shadow:0 16px 32px rgba(0,0,0,.16)!important;
    border-top:6px solid {DS_LIGHT}!important;
}}
.wa-card h5{{color:{DS_NAVY}!important;font-weight:900;font-size:16px;margin-bottom:4px;font-family:'Sora',sans-serif;}}
.wa-card .perc{{color:{DS_BLUE}!important;font-weight:900;font-size:26px;font-family:'Sora',sans-serif;}}
.page-title-header{{
    color:{DS_NAVY};font-weight:900;font-size:22px;
    text-align:center;margin-bottom:14px;
    border-bottom:2px solid #eee;padding-bottom:8px;
    font-family:'Sora',sans-serif;
}}

.slideshow-banner{{
    background:linear-gradient(135deg,{DS_NAVY},{DS_BLUE});
    color:white;text-align:center;padding:7px 14px;
    border-radius:7px;font-size:12px;font-weight:700;margin-bottom:8px;
    font-family:'DM Sans',sans-serif;
}}
.slideshow-chart-title{{
    color:{DS_NAVY};font-size:18px;font-weight:900;
    text-align:center;padding:5px;margin-bottom:5px;
    border-bottom:3px solid {DS_LIGHT};font-family:'Sora',sans-serif;
}}
.slide-scorecard-wrap{{display:flex;justify-content:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;}}
.slide-scorecard{{
    background:white;border-top:3px solid {DS_NAVY};border-radius:7px;
    box-shadow:0 2px 8px rgba(0,0,0,.09);padding:6px 16px;text-align:center;min-width:100px;
}}
.slide-scorecard .sc-label{{color:gray;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:2px;}}
.slide-scorecard .sc-value{{color:{DS_NAVY};font-size:20px;font-weight:900;margin:0;font-family:'Sora',sans-serif;}}
</style>
""", unsafe_allow_html=True)

# ==========================================
# 4. Login
# ==========================================
if 'auth_role' not in st.session_state: st.session_state.auth_role = None

if not st.session_state.auth_role:
    st.markdown(f"""
    <style>
    .main .block-container{{max-width:100%!important;padding:0!important;}}
    [data-testid="stHeader"]{{display:none!important;}}
    [data-testid="stAppViewContainer"]{{
        background:linear-gradient(135deg,#001225 0%,#001e42 30%,#00307a 65%,#001e42 100%)!important;
        position:relative;overflow:hidden !important;
    }}
    [data-testid="stAppViewContainer"]::before{{
        content:'';position:absolute;top:-30%;right:-20%;width:600px;height:600px;
        background:radial-gradient(circle,rgba(0,174,239,.10) 0%,transparent 70%);
        border-radius:50%;pointer-events:none;animation:loginGlow 8s ease-in-out infinite alternate;
    }}
    [data-testid="stAppViewContainer"]::after{{
        content:'';position:absolute;bottom:-20%;left:-10%;width:500px;height:500px;
        background:radial-gradient(circle,rgba(0,85,164,.12) 0%,transparent 70%);
        border-radius:50%;pointer-events:none;animation:loginGlow2 10s ease-in-out infinite alternate;
    }}
    @keyframes loginGlow{{0%{{transform:translate(0,0) scale(1);}} 100%{{transform:translate(40px,-30px) scale(1.2);}}}}
    @keyframes loginGlow2{{0%{{transform:translate(0,0) scale(1);}} 100%{{transform:translate(-30px,40px) scale(1.3);}}}}
    .login-shell{{position:relative;z-index:2;color:white;text-align:center;font-family:'DM Sans',sans-serif;}}
    .login-brand-inner img{{width:360px;margin-bottom:14px;filter:drop-shadow(0 8px 28px rgba(0,0,0,.4));}}
    .login-brand-inner h1{{margin:0 0 22px;color:#fff;font-family:'Sora',sans-serif;font-size:40px;font-weight:900;letter-spacing:-.3px;}}
    .login-card{{width:100%;max-width:240px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-top:2px solid {DS_LIGHT};border-radius:12px;padding:18px 22px 16px;margin:0 auto;backdrop-filter:blur(24px);box-shadow:0 20px 60px rgba(0,0,0,.30);}}
    .login-card .lc-title{{color:rgba(255,255,255,.8);font-family:'Sora',sans-serif;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;text-align:center;margin-bottom:12px;white-space:nowrap;}}
    .login-card [data-testid="stTextInput"]{{min-width:0!important;width:100%!important;}}
    .login-card [data-testid="stTextInput"] > div{{min-width:0!important;width:100%!important;}}
    .login-card [data-baseweb="input"]{{border-radius:8px!important;border:1px solid rgba(255,255,255,.14)!important;background:rgba(255,255,255,.06)!important;height:28px!important;font-size:12px!important;width:100%!important;min-width:0!important;}}
    .login-card [data-baseweb="input"]:hover{{border-color:rgba(255,255,255,.25)!important;background:rgba(255,255,255,.09)!important;}}
    .login-card [data-baseweb="input"] input{{color:#fff!important;font-weight:600!important;font-size:12px!important;}}
    .login-card [data-baseweb="input"] input::placeholder{{color:rgba(255,255,255,.35)!important;font-size:11px!important;}}
    .login-card [data-baseweb="input"]:focus-within{{border-color:{DS_LIGHT}!important;box-shadow:0 0 0 2px rgba(0,174,239,.12)!important;}}
    .login-card [data-testid="stAlert"]{{background:rgba(255,80,80,.12)!important;border:1px solid rgba(255,80,80,.25)!important;border-radius:6px!important;color:rgba(255,180,180,.9)!important;font-size:11px!important;padding:5px 8px!important;margin-top:6px!important;}}
    .login-footer{{text-align:center;margin-top:10px;font-size:9px;color:rgba(255,255,255,.15);letter-spacing:1px;}}
    </style>
    <div class="login-shell">
        <div class="login-brand-inner">
            {f'<img src="data:image/png;base64,{logo_big}" alt="Dsquares"/>' if logo_big else ''}
            <h1>Insights HUB</h1>
        </div>
    </div>
    <div class="login-footer">Dsquares &copy; 2026</div>
    """, unsafe_allow_html=True)
    _, c2, _ = st.columns([1, 1.2, 1])
    with c2:
        st.markdown('<div class="login-card"><div class="lc-title">🔐 Access Control</div>', unsafe_allow_html=True)
        pwd = st.text_input("ACCESS KEY", type="password", placeholder="Enter your access key", label_visibility="collapsed")
        st.markdown('</div>', unsafe_allow_html=True)
        if is_valid_key(pwd, ADMIN_ACCESS_KEY):
            st.session_state.auth_role = "admin"; st.rerun()
        elif is_valid_key(pwd, USER_ACCESS_KEY):
            st.session_state.auth_role = "user";  st.rerun()
        elif pwd in PASSWORD_PROJECTS:
            st.session_state.auth_role = "user"
            st.session_state.client_projects = PASSWORD_PROJECTS[pwd]
            st.rerun()
        elif pwd:
            st.error("Invalid access key")
    st.stop()

# ==========================================
# 5. Data + Auto-Refresh
# ==========================================
S_ID = SPREADSHEET_ID

@st.cache_data(ttl=CACHE_TTL_SECONDS)
def load_data_final():
    try:
        base = f"https://docs.google.com/spreadsheets/d/{S_ID}/export?format=csv"
        m = pd.read_csv(f"{base}&gid=1278191407", dtype=str).dropna(axis=1, how='all').fillna("")
        s = pd.read_csv(f"{base}&gid=0",          dtype=str).dropna(axis=1, how='all').fillna("")
        q = pd.read_csv(f"{base}&gid=468167747",   dtype=str).dropna(axis=1, how='all').fillna("")
        for old, new in SHORT_NAMES.items(): m = m.replace(old, new)
        m = m[m.iloc[:,0].str.strip() != ""].copy()
        d_col = next((c for c in m.columns if any(k in c.lower() for k in ['created','date'])), m.columns[0])
        m['D_Obj']      = pd.to_datetime(m[d_col], errors='coerce').dt.date
        m = m.dropna(subset=['D_Obj'])
        m['Month_Name'] = pd.to_datetime(m[d_col], errors='coerce').dt.strftime('%b')
        m['Month_Num']  = pd.to_datetime(m[d_col], errors='coerce').dt.to_period('M')
        q = q[q['Agent Name'].str.strip() != ""].copy()
        s = s[s['Month'].str.strip() != ""].copy()
        return m, s, q, datetime.now(APP_TIMEZONE)
    except Exception as exc:
        st.session_state.load_error = str(exc)
        return None, None, None, None

df_m, df_s, df_q, last_updated = load_data_final()
if df_m is None or df_m.empty:
    st.error("Data source unavailable.")
    st.stop()
df_m['Ticket_Status'] = pd.to_datetime(df_m['Closed time'], errors='coerce').notna().map({True:'Closed',False:'Open'})
df_m['Project'] = df_m['Project'].replace(PROJECT_RENAME)

if 'last_row_count' not in st.session_state:
    st.session_state.last_row_count = len(df_m)

now_str   = last_updated.strftime("%d %b %Y %H:%M") if last_updated else ""
logo_html = f'<img src="data:image/png;base64,{logo_sm}" width="34">' if logo_sm else ""
cur_count = len(df_m)
new_badge = ""
if cur_count > st.session_state.last_row_count:
    diff = cur_count - st.session_state.last_row_count
    new_badge = (f'<span style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:12px;'
                 f'padding:3px 10px;font-size:11px;font-weight:700;color:#2e7d32;margin-left:8px;">'
                 f'🆕 +{diff:,} new tickets</span>')
st.session_state.last_row_count = cur_count

st.markdown(
    f'<div class="dashboard-header">{logo_html}<h2>Support Analysis Dashboard</h2>'
    f'<div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:5px;flex-wrap:wrap;">'
    f'<span class="live-badge"><span class="live-dot"></span> LIVE</span>'
    f'<span style="font-size:11px;color:gray;font-family:\'DM Sans\',sans-serif;">'
    f'Last updated: {now_str} &nbsp;|&nbsp; Auto</span>'
    f'{new_badge}</div></div>',
    unsafe_allow_html=True
)

# ==========================================
# 6. Session State
# ==========================================
for k, v in [('slideshow_active',False),('slide_index',0),('click_filter_col',None),('click_filter_val',None),('client_projects',None)]:
    if k not in st.session_state: st.session_state[k] = v

# ==========================================
# 7. Sidebar
# ==========================================
with st.sidebar:
    if logo_big:
        st.markdown(
            f'<div style="padding:20px 16px 10px;text-align:center;z-index:1;">'
            f'<img src="data:image/png;base64,{logo_big}" style="width:100%;max-width:170px;"/>'
            f'</div>', unsafe_allow_html=True
        )
    st.markdown(
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;'
        'padding:6px 16px;border-bottom:1px solid rgba(255,255,255,.06);'
        'border-top:1px solid rgba(255,255,255,.06);margin-bottom:2px;'
        'background:rgba(255,255,255,.03);">'
        '<span style="width:6px;height:6px;background:#00e676;border-radius:50%;'
        'box-shadow:0 0 6px rgba(0,230,118,.5);flex-shrink:0;"></span>'
        f'<span style="font-size:9px!important;font-weight:700!important;'
        f'color:rgba(255,255,255,.5)!important;letter-spacing:.8px!important;">'
        f'LIVE &nbsp;·&nbsp; Auto</span></div>',
        unsafe_allow_html=True
    )
    st.markdown('<div style="padding:8px 16px 2px 18px;font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:1.6px;">FILTERS</div>', unsafe_allow_html=True)

    date_mode = st.selectbox("📅 Date filter", ["Custom range", "All time"], index=0, key="date_mode_key")
    show_all = date_mode == "All time"
    dr = st.date_input("🗓 Date Range", [min(df_m['D_Obj']), max(df_m['D_Obj'])], key="dr_key", disabled=show_all)
    ff_base = df_m.copy()
    if not show_all and len(dr) == 2:
        ff_base = ff_base[(ff_base['D_Obj'] >= dr[0]) & (ff_base['D_Obj'] <= dr[1])]
    if st.session_state.get("client_projects"):
        ff_base = ff_base[ff_base['Project'].astype(str).isin(st.session_state.client_projects)]

    f_merch  = st.multiselect("🏪 Merchant",     sorted(ff_base['Merchant'].unique()))
    f_proj   = st.multiselect("🏢 Project",       sorted(ff_base['Project'].unique()))
    f_branch = st.multiselect("📍 Branch",        sorted(ff_base['Branch User Name'].unique()))
    f_type   = st.multiselect("🎫 Ticket type",   sorted(ff_base['Ticket type'].unique()))
    f_act    = st.multiselect("🎬 Action taken",  sorted(ff_base['Action taken'].unique()))
    f_status = st.multiselect("🔴 Ticket Status", options=["Open","Closed"], default=[])

    ff = ff_base.copy()
    if f_merch:  ff = ff[ff['Merchant'].isin(f_merch)]
    if f_proj:   ff = ff[ff['Project'].isin(f_proj)]
    if f_branch: ff = ff[ff['Branch User Name'].isin(f_branch)]
    if f_type:   ff = ff[ff['Ticket type'].isin(f_type)]
    if f_act:    ff = ff[ff['Action taken'].isin(f_act)]
    if f_status: ff = ff[ff['Ticket_Status'].isin(f_status)]

    active_filters = {}
    if f_merch:  active_filters['Merchant']    = ", ".join(f_merch)
    if f_proj:   active_filters['Project']     = ", ".join(f_proj)
    if f_branch: active_filters['Branch']      = ", ".join(f_branch)
    if f_type:   active_filters['Ticket type'] = ", ".join(f_type)
    if f_act:    active_filters['Action']      = ", ".join(f_act)
    if f_status: active_filters['Status']      = ", ".join(f_status)
    if not show_all and len(dr) == 2 and (dr[0] != min(df_m['D_Obj']) or dr[1] != max(df_m['D_Obj'])):
        active_filters['Date Range'] = f"{dr[0]} → {dr[1]}"

    if st.session_state.click_filter_col and st.session_state.click_filter_val:
        col_cf, val_cf = st.session_state.click_filter_col, st.session_state.click_filter_val
        if col_cf in ff.columns:
            ff = ff[ff[col_cf] == val_cf]
            active_filters[col_cf] = val_cf
        elif col_cf == 'D_Obj':
            import datetime as dt
            try:
                ff = ff[ff['D_Obj'] == dt.date.fromisoformat(val_cf)]
                active_filters['Date'] = val_cf
            except: pass
        st.info(f"🔍 **{val_cf}**")
        if st.button("✖ Clear Chart Filter", use_container_width=True):
            st.session_state.click_filter_col = None
            st.session_state.click_filter_val = None
            st.rerun()

    st.divider()
    st.caption("📦 Data cached 10 min from Google Sheets")
    if st.button("🔄 Refresh Data Now", use_container_width=True, type="secondary"):
        st.cache_data.clear()
        st.rerun()
    slide_label = "⏹ Stop Slideshow" if st.session_state.slideshow_active else "▶ Start Slideshow"
    if st.button(slide_label, use_container_width=True):
        st.session_state.slideshow_active = not st.session_state.slideshow_active
        st.session_state.slide_index = 0
        st.rerun()
    st.divider()
    if st.button("🔓 Log Out", use_container_width=True):
        st.session_state.auth_role = None; st.rerun()

ff_drill = ff.copy()

# ==========================================
# clickable_bar helper
# ==========================================
def clickable_bar(df_plot, x_col, y_col, title, color, filter_col, key_name,
                  customdata=None, hovertemplate=None):
    fig = px.bar(df_plot, x=x_col, y=y_col, title=title, text=y_col,
                 color_discrete_sequence=[color], labels={y_col:"Total", x_col:""})
    fig.update_layout(
        xaxis_type='category', yaxis_title="Total",
        title_font_size=13, bargap=0.15,
        margin=dict(t=42,b=10,l=10,r=10)
    )
    fig.update_traces(textposition='outside')
    if customdata is not None and hovertemplate:
        fig.update_traces(customdata=customdata, hovertemplate=hovertemplate)

    ev = st.plotly_chart(fig, use_container_width=True,
                         on_select="rerun", selection_mode="points", key=key_name)
    if ev and ev.selection and ev.selection.get("points"):
        pt = ev.selection["points"][0]
        cv = pt.get("x") or pt.get("label")
        if cv and isinstance(cv, str):
            st.session_state.click_filter_col = filter_col
            st.session_state.click_filter_val = str(cv)
            st.rerun()

# ==========================================
# 8a. Client Project Dashboard (styled, no tabs)
# ==========================================
if st.session_state.get("client_projects"):
    proj_list = st.session_state.client_projects
    proj_data = ff.copy()
    title = " + ".join(proj_list[:2])
    if len(proj_list) > 2:
        title += f" +{len(proj_list)-2}"

    st.markdown(f"""
    <style>
    @keyframes heroShine{{0%,100%{{background-position:0% 50%;}}50%{{background-position:100% 50%;}}}}
    @keyframes heroFloat{{0%{{transform:translate(0,0) scale(1);}}100%{{transform:translate(-20px,20px) scale(1.1);}}}}
    @keyframes heroGlow{{0%{{transform:scale(1) translate(0,0);opacity:.5;}}100%{{transform:scale(1.3) translate(30px,-20px);opacity:1;}}}}
    @keyframes livePulse{{0%,100%{{box-shadow:0 0 0 0 rgba(0,230,118,.6);}}50%{{box-shadow:0 0 0 5px rgba(0,230,118,0);}}}}
    @keyframes cardIn{{0%{{opacity:0;transform:translateY(24px) scale(.95);}}70%{{opacity:1;transform:translateY(-3px) scale(1.01);}}100%{{opacity:1;transform:translateY(0) scale(1);}}}}

    .ds-hero{{
        background:linear-gradient(135deg,{DS_NAVY} 0%,#002d5a 40%,#004a8a 100%);
        border-radius:20px;padding:28px 36px;margin:-8px 0 18px;
        box-shadow:0 12px 40px rgba(0,33,71,.25);
        position:relative;overflow:hidden;isolation:isolate;
    }}
    .ds-hero::before{{
        content:'';position:absolute;inset:0;
        background:linear-gradient(45deg,transparent 30%,rgba(0,174,239,.08) 50%,transparent 70%);
        background-size:200% 200%;
        animation:heroShine 6s ease-in-out infinite;
        pointer-events:none;z-index:0;
    }}
    .ds-hero::after{{
        content:'';position:absolute;top:-40%;right:-5%;width:400px;height:400px;
        background:radial-gradient(circle,rgba(0,174,239,.15) 0%,transparent 70%);
        border-radius:50%;pointer-events:none;z-index:0;
        animation:heroFloat 8s ease-in-out infinite alternate;
    }}
    .ds-hero-glow{{
        position:absolute;bottom:-30%;left:-8%;width:300px;height:300px;
        background:radial-gradient(circle,rgba(0,174,239,.10) 0%,transparent 70%);
        border-radius:50%;pointer-events:none;z-index:0;
        animation:heroGlow 10s ease-in-out infinite alternate;
    }}
    .ds-hero-content{{position:relative;z-index:2;}}
    .ds-hero-content h1{{
        color:#fff;font-family:'Sora',sans-serif;font-size:28px;font-weight:900;
        margin:0;letter-spacing:-.5px;line-height:1.2;
        text-shadow:0 2px 15px rgba(0,0,0,.2);
    }}
    .ds-hero-content p{{
        color:rgba(255,255,255,.5);font-family:'DM Sans',sans-serif;
        font-size:11px;margin:5px 0 0;font-weight:500;
    }}
    .ds-hero .live-tag{{
        position:absolute;top:18px;right:22px;z-index:2;
        font-family:'DM Sans',sans-serif;font-size:8px;font-weight:800;
        color:rgba(255,255,255,.6);letter-spacing:1.2px;
        background:rgba(255,255,255,.08);
        backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
        padding:4px 14px;border-radius:20px;
        border:1px solid rgba(255,255,255,.10);
        display:flex;align-items:center;gap:5px;
    }}
    .ds-hero .live-tag::before{{
        content:'';width:5px;height:5px;background:#00e676;
        border-radius:50%;display:inline-block;flex-shrink:0;
        animation:livePulse 1.5s ease-in-out infinite;
    }}

    .ds-mrow{{
        display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:28px;
    }}
    .ds-mcard{{
        background:#fff;border-radius:16px;padding:20px 18px 18px;
        position:relative;overflow:hidden;
        box-shadow:0 2px 8px rgba(0,33,71,.04),0 8px 24px rgba(0,33,71,.06);
        border:1px solid rgba(0,33,71,.04);
        transition:all .35s cubic-bezier(.18,.89,.32,1.28);
        animation:cardIn .5s cubic-bezier(.18,.89,.32,1.28) both;
        cursor:default;
    }}
    .ds-mcard:nth-child(1){{animation-delay:.05s;}}
    .ds-mcard:nth-child(2){{animation-delay:.12s;}}
    .ds-mcard:nth-child(3){{animation-delay:.19s;}}
    .ds-mcard:hover{{
        transform:translateY(-6px) scale(1.01);
        box-shadow:0 12px 32px rgba(0,33,71,.12),0 0 0 1px rgba(0,174,239,.15);
    }}
    .ds-mcard::before{{
        content:'';position:absolute;top:0;left:0;right:0;height:4px;
        background:var(--accent,{DS_NAVY});
        border-radius:16px 16px 0 0;
        transition:height .3s ease;
    }}
    .ds-mcard:hover::before{{height:6px;}}
    .ds-mcard::after{{
        content:'';position:absolute;bottom:-20px;right:-20px;width:120px;height:120px;
        background:radial-gradient(circle,var(--accent,{DS_NAVY})08 0%,transparent 70%);
        border-radius:50%;pointer-events:none;transition:all .4s ease;
    }}
    .ds-mcard:hover::after{{
        width:160px;height:160px;bottom:-30px;right:-30px;
        background:radial-gradient(circle,var(--accent,{DS_NAVY})12 0%,transparent 70%);
    }}
    .card-icon{{
        font-size:16px;margin-bottom:8px;display:inline-block;
        background:var(--accent,{DS_NAVY})10;padding:8px;border-radius:12px;line-height:1;
    }}
    .card-label{{
        font-size:8px;font-weight:800;color:#999;text-transform:uppercase;
        letter-spacing:1.5px;margin-bottom:6px;font-family:'DM Sans',sans-serif;
    }}
    .card-value{{
        font-size:32px;font-weight:900;color:{DS_NAVY};
        font-family:'Sora',sans-serif;line-height:1.15;margin-bottom:4px;
    }}
    .card-bar{{
        width:36px;height:3px;border-radius:3px;
        background:var(--accent,{DS_NAVY})30;margin-top:6px;
        transition:width .3s ease;
    }}
    .ds-mcard:hover .card-bar{{width:60px;}}

    .ds-sec{{
        font-size:11px;font-weight:800;color:{DS_NAVY};
        text-transform:uppercase;letter-spacing:2px;
        margin:0 0 14px;padding-bottom:10px;
        position:relative;font-family:'Sora',sans-serif;
    }}
    .ds-sec::after{{
        content:'';position:absolute;bottom:0;left:0;width:50px;height:3px;
        border-radius:3px;
        background:linear-gradient(90deg,{DS_LIGHT},{DS_NAVY});
        transition:width .3s ease;
    }}

    .ds-cwrap{{
        background:#fff;border-radius:14px;padding:8px 6px 4px;
        margin-bottom:16px;
        border:1px solid rgba(0,33,71,.04);
        box-shadow:0 2px 8px rgba(0,33,71,.03);
        transition:all .3s ease;
        position:relative;overflow:hidden;
    }}
    .ds-cwrap::before{{
        content:'';position:absolute;top:0;left:0;right:0;height:2px;
        background:linear-gradient(90deg,transparent,{DS_LIGHT}40,transparent);
        opacity:0;transition:opacity .3s ease;
    }}
    .ds-cwrap:hover{{
        box-shadow:0 8px 28px rgba(0,33,71,.08),0 0 0 1px rgba(0,174,239,.06);
        transform:translateY(-2px);
    }}
    .ds-cwrap:hover::before{{opacity:1;}}
    </style>
    """, unsafe_allow_html=True)

    # ── SLIDESHOW ──
    if st.session_state.slideshow_active:
        daily = proj_data.groupby('D_Obj').size().reset_index(name='Total')
        peak  = daily.nlargest(20,'Total').sort_values('D_Obj')
        peak['Date_Str'] = peak['D_Obj'].astype(str)
        hp_peak = []
        for d in peak['D_Obj']:
            rows = proj_data[proj_data['D_Obj']==d].groupby('Call Microtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5)
            lines = [f"• {r['Call Microtype']}: {r['n']}" for _,r in rows.iterrows() if r['Call Microtype'].lower().strip() not in BLACK_LIST]
            hp_peak.append("<br>".join(lines))
        fig_v = px.bar(peak, x='Date_Str', y='Total',
                       title="📊 Volume Trend (Peak Days)",
                       color_discrete_sequence=[DS_NAVY], text='Total')
        fig_v.update_traces(customdata=hp_peak, hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
        fig_v.update_layout(xaxis={'type':'category'}, bargap=0.1, yaxis_title="Total")

        def mksb_p(df, x, y, title, color):
            f = px.bar(df,x=x,y=y,title=title,text=y,color_discrete_sequence=[color],labels={y:'Total',x:''})
            f.update_layout(yaxis_title="Total",xaxis_type='category')
            f.update_traces(textposition='outside')
            return f

        m_a  = clean_st(proj_data,'Merchant').groupby('Merchant').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        br_a = clean_st(proj_data,'Branch User Name').groupby('Branch User Name').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        su_a = clean_st(proj_data,'Ticket subtype').groupby('Ticket subtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        mi_a = clean_st(proj_data,'Call Microtype').groupby('Call Microtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        ac_a = clean_st(proj_data,'Action taken')['Action taken'].value_counts().head(10).reset_index()
        ac_a.columns = ['Action taken','Count']
        tt_a = clean_st(proj_data,'Ticket type')

        fig1 = mksb_p(m_a,  'Merchant',         'c', "1. Top 10 Merchants",  DS_NAVY)
        fig2 = mksb_p(br_a, 'Branch User Name',  'c', "2. Top 10 Branches",   DS_LIGHT)
        fig5 = mksb_p(su_a, 'Ticket subtype',    'c', "3. Top 10 Subtypes",   DS_NAVY)
        fig6 = mksb_p(mi_a, 'Call Microtype',    'c', "4. Top 10 Microtypes", DS_LIGHT)
        fig7 = mksb_p(ac_a, 'Action taken',   'Count', "5. Key Actions Taken", DS_NAVY)
        fig4 = px.pie(tt_a, names='Ticket type', title="6. Ticket Type Share", hole=0.3)
        fig4.update_traces(textinfo='percent+label')

        SLIDE_DUR = 15
        slides = [
            ("📊 Volume Trend (Peak Days)", fig_v),
            ("1. Top 10 Merchants",         fig1),
            ("2. Top 10 Branches",          fig2),
            ("6. Ticket Type Share",        fig4),
            ("3. Top 10 Subtypes",          fig5),
            ("4. Top 10 Microtypes",        fig6),
            ("5. Key Actions Taken",        fig7),
        ]
        ci = st.session_state.slide_index % len(slides)
        st_title, sf = slides[ci]

        st.markdown(f'<div class="slideshow-banner">🎬 {title} &nbsp;|&nbsp; {ci+1}/{len(slides)} &nbsp;|&nbsp; {SLIDE_DUR}s</div>', unsafe_allow_html=True)
        top_merchant = get_top_safe(proj_data, 'Merchant')
        top_ticket_type = get_top_safe(proj_data, 'Ticket type')
        st.markdown(f"""<div class="slide-scorecard-wrap">
            <div class="slide-scorecard"><div class="sc-label">Total Interactions</div><div class="sc-value">{len(proj_data):,}</div></div>
            <div class="slide-scorecard"><div class="sc-label">Top Merchant</div><div class="sc-value">{top_merchant}</div></div>
            <div class="slide-scorecard"><div class="sc-label">Top Ticket Type</div><div class="sc-value">{top_ticket_type}</div></div>
        </div>""", unsafe_allow_html=True)

        st.markdown(f'<div class="slideshow-chart-title">{st_title}</div>', unsafe_allow_html=True)
        _, cc, _ = st.columns([0.5, 9, 0.5])
        with cc:
            st.plotly_chart(sf, use_container_width=True)

        pb = st.progress(0)
        sh = st.empty()
        for i in range(SLIDE_DUR):
            if not st.session_state.slideshow_active:
                break
            pb.progress((i + 1) / SLIDE_DUR)
            sh.markdown(f'<p style="text-align:center;color:gray;font-size:11px;">⏱ {SLIDE_DUR-i-1}s...</p>', unsafe_allow_html=True)
            time.sleep(1)
        if st.session_state.slideshow_active:
            st.session_state.slide_index = (ci + 1) % len(slides)
            st.rerun()

    # ── STATIC VIEW ──
    else:
        top_merchant = get_top_safe(proj_data, 'Merchant')
        top_ticket = get_top_safe(proj_data, 'Ticket type')

        st.markdown(f"""
        <div class="ds-hero">
            <div class="ds-hero-glow"></div>
            <div class="ds-hero-content">
                <h1>{title}</h1>
                <p>Support Analysis Dashboard · Real-time overview of support interactions</p>
            </div>
            <span class="live-tag">LIVE</span>
        </div>
        <div class="ds-mrow">
            <div class="ds-mcard" style="--accent:{DS_NAVY};">
                <div class="card-icon">📊</div>
                <div class="card-label">Total Interactions</div>
                <div class="card-value">{len(proj_data):,}</div>
                <div class="card-bar"></div>
            </div>
            <div class="ds-mcard" style="--accent:{DS_LIGHT};">
                <div class="card-icon">🏪</div>
                <div class="card-label">Top Merchant</div>
                <div class="card-value" style="font-size:24px;word-break:break-word;">{top_merchant}</div>
                <div class="card-bar"></div>
            </div>
            <div class="ds-mcard" style="--accent:#00c06a;">
                <div class="card-icon">🎫</div>
                <div class="card-label">Top Ticket Type</div>
                <div class="card-value" style="font-size:24px;word-break:break-word;">{top_ticket}</div>
                <div class="card-bar"></div>
            </div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown('<div class="ds-sec">📈 Analytics Explorer</div>', unsafe_allow_html=True)

        c1, c2 = st.columns(2)
        with c1:
            st.markdown('<div class="ds-cwrap">', unsafe_allow_html=True)
            m_agg = clean_st(proj_data,'Merchant').groupby('Merchant').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            if not m_agg.empty:
                m_h = ["<br>".join([f"• {r['Call Microtype']}: {r['n']}" for _,r in proj_data[proj_data['Merchant']==m].groupby('Call Microtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows() if r['Call Microtype'].lower().strip() not in BLACK_LIST]) for m in m_agg['Merchant']]
                clickable_bar(m_agg,'Merchant','c',"Top 10 Merchants — click to filter",DS_NAVY,'Merchant','bar_cm',customdata=m_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
            st.markdown('</div>', unsafe_allow_html=True)

            st.markdown('<div class="ds-cwrap">', unsafe_allow_html=True)
            s_agg = clean_st(proj_data,'Ticket subtype').groupby('Ticket subtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            if not s_agg.empty:
                s_h = ["<br>".join([f"• {r['Ticket type']}: {r['n']}" for _,r in proj_data[proj_data['Ticket subtype']==s].groupby('Ticket type').size().reset_index(name='n').sort_values('n',ascending=False).head(3).iterrows()]) for s in s_agg['Ticket subtype']]
                clickable_bar(s_agg,'Ticket subtype','c',"Top 10 Subtypes — click to filter",DS_NAVY,'Ticket subtype','bar_cs',customdata=s_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
            st.markdown('</div>', unsafe_allow_html=True)

            st.markdown('<div class="ds-cwrap">', unsafe_allow_html=True)
            mi_agg = clean_st(proj_data,'Call Microtype').groupby('Call Microtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            if not mi_agg.empty:
                mi_h = ["<br>".join([f"• {r['Ticket subtype']}: {r['n']}" for _,r in proj_data[proj_data['Call Microtype']==m].groupby('Ticket subtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows()]) for m in mi_agg['Call Microtype']]
                clickable_bar(mi_agg,'Call Microtype','c',"Top 10 Microtypes — click to filter",DS_LIGHT,'Call Microtype','bar_cmi',customdata=mi_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
            st.markdown('</div>', unsafe_allow_html=True)

        with c2:
            st.markdown('<div class="ds-cwrap">', unsafe_allow_html=True)
            b_agg = clean_st(proj_data,'Branch User Name').groupby('Branch User Name').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            if not b_agg.empty:
                b_h = ["<br>".join([f"• {r['Merchant']}: {r['n']}" for _,r in proj_data[proj_data['Branch User Name']==b].groupby('Merchant').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows()]) for b in b_agg['Branch User Name']]
                clickable_bar(b_agg,'Branch User Name','c',"Top 10 Branches — click to filter",DS_LIGHT,'Branch User Name','bar_cb',customdata=b_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
            st.markdown('</div>', unsafe_allow_html=True)

            st.markdown('<div class="ds-cwrap">', unsafe_allow_html=True)
            tt_df = clean_st(proj_data,'Ticket type')
            if not tt_df.empty:
                fig4 = px.pie(tt_df, names='Ticket type', title="Ticket Types — click to filter", hole=0.3)
                fig4.update_traces(textinfo='percent+label')
                ev4 = st.plotly_chart(fig4, use_container_width=True, on_select="rerun", selection_mode="points", key="pie_ctt")
                if ev4 and ev4.selection and ev4.selection.get("points"):
                    ctt = ev4.selection["points"][0].get("label")
                    if ctt:
                        st.session_state.click_filter_col = "Ticket type"
                        st.session_state.click_filter_val = str(ctt); st.rerun()
            st.markdown('</div>', unsafe_allow_html=True)

            st.markdown('<div class="ds-cwrap">', unsafe_allow_html=True)
            a_data = clean_st(proj_data,'Action taken')['Action taken'].value_counts().head(10).reset_index()
            a_data.columns = ['Action taken', 'Count']
            if not a_data.empty:
                clickable_bar(a_data,'Action taken','Count',"Action Taken — click to filter",DS_NAVY,'Action taken','bar_ca')
            st.markdown('</div>', unsafe_allow_html=True)

    st.stop()

# ==========================================
# 8. Tabs
# ==========================================
if st.session_state.auth_role == "admin":
    tabs_list = ["🏠 Overview","💬 WhatsApp MOM","📈 Inbound SLA","🏆 Quality Board","🎫 Ticket Explorer"]
else:
    tabs_list = ["🏠 Overview","🎫 Ticket Explorer"]

tabs = st.tabs(tabs_list)

# ==========================================
# Overview Tab
# ==========================================
with tabs[tabs_list.index("🏠 Overview")]:

    # ── SLIDESHOW ──
    if st.session_state.slideshow_active:
        inbound_s = ff[ff['Type'].str.contains('Inbound|Call', case=False, na=False)]
        wa_s      = ff[ff['Type'].str.contains('WhatsApp|App',  case=False, na=False)]
        ff_drill  = ff.copy()
        daily = ff.groupby('D_Obj').size().reset_index(name='Total')
        peak  = daily.nlargest(20,'Total').sort_values('D_Obj')
        peak['Date_Str'] = peak['D_Obj'].astype(str)
        hp = []
        for d in peak['D_Obj']:
            rows  = ff[ff['D_Obj']==d].groupby('Call Microtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5)
            lines = [f"• {r['Call Microtype']}: {r['n']}" for _,r in rows.iterrows() if r['Call Microtype'].lower().strip() not in BLACK_LIST]
            hp.append("<br>".join(lines))
        fig_v = px.bar(peak, x='Date_Str', y='Total',
                       title="📊 Volume Trend (Peak Days)",
                       color_discrete_sequence=[DS_NAVY], text='Total')
        fig_v.update_traces(customdata=hp, hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
        fig_v.update_layout(xaxis={'type':'category'}, bargap=0.1, yaxis_title="Total")

        def mksb(df, x, y, title, color):
            f = px.bar(df,x=x,y=y,title=title,text=y,color_discrete_sequence=[color],labels={y:'Total',x:''})
            f.update_layout(yaxis_title="Total",xaxis_type='category')
            f.update_traces(textposition='outside')
            return f

        m_a  = clean_st(ff_drill,'Merchant').groupby('Merchant').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        br_a = clean_st(ff_drill,'Branch User Name').groupby('Branch User Name').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        p_a  = clean_st(ff_drill,'Project').groupby('Project').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        su_a = clean_st(ff_drill,'Ticket subtype').groupby('Ticket subtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        mi_a = clean_st(ff_drill,'Call Microtype').groupby('Call Microtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
        ac_a = clean_st(ff_drill,'Action taken')['Action taken'].value_counts().head(10).reset_index()
        ac_a.columns = ['Action taken','Count']

        fig1 = mksb(m_a,  'Merchant',         'c', "1. Top 10 Merchants",  DS_NAVY)
        fig2 = mksb(br_a, 'Branch User Name',  'c', "2. Top 10 Branches",   DS_LIGHT)
        fig3 = mksb(p_a,  'Project',           'c', "3. Top 10 Projects",   DS_NAVY)
        fig5 = mksb(su_a, 'Ticket subtype',    'c', "5. Top 10 Subtypes",   DS_NAVY)
        fig6 = mksb(mi_a, 'Call Microtype',    'c', "6. Top 10 Microtypes", DS_LIGHT)
        fig7 = mksb(ac_a, 'Action taken',   'Count', "7. Key Actions Taken", DS_NAVY)
        fig4 = px.pie(clean_st(ff_drill,'Ticket type'), names='Ticket type',
                      title="4. Ticket Type Share", hole=0.3)
        fig4.update_traces(textinfo='percent+label')
        abt=(ff_drill[~ff_drill['Action taken'].str.lower().isin([x.lower() for x in BLACK_LIST])]
             .groupby(['Ticket_Status','Action taken']).size().reset_index(name='n').sort_values('n',ascending=False))
        def bhs(s):
            r=abt[abt['Ticket_Status']==s].head(6)
            return "<br>".join([f"• {x['Action taken']}: {x['n']}" for _,x in r.iterrows()]) if not r.empty else "No actions"
        sc_s=ff_drill['Ticket_Status'].value_counts().reset_index(); sc_s.columns=['Ticket_Status','Count']
        sc_s['h']=sc_s['Ticket_Status'].apply(bhs)
        fig_st=px.pie(sc_s,names='Ticket_Status',values='Count',
                      title="🟢 Live Ticket Status",
                      hole=0.4,color='Ticket_Status',color_discrete_map={"Closed":DS_NAVY,"Open":"#FF4B4B"})
        fig_st.update_traces(customdata=sc_s['h'],
                             hovertemplate="<b>%{label}</b><br>%{value}<br>%{percent:.2%}<br><br>%{customdata}<extra></extra>",
                             textinfo='percent+label',texttemplate='%{label}: %{percent:.2%}')
        SLIDE_DUR=15
        slides=[
            ("📊 Volume Trend (Peak Days)",  fig_v),
            ("1. Top 10 Merchants",          fig1),
            ("2. Top 10 Branches",           fig2),
            ("3. Top 10 Projects",           fig3),
            ("4. Ticket Type Share",         fig4),
            ("5. Top 10 Subtypes",           fig5),
            ("6. Top 10 Microtypes",         fig6),
            ("🟢 Live Ticket Status",        fig_st),
            ("7. Key Actions Taken",         fig7),
        ]
        ci=st.session_state.slide_index%len(slides)
        st_title,sf=slides[ci]
        st.markdown(f'<div class="slideshow-banner">🎬 Slideshow &nbsp;|&nbsp; {ci+1}/{len(slides)} &nbsp;|&nbsp; {SLIDE_DUR}s</div>',unsafe_allow_html=True)
        st.markdown(f"""<div class="slide-scorecard-wrap">
            <div class="slide-scorecard"><div class="sc-label">Total</div><div class="sc-value">{len(ff):,}</div></div>
            <div class="slide-scorecard"><div class="sc-label">Inbound</div><div class="sc-value">{len(inbound_s):,}</div></div>
            <div class="slide-scorecard"><div class="sc-label">WhatsApp</div><div class="sc-value">{len(wa_s):,}</div></div>
            <div class="slide-scorecard"><div class="sc-label">Quality</div><div class="sc-value">96.6%</div></div>
        </div>""",unsafe_allow_html=True)
        st.markdown(f'<div class="slideshow-chart-title">{st_title}</div>',unsafe_allow_html=True)
        _,cc,_=st.columns([0.5,9,0.5])
        with cc: st.plotly_chart(sf,use_container_width=True)
        pb=st.progress(0); sh=st.empty()
        for i in range(SLIDE_DUR):
            if not st.session_state.slideshow_active: break
            pb.progress((i+1)/SLIDE_DUR)
            sh.markdown(f'<p style="text-align:center;color:gray;font-size:11px;">⏱ {SLIDE_DUR-i-1}s...</p>',unsafe_allow_html=True)
            time.sleep(1)
        if st.session_state.slideshow_active:
            st.session_state.slide_index=(ci+1)%len(slides); st.rerun()

    # ── NORMAL MODE ──
    else:
        inbound_all  = ff[ff['Type'].str.contains('Inbound|Call', case=False, na=False)]
        wa_all       = ff[ff['Type'].str.contains('WhatsApp|App',  case=False, na=False)]
        inbound_base = ff_base[ff_base['Type'].str.contains('Inbound|Call', case=False, na=False)]
        wa_base      = ff_base[ff_base['Type'].str.contains('WhatsApp|App',  case=False, na=False)]

        has_filter       = bool(active_filters)
        analysis_total   = smart_analysis(ff,          ff_base,      active_filters) if has_filter else []
        analysis_inbound = smart_analysis(inbound_all, inbound_base, active_filters) if has_filter else []
        analysis_wa      = smart_analysis(wa_all,      wa_base,      active_filters) if has_filter else []
        AVG_QUALITY      = 96.6
        quality_analysis = [("▲ Above 95% target","green")] if (has_filter and AVG_QUALITY >= 95) else \
                           ([("▼ Below 95% target","#CC0000")] if (has_filter and AVG_QUALITY < 95) else [])

        t_m = get_top_safe(ff,'Merchant'); t_p = get_top_safe(ff,'Project')
        t_b = get_top_safe(ff,'Branch User Name'); t_t = get_top_safe(ff,'Ticket type')
        tooltip_total   = [("🏆","Top Merchant",t_m),("🏢","Top Project",t_p),("📍","Top Branch",t_b),("🎫","Top Type",t_t)]
        pk_in_day       = inbound_all['D_Obj'].mode()[0] if not inbound_all.empty else "N/A"
        pk_wa_day       = wa_all['D_Obj'].mode()[0]      if not wa_all.empty      else "N/A"
        tooltip_inbound = [("⏰","Peak Day",str(pk_in_day)),("📊","Total",f"{len(inbound_all):,}")]
        tooltip_wa      = [("📱","Peak Day",str(pk_wa_day)),("📊","Total",f"{len(wa_all):,}")]
        tooltip_quality = [("🌟","Top Performer","Menna Sameh"),("🎯","Target","95%"),("📅","Period","Current")]

        if active_filters:
            badges = "".join([f'<span class="filter-badge">🔍 {k}: {v}</span>' for k,v in active_filters.items()])
            st.markdown(f'<div style="margin:0 0 8px;">{badges}</div>',unsafe_allow_html=True)

        render_scorecards_row([
            {"id":"sc_tot","title":"📋 Total Tickets","value_str":f"{len(ff):,}",
             "analysis_lines":analysis_total,"tooltip_lines":tooltip_total,"border_color":"#002147"},
            {"id":"sc_in","title":"📞 Inbound Calls","value_str":f"{len(inbound_all):,}",
             "analysis_lines":analysis_inbound,"tooltip_lines":tooltip_inbound,"border_color":"#0055A4"},
            {"id":"sc_wa","title":"💬 WhatsApp","value_str":f"{len(wa_all):,}",
             "analysis_lines":analysis_wa,"tooltip_lines":tooltip_wa,"border_color":"#00AEEF"},
            {"id":"sc_q","title":"⭐ Avg Quality","value_str":f"{AVG_QUALITY}%",
             "analysis_lines":quality_analysis,"tooltip_lines":tooltip_quality,"border_color":"#00c06a"},
        ])

        daily = ff.groupby('D_Obj').size().reset_index(name='Total')
        peak  = daily.nlargest(20,'Total').sort_values('D_Obj')
        peak['Date_Str'] = peak['D_Obj'].astype(str)
        h_peak = []
        for d in peak['D_Obj']:
            rows  = ff[ff['D_Obj']==d].groupby('Call Microtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5)
            lines = [f"• {r['Call Microtype']}: {r['n']}" for _,r in rows.iterrows() if r['Call Microtype'].lower().strip() not in BLACK_LIST]
            h_peak.append("<br>".join(lines))
        fig_v = px.bar(peak, x='Date_Str', y='Total',
                       title="📊 Volume Trend (Peak Days)",
                       color_discrete_sequence=[DS_NAVY], text='Total')
        fig_v.update_traces(customdata=h_peak, hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
        fig_v.update_layout(xaxis={'type':'category'}, bargap=0.1, yaxis_title="Total")
        st.plotly_chart(fig_v, use_container_width=True, key="bar_volume")

        drill_d  = st.selectbox("🗓️ Drill down by Peak Day:", ["All Data"] + sorted(peak['Date_Str'].tolist()))
        ff_drill = ff.copy() if drill_d == "All Data" else ff[ff['D_Obj'].astype(str) == drill_d]

        if drill_d != "All Data":
            components.html("""
            <script>
            (function(){
                var tabs = Array.from(window.parent.document.querySelectorAll('[role="tab"]'));
                var explorer = tabs.find(function(t){ return (t.innerText||'').includes('Ticket Explorer'); });
                if(explorer && explorer.getAttribute('aria-selected')!=='true'){
                    setTimeout(function(){ explorer.click(); }, 120);
                }
            })();
            </script>""", height=0)

        st.divider()
        st.markdown("### 🎫 Tickets Live Status Summary")
        fp  = ff_drill.copy()
        abt = (fp[~fp['Action taken'].str.lower().isin([x.lower() for x in BLACK_LIST])]
               .groupby(['Ticket_Status','Action taken']).size().reset_index(name='n').sort_values('n',ascending=False))
        def bh(status):
            r = abt[abt['Ticket_Status']==status].head(6)
            return "<br>".join([f"• {x['Action taken']}: {x['n']}" for _,x in r.iterrows()]) if not r.empty else "No actions"
        sc = fp['Ticket_Status'].value_counts().reset_index(); sc.columns=['Ticket_Status','Count']
        sc['ht'] = sc['Ticket_Status'].apply(bh)
        _,pc,_ = st.columns([1,2,1])
        with pc:
            fig_st = px.pie(sc, names='Ticket_Status', values='Count',
                            title="🟢 Live Ticket Status — click to filter", hole=0.4, color='Ticket_Status',
                            color_discrete_map={"Closed":DS_NAVY,"Open":"#FF4B4B"})
            fig_st.update_traces(customdata=sc['ht'],
                                 hovertemplate="<b>%{label}</b><br>%{value}<br>%{percent:.2%}<br><br><b>Top Actions:</b><br>%{customdata}<extra></extra>",
                                 textinfo='percent+label', texttemplate='%{label}: %{percent:.2%}')
            pe = st.plotly_chart(fig_st, use_container_width=True,
                                 on_select="rerun", selection_mode="points", key="pie_status")
            if pe and pe.selection and pe.selection.get("points"):
                cs = pe.selection["points"][0].get("label")
                if cs in ["Open","Closed"]:
                    st.session_state.click_filter_col = "Ticket_Status"
                    st.session_state.click_filter_val = cs; st.rerun()

        st.divider()
        c1,c2 = st.columns(2)
        with c1:
            m_agg = clean_st(ff_drill,'Merchant').groupby('Merchant').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            m_h   = ["<br>".join([f"• {r['Call Microtype']}: {r['n']}" for _,r in ff_drill[ff_drill['Merchant']==m].groupby('Call Microtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows() if r['Call Microtype'].lower().strip() not in BLACK_LIST]) for m in m_agg['Merchant']]
            clickable_bar(m_agg,'Merchant','c',"1. Top 10 Merchants — click to filter",DS_NAVY,'Merchant','bar_merchant',customdata=m_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
            p_agg = clean_st(ff_drill,'Project').groupby('Project').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            p_h   = ["<br>".join([f"• {r['Call Microtype']}: {r['n']}" for _,r in ff_drill[ff_drill['Project']==p].groupby('Call Microtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows() if r['Call Microtype'].lower().strip() not in BLACK_LIST]) for p in p_agg['Project']]
            clickable_bar(p_agg,'Project','c',"3. Top 10 Projects — click to filter",DS_NAVY,'Project','bar_project',customdata=p_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
            su_agg = clean_st(ff_drill,'Ticket subtype').groupby('Ticket subtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            su_h   = ["<br>".join([f"• {r['Ticket type']}: {r['n']}" for _,r in ff_drill[ff_drill['Ticket subtype']==s].groupby('Ticket type').size().reset_index(name='n').sort_values('n',ascending=False).head(3).iterrows()]) for s in su_agg['Ticket subtype']]
            clickable_bar(su_agg,'Ticket subtype','c',"5. Top 10 Subtypes — click to filter",DS_NAVY,'Ticket subtype','bar_subtype',customdata=su_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")
        with c2:
            br_agg = clean_st(ff_drill,'Branch User Name').groupby('Branch User Name').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            br_h   = ["<br>".join([f"• {r['Merchant']}: {r['n']}" for _,r in ff_drill[ff_drill['Branch User Name']==b].groupby('Merchant').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows()]) for b in br_agg['Branch User Name']]
            clickable_bar(br_agg,'Branch User Name','c',"2. Top 10 Branches — click to filter",DS_LIGHT,'Branch User Name','bar_branch',customdata=br_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")

            tt_df = clean_st(ff_drill,'Ticket type')
            fig4  = px.pie(tt_df, names='Ticket type', title="4. Ticket Type Share — click to filter", hole=0.3)
            fig4.update_traces(textinfo='percent+label')
            ev4 = st.plotly_chart(fig4, use_container_width=True,
                                  on_select="rerun", selection_mode="points", key="pie_tt")
            if ev4 and ev4.selection and ev4.selection.get("points"):
                ctt = ev4.selection["points"][0].get("label")
                if ctt:
                    st.session_state.click_filter_col = "Ticket type"
                    st.session_state.click_filter_val = str(ctt); st.rerun()

            mi_agg = clean_st(ff_drill,'Call Microtype').groupby('Call Microtype').size().reset_index(name='c').sort_values('c',ascending=False).head(10)
            mi_h   = ["<br>".join([f"• {r['Ticket subtype']}: {r['n']}" for _,r in ff_drill[ff_drill['Call Microtype']==m].groupby('Ticket subtype').size().reset_index(name='n').sort_values('n',ascending=False).head(5).iterrows()]) for m in mi_agg['Call Microtype']]
            clickable_bar(mi_agg,'Call Microtype','c',"6. Top 10 Microtypes — click to filter",DS_LIGHT,'Call Microtype','bar_micro',customdata=mi_h,hovertemplate="Total: %{y}<br><br>%{customdata}<extra></extra>")

        st.divider()
        act_df = clean_st(ff_drill,'Action taken')['Action taken'].value_counts().head(10).reset_index()
        act_df.columns = ['Action taken','Count']
        clickable_bar(act_df,'Action taken','Count',"7. Key Actions Taken — click to filter",DS_NAVY,'Action taken','bar_action')

# ==========================================
# Admin Tabs
# ==========================================
if st.session_state.auth_role == "admin":
    with tabs[tabs_list.index("💬 WhatsApp MOM")]:
        st.markdown("<div class='page-title-header'>💬 WhatsApp MOM SLA Analysis</div>",unsafe_allow_html=True)
        wa_df  = ff[ff['Type'].str.contains('WhatsApp|App',case=False,na=False)]
        wa_col = next((c for c in wa_df.columns if 'sla status' in c.lower()),"WhatsApp SLA Status")
        ot_t   = len(wa_df[wa_df[wa_col].str.contains('On-Time|On Time',na=False,case=False)])
        ov_p   = (ot_t/len(wa_df)*100) if len(wa_df)>0 else 0
        asym,acol,tico,tcol=("▲","#00873d","✅ Achieved","#00873d") if ov_p>=95 else ("▼","#CC0000","❌ Below Target","#CC0000")
        st.markdown(f"""<div class="overall-card" style="text-align:center;">
            <p style="margin:0 0 4px;font-weight:900;color:{DS_NAVY};font-size:14px;letter-spacing:1px;font-family:Sora,sans-serif;">OVERALL ON-TIME RESPONSE</p>
            <p style="color:{DS_LIGHT};font-size:46px;font-weight:900;margin:2px 0 6px;font-family:Sora,sans-serif;">{ov_p:.2f}%</p>
            <p style="font-weight:800;font-size:16px;margin:0;">
                <span style="color:{acol};font-size:20px;">{asym}</span>&nbsp;
                <span style="color:green;">🎯 Target: 95%</span>&nbsp;—&nbsp;
                <span style="color:{tcol};">{tico}</span>
            </p></div>""",unsafe_allow_html=True)
        st.divider()
        ml=wa_df.sort_values('D_Obj')['Month_Name'].unique(); cols=st.columns(4)
        for i,m in enumerate(ml):
            md=wa_df[wa_df['Month_Name']==m]
            ot=len(md[md[wa_col].str.contains('On-Time|On Time',na=False,case=False)])
            lt=len(md[md[wa_col].str.contains('Late',na=False,case=False)])
            prc=(ot/(ot+lt)*100) if (ot+lt)>0 else 0
            with cols[i%4]:
                st.markdown(f'<div class="wa-card"><h5>{m}</h5><div class="perc">{prc:.1f}%</div>'
                            f'<p style="color:green;font-weight:700;margin:3px 0;">✅ On-Time: {ot}</p>'
                            f'<p style="color:#CC0000;font-weight:700;margin:3px 0;">❌ Late: {lt}</p></div>',unsafe_allow_html=True)

    with tabs[tabs_list.index("📈 Inbound SLA")]:
        st.markdown("<div class='page-title-header'>📈 Inbound SLA Performance</div>",unsafe_allow_html=True)
        if df_s is not None and not df_s.empty:
            pca_s=to_n(df_s['PCA %']); ap=pca_s[pca_s>0]; opa=ap.mean() if not ap.empty else 0
            ps,pc2,pt,ptc=("▲","green","✅ Achieved","green") if opa>=95 else ("▼","#CC0000","❌ Below Target","#CC0000")
            st.markdown(f"""<div class="overall-card" style="text-align:center;margin-bottom:18px;">
                <p style="margin:0 0 4px;font-weight:900;color:{DS_NAVY};font-size:14px;letter-spacing:1px;font-family:Sora,sans-serif;">OVERALL PCA% ACHIEVEMENT (AVG)</p>
                <p style="color:{DS_LIGHT};font-size:46px;font-weight:900;margin:2px 0 6px;font-family:Sora,sans-serif;">{opa:.1f}%</p>
                <p style="font-weight:800;font-size:16px;margin:0;">
                    <span style="color:{pc2};font-size:20px;">{ps}</span>&nbsp;
                    <span style="color:{ptc};">🎯 Target: 95% — {pt}</span>
                </p></div>""",unsafe_allow_html=True)
            st.divider()
            fig_sla=px.bar(df_s,x='Month',y=to_n(df_s['PCA %']),title="Monthly PCA% Achievement",
                           text_auto='.1f',color_discrete_sequence=[DS_NAVY],labels={'y':'PCA %','Month':''})
            fig_sla.update_layout(yaxis_title="PCA %",xaxis_type='category',bargap=0.3)
            st.plotly_chart(fig_sla,use_container_width=True)
            st.dataframe(df_s.style.set_properties(**{'color':DS_NAVY,'font-weight':'800'}),use_container_width=True,hide_index=True)

    with tabs[tabs_list.index("🏆 Quality Board")]:
        st.markdown("<div class='page-title-header'>🏆 Agent Quality Board</div>",unsafe_allow_html=True)
        cq=df_q[~df_q['Agent Name'].str.contains('Total',case=False,na=False)].copy()
        cq['EC %_num']=to_n(cq['EC %']); cq['BC %_num']=to_n(cq['BC %'])
        dp=cq.melt(id_vars=['Agent Name'],value_vars=['EC %_num','BC %_num'],var_name='Metric',value_name='Score')
        dp['Metric']=dp['Metric'].replace({'EC %_num':'EC %','BC %_num':'BC %'})
        fq=px.bar(dp,x='Agent Name',y='Score',color='Metric',barmode='group',text='Score',
                  color_discrete_sequence=[DS_NAVY,DS_LIGHT],labels={'Score':'Score %','Agent Name':''})
        fq.update_traces(texttemplate='%{text:.1f}%',textposition='outside')
        fq.update_layout(xaxis_type='category',bargap=0.15,bargroupgap=0.05,yaxis_range=[0,115],yaxis_title="Score %")
        st.plotly_chart(fq,use_container_width=True)
        st.dataframe(cq.drop(columns=['EC%','BC%','EC %_num','BC %_num'],errors='ignore')
                     .style.set_properties(**{'color':DS_NAVY,'font-weight':'800'}),use_container_width=True,hide_index=True)

# ==========================================
# Ticket Explorer
# ==========================================
with tabs[tabs_list.index("🎫 Ticket Explorer")]:
    try:    ff_final = ff_drill.copy()
    except: ff_final = ff.copy()
    csv_data = ff_final.drop(columns=['D_Obj','Month_Name','Ticket_Status','Month_Num'],errors='ignore').to_csv(index=False).encode('utf-8')
    srch_col, exp_col = st.columns([4, 1])
    with srch_col:
        search = st.text_input("🔍 Smart Search...", "", key="main_search")
    with exp_col:
        st.markdown("<div style='height:2px'></div>", unsafe_allow_html=True)
        st.download_button("⬇ Export CSV", data=csv_data, file_name="tickets_export.csv", mime="text/csv", use_container_width=True)
    if search:
        ff_final = ff_final[ff_final.apply(lambda r: r.astype(str).str.contains(search,case=False).any(),axis=1)]
    st.dataframe(
        ff_final.drop(columns=['D_Obj','Month_Name','Ticket_Status','Month_Num'],errors='ignore')
        .style.set_properties(**{'color':DS_NAVY,'font-weight':'800'}),
        use_container_width=True, hide_index=True
    )

# ==========================================
